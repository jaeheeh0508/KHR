const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";
const API_KEY = "jeju2026!";

function httpsGetRange(url, headers, rangeFrom, rangeTo) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        ...headers,
        "Range-Unit": "items",
        "Range": `${rangeFrom}-${rangeTo}`,
      },
    };
    const req = https.request(options, (res) => {
      // 응답을 문자열로 바로 이어붙이면 한글이 청크 경계에서 깨질 수 있으므로,
      // Buffer로 모두 모은 뒤 마지막에 한 번만 UTF-8 문자열로 변환합니다.
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
        contentRange: res.headers["content-range"],
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

// 관리자 활동 이력(업로드/수정/삭제) 조회 — 관리자 로그인이 되어 있을 때만 접근 가능.
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

    let offset = parseInt(parsed.offset, 10);
    let limit = parseInt(parsed.limit, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;

    const url = `${SUPABASE_URL}/rest/v1/activity_log?select=*&order=created_at.desc`;
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
      "Prefer": "count=exact",
    };

    const result = await httpsGetRange(url, headers, offset, offset + limit - 1);

    if (result.status !== 200 && result.status !== 206) {
      return {
        statusCode: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: `Supabase 오류 (${result.status}): ${result.body.substring(0, 300)}` }),
      };
    }

    let rows;
    try {
      rows = JSON.parse(result.body);
    } catch (e) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "파싱 실패: " + result.body.substring(0, 200) }),
      };
    }

    let total = offset + rows.length;
    if (result.contentRange) {
      const m = /\/(\d+)$/.exec(result.contentRange);
      if (m) total = parseInt(m[1], 10);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, data: rows, total, offset, limit, hasMore: offset + rows.length < total }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
