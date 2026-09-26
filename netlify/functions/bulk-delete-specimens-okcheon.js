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

// 관리자 활동 이력(업로드/수정/삭제)을 activity_log 테이블에 남긴다.
// 이력 기록에 실패하더라도 원래 작업(삭제)은 이미 끝난 뒤이므로 조용히 무시한다.
async function logActivity(action, specId, specName, detail, beforeData) {
  try {
    await httpsRequest(
      "POST",
      `${SUPABASE_URL}/rest/v1/activity_log`,
      { ...jsonHeaders, "Prefer": "return=minimal" },
      JSON.stringify([{ action, spec_id: specId || null, spec_name: specName || null, detail: detail || null, before_data: beforeData !== undefined ? beforeData : null, site: "okcheon" }])
    );
  } catch (e) {
    // 이력 기록 실패는 무시
  }
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

    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter(Boolean) : [];
    if (ids.length === 0) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "삭제할 관리번호가 없습니다" }),
      };
    }

    const CHUNK = 200;
    let totalDeleted = 0;
    const failedIds = [];
    const allBeforeInfo = []; // 되돌리기용: 삭제된 각 관리번호의 이전 값 스냅샷

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunkIds = ids.slice(i, i + CHUNK);
      const inList = chunkIds.map(id => encodeURIComponent(id)).join(",");

      // 1) 삭제 전, 되돌리기용으로 현재 값을 먼저 조회해둔다.
      let existingRows = [];
      try {
        const existingRes = await httpsRequest(
          "GET",
          `${SUPABASE_URL}/rest/v1/specimens_okcheon?관리번호=in.(${inList})&select=*`,
          jsonHeaders,
          null
        );
        const parsedRows = JSON.parse(existingRes.body);
        if (Array.isArray(parsedRows)) existingRows = parsedRows;
      } catch (e) {
        // 조회 실패 시 이 청크는 스냅샷 없이 진행 (되돌리기 시 이 청크는 복원 불가)
      }
      const existingMap = new Map(existingRows.map(r => [r["관리번호"], r]));
      chunkIds.forEach(id => {
        allBeforeInfo.push({ id, before: existingMap.get(id) || null });
      });

      // 2) 실제 삭제
      const delRes = await httpsRequest(
        "DELETE",
        `${SUPABASE_URL}/rest/v1/specimens_okcheon?관리번호=in.(${inList})`,
        { ...jsonHeaders, "Prefer": "return=minimal" },
        null
      );
      if (delRes.status !== 200 && delRes.status !== 204) {
        chunkIds.forEach(id => failedIds.push(id));
      } else {
        totalDeleted += chunkIds.length;
      }
    }

    await logActivity(
      "delete",
      null,
      null,
      `표본 ${totalDeleted}건 삭제${failedIds.length ? ` (실패 ${failedIds.length}건)` : ""}`,
      allBeforeInfo
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, deleted: totalDeleted, failedIds }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
