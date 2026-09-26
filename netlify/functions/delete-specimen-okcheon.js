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

// 관리자 활동 이력을 activity_log 테이블에 남긴다. 실패해도 삭제 자체는 이미 끝난 뒤이므로 조용히 무시.
// beforeData: 삭제되기 전 행 전체(되돌리기용 스냅샷).
async function logActivity(action, specId, specName, detail, beforeData) {
  try {
    await httpsRequest(
      "POST",
      `${SUPABASE_URL}/rest/v1/activity_log`,
      {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
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
    const parsed = JSON.parse(event.body);

    if (parsed.apiKey !== API_KEY) {
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "인증 실패" }),
      };
    }

    const id = parsed["관리번호"];
    if (!id) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "관리번호 없음" }),
      };
    }

    const encodedId = encodeURIComponent(id);
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
    };

    // 되돌리기(undo)를 지원하기 위해, 삭제하기 전 행 전체를 먼저 조회해 스냅샷으로 남긴다.
    let beforeRow = null;
    try {
      const beforeRes = await httpsRequest(
        "GET",
        `${SUPABASE_URL}/rest/v1/specimens_okcheon?관리번호=eq.${encodedId}&select=*`,
        headers,
        null
      );
      const beforeRows = JSON.parse(beforeRes.body);
      if (Array.isArray(beforeRows) && beforeRows.length > 0) beforeRow = beforeRows[0];
    } catch (e) {
      // 이전 값 조회 실패해도 삭제 자체는 계속 진행 (되돌리기만 불가능해짐)
    }

    const result = await httpsRequest(
      "DELETE",
      `${SUPABASE_URL}/rest/v1/specimens_okcheon?관리번호=eq.${encodedId}`,
      {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "return=minimal",
      },
      null
    );

    if (result.status !== 200 && result.status !== 204) {
      throw new Error(`Supabase 오류 (${result.status}): ${result.body.substring(0, 200)}`);
    }

    await logActivity("delete", id, parsed["표본번호"] || (beforeRow ? beforeRow["표본번호"] : ""), "표본 삭제", beforeRow);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
