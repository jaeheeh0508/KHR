const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";
const API_KEY = "jeju2026!";

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const buf = Buffer.from(body, "utf8");
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
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

    const rows = parsed.rows; // [[표본국명, 공정서국명], ...]
    const isUpsert = parsed.upsert === true; // true면 같은 표본국명은 덮어씀

    if (!rows || rows.length === 0) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "데이터 없음" }),
      };
    }

    const records = rows.map(r => ({
      "표본국명": r[0] || "",
      "공정서국명": r[1] || "",
    }));

    const CHUNK = 500;
    let totalAdded = 0;

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const prefer = isUpsert
        ? "resolution=merge-duplicates,return=minimal"
        : "resolution=ignore-duplicates,return=minimal";

      // on_conflict을 명시해야 "표본국명" 유니크 컬럼 기준으로 병합/무시가 동작합니다.
      const result = await httpsPost(
        `${SUPABASE_URL}/rest/v1/species_synonyms?on_conflict=${encodeURIComponent("표본국명")}`,
        {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": prefer,
        },
        JSON.stringify(chunk)
      );

      if (result.status !== 200 && result.status !== 201 && result.status !== 204) {
        throw new Error(`Supabase 오류 (${result.status}): ${result.body.substring(0, 200)}`);
      }
      totalAdded += chunk.length;
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, added: totalAdded }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
