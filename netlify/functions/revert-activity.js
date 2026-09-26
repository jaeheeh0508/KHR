const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";
const API_KEY = "jeju2026!";

function httpsRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const buf = body ? Buffer.from(body, "utf8") : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: buf ? { ...headers, "Content-Length": buf.length } : headers,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (buf) req.write(buf);
    req.end();
  });
}

const jsonHeaders = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  "Accept": "application/json",
};

// site(제주/옥천)에 따라 실제로 되돌릴 표본 테이블을 고른다.
function tableFor(site) {
  return site === "okcheon" ? "specimens_okcheon" : "specimens";
}

// 표본 하나를 관리번호 기준으로 되돌린다.
// beforeRow가 있으면(=원래 값이 있었으면) 그 값으로 PATCH, 없으면(=원래 없었던 표본이면) DELETE.
async function restoreOne(table, id, beforeRow) {
  const encodedId = encodeURIComponent(id);
  if (beforeRow) {
    const record = { ...beforeRow };
    delete record.id; // 자동 증가 PK는 건드리지 않음
    const res = await httpsRequest(
      "PATCH",
      `${SUPABASE_URL}/rest/v1/${table}?관리번호=eq.${encodedId}`,
      { ...jsonHeaders, "Prefer": "return=minimal" },
      JSON.stringify(record)
    );
    if (res.status !== 200 && res.status !== 204) {
      // 행이 이미 없어졌다면(예: 그 사이 삭제됨) PATCH 대신 새로 INSERT 시도
      const insertRes = await httpsRequest(
        "POST",
        `${SUPABASE_URL}/rest/v1/${table}`,
        { ...jsonHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
        JSON.stringify([record])
      );
      if (insertRes.status !== 200 && insertRes.status !== 201 && insertRes.status !== 204) {
        throw new Error(`복원 실패(${id}): ${insertRes.body.substring(0, 200)}`);
      }
    }
  } else {
    const res = await httpsRequest(
      "DELETE",
      `${SUPABASE_URL}/rest/v1/${table}?관리번호=eq.${encodedId}`,
      { ...jsonHeaders, "Prefer": "return=minimal" },
      null
    );
    if (res.status !== 200 && res.status !== 204) {
      throw new Error(`삭제 실패(${id}): ${res.body.substring(0, 200)}`);
    }
  }
}

// before_data가 [{ id, before }, ...] 배열 형태인 이력(일괄 업로드, 일괄 삭제)을
// 한꺼번에 되돌린다. 각 항목의 before가 있으면 그 값으로 복원(PATCH/INSERT), 없으면
// (=원래 없었던 표본이면) 삭제한다.
async function restoreMany(table, items) {
  let restored = 0, deleted = 0, failed = 0;
  for (const item of items) {
    try {
      await restoreOne(table, item.id, item.before);
      if (item.before) restored++; else deleted++;
    } catch (e) {
      failed++;
    }
  }
  return { restored, deleted, failed };
}

exports.handler = async function(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: "Method Not Allowed" };
  }

  try {
    const parsed = JSON.parse(event.body || "{}");

    if (parsed.apiKey !== API_KEY) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "인증 실패" }),
      };
    }

    const logId = parsed.id;
    if (!logId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "id 없음" }),
      };
    }

    // 1) 되돌릴 이력 항목을 조회
    const entryRes = await httpsRequest(
      "GET",
      `${SUPABASE_URL}/rest/v1/activity_log?id=eq.${encodeURIComponent(logId)}&select=*`,
      jsonHeaders,
      null
    );
    const entries = JSON.parse(entryRes.body);
    if (!Array.isArray(entries) || entries.length === 0) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "이력을 찾을 수 없습니다" }),
      };
    }
    const entry = entries[0];

    if (entry.reverted) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "이미 되돌린 이력입니다" }),
      };
    }
    if (entry.action === "revert") {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "되돌리기 기록은 다시 되돌릴 수 없습니다" }),
      };
    }
    if (entry.before_data === null || entry.before_data === undefined) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "이 이력은 되돌리기 정보를 가지고 있지 않습니다 (이전 버전에서 기록된 이력이거나, 이전 값 조회에 실패했던 경우입니다)" }),
      };
    }

    const table = tableFor(entry.site);
    let detail;

    // 2) 실제 되돌리기 수행
    if (entry.action === "update") {
      // 단일 표본 수정 되돌리기: before_data는 그 표본의 이전 값(객체) 하나
      await restoreOne(table, entry.spec_id, entry.before_data);
      detail = `수정 이력을 되돌림 (관리번호: ${entry.spec_id})`;
    } else if (entry.action === "delete") {
      if (Array.isArray(entry.before_data)) {
        // 일괄 삭제(선택 삭제) 되돌리기: before_data는 [{ id, before }, ...] 배열
        const { restored, failed } = await restoreMany(table, entry.before_data);
        detail = `삭제된 표본 ${entry.before_data.length}건을 복원함${failed ? ` (실패 ${failed}건)` : ""}`;
      } else {
        // 단일 표본 삭제 되돌리기(예전 형식): before_data는 그 표본의 이전 값(객체) 하나
        await restoreOne(table, entry.spec_id, entry.before_data);
        detail = `삭제된 표본을 복원함 (관리번호: ${entry.spec_id})`;
      }
    } else if (entry.action === "upload") {
      // 일괄 업로드 되돌리기: before_data는 [{ id, before }, ...] 배열
      const items = Array.isArray(entry.before_data) ? entry.before_data : [];
      const { restored, deleted, failed } = await restoreMany(table, items);
      detail = `업로드 이력을 되돌림 (복원 ${restored}건, 신규 삭제 ${deleted}건${failed ? `, 실패 ${failed}건` : ""})`;
    } else {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: `되돌릴 수 없는 작업 종류입니다: ${entry.action}` }),
      };
    }

    // 3) 원본 이력에 "되돌림" 표시
    await httpsRequest(
      "PATCH",
      `${SUPABASE_URL}/rest/v1/activity_log?id=eq.${encodeURIComponent(logId)}`,
      { ...jsonHeaders, "Prefer": "return=minimal" },
      JSON.stringify({ reverted: true })
    );

    // 4) "되돌리기" 자체도 새 이력으로 남긴다 (단, 이 되돌리기는 또 되돌릴 수 없도록 before_data 없이 남김)
    await httpsRequest(
      "POST",
      `${SUPABASE_URL}/rest/v1/activity_log`,
      { ...jsonHeaders, "Prefer": "return=minimal" },
      JSON.stringify([{ action: "revert", spec_id: entry.spec_id, spec_name: entry.spec_name, detail, before_data: null, site: entry.site || "jeju" }])
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, detail }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
