const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";

// Supabase(PostgREST)는 한 번의 요청에서 반환하는 행 수를 기본 1000건으로 제한합니다.
// (쿼리의 limit 값과 무관하게 서버(db-max-rows) 설정에 의해 강제됨)
// → Range 헤더로 페이지를 나눠 요청해야 합니다.
//
// 또한 Netlify Functions는 응답(response) 크기 자체에 약 6MB 제한이 있습니다.
// 표본 수가 많아지면 전체 데이터를 한 번에 응답하는 방식은 이 제한을 초과해
// "Function.ResponseSizeTooLarge" 오류가 발생합니다.
// → 이 함수는 이제 offset/limit 쿼리 파라미터를 받아 "한 페이지씩만" 응답하고,
//    프론트엔드가 여러 번 호출해 데이터를 합치도록 변경했습니다.
const MAX_LIMIT = 1000; // Supabase db-max-rows 한도와 동일하게 맞춤
const REQUEST_TIMEOUT_MS = 8000;

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
      // 응답을 문자열로 바로 이어붙이면(chunk가 Buffer→string으로 암묵 변환되면서)
      // 한글처럼 UTF-8에서 여러 바이트로 구성되는 문자가 네트워크 청크 경계에서
      // 끊겨 깨질 수 있습니다. 반드시 Buffer 상태로 모두 모은 뒤,
      // 끝에서 한 번만 UTF-8 문자열로 변환해야 합니다.
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
        contentRange: res.headers["content-range"], // e.g. "0-999/2345"
      }));
    });
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`요청 타임아웃 (range ${rangeFrom}-${rangeTo})`));
    });
    req.end();
  });
}

exports.handler = async function(event, context) {
  try {
    const qs = event.queryStringParameters || {};
    let offset = parseInt(qs.offset, 10);
    let limit = parseInt(qs.limit, 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    if (!Number.isFinite(limit) || limit <= 0) limit = MAX_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const baseUrl = `${SUPABASE_URL}/rest/v1/specimens_okcheon?select=관리번호,표본번호,수장고,수장위치,생약명,국명,학명,수집날짜,수집장소,중요도,속명,과명,gps,공정서,과제명&order=id.asc`;

    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
      "Prefer": "count=exact", // 전체 건수를 Content-Range로 함께 받아 hasMore 판단에 사용
    };

    const result = await httpsGetRange(baseUrl, headers, offset, offset + limit - 1);

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

    if (!Array.isArray(rows)) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "예상치 못한 응답: " + JSON.stringify(rows).substring(0, 200) }),
      };
    }

    let total = offset + rows.length;
    if (result.contentRange) {
      const match = /\/(\d+)$/.exec(result.contentRange);
      if (match) total = parseInt(match[1], 10);
    }

    const data = rows.map(r => [
      r["관리번호"] || "",
      r["표본번호"] || "",
      r["수장고"]   || "",
      r["수장위치"] || "",
      r["생약명"]   || "",
      r["국명"]     || "",
      r["학명"]     || "",
      r["수집날짜"] || "",
      r["수집장소"] || "",
      r["중요도"]   || "",
      r["속명"]     || "",
      r["과명"]     || "",
      r["gps"]      || "",
      r["공정서"]   || "",
      r["과제명"]   || "",
    ]);

    const hasMore = offset + rows.length < total;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, data, total, offset, limit, hasMore }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
