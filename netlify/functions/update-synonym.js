const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";
const API_KEY = "jeju2026!";

function httpsPatch(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const buf = Buffer.from(body, "utf8");
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "PATCH",
      headers: { ...headers, "Content-Length": buf.length },
    };
    const req = https.request(options, (res) => {
      // 응답을 문자열로 바로 이어붙이면 한글이 청크 경계에서 깨질 수 있으므로,
      // Buffer로 모두 모은 뒤 마지막에 한 번만 UTF-8 문자열로 변환합니다.
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
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

    // originalFrom: 수정 대상 행을 찾기 위한 기존 "표본국명" 값 (PATCH 대상 식별용)
    // data: [새 표본국명, 새 공정서국명]
    const originalFrom = parsed["표본국명"];
    const row = parsed.data;

    if (!originalFrom || !row || !row[0] || !row[1]) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "표본국명 또는 데이터 없음" }),
      };
    }

    const record = {
      "표본국명": String(row[0] || "").trim(),
      "공정서국명": String(row[1] || "").trim(),
    };

    const encodedFrom = encodeURIComponent(originalFrom);
    const result = await httpsPatch(
      `${SUPABASE_URL}/rest/v1/species_synonyms?표본국명=eq.${encodedFrom}`,
      {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      JSON.stringify(record)
    );

    if (result.status !== 200 && result.status !== 204) {
      throw new Error(`Supabase 오류 (${result.status}): ${result.body.substring(0, 200)}`);
    }

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
