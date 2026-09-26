const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";

// get-specimens.js와 동일한 이유로 두 가지를 반영합니다.
// 1) PostgREST는 한 번의 요청에서 최대 1000건까지만 반환하므로(쿼리의 limit과 무관),
//    Range 헤더로 페이지를 나눠 전체를 모읍니다. (지금은 이명이 1000건 미만이라 문제
//    없겠지만, 앞으로 늘어나도 안전하도록 미리 반영)
// 2) 응답을 문자열로 바로 이어붙이면 한글이 청크 경계에서 깨질 수 있어, Buffer로
//    모두 모은 뒤 마지막에 한 번만 UTF-8로 변환합니다.
const PAGE_SIZE = 1000;

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

exports.handler = async function(event, context) {
  try {
    // id 컬럼 존재 여부에 의존하지 않도록 표본국명 기준으로 정렬합니다.
    const baseUrl = `${SUPABASE_URL}/rest/v1/species_synonyms?select=표본국명,공정서국명&order=표본국명.asc`;

    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
      "Prefer": "count=exact",
    };

    let allRows = [];
    let offset = 0;
    let total = null;

    while (true) {
      const result = await httpsGetRange(baseUrl, headers, offset, offset + PAGE_SIZE - 1);

      if (result.status !== 200 && result.status !== 206) {
        return {
          statusCode: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: `Supabase 오류 (${result.status}): ${result.body.substring(0, 300)}` }),
        };
      }

      let pageRows;
      try {
        pageRows = JSON.parse(result.body);
      } catch (e) {
        return {
          statusCode: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: "파싱 실패: " + result.body.substring(0, 200) }),
        };
      }

      if (!Array.isArray(pageRows)) {
        return {
          statusCode: 500,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ ok: false, error: "예상치 못한 응답: " + JSON.stringify(pageRows).substring(0, 200) }),
        };
      }

      allRows = allRows.concat(pageRows);

      if (total === null && result.contentRange) {
        const match = /\/(\d+)$/.exec(result.contentRange);
        if (match) total = parseInt(match[1], 10);
      }

      offset += PAGE_SIZE;
      if (pageRows.length < PAGE_SIZE) break;
      if (total !== null && offset >= total) break;
    }

    // [[표본국명, 공정서국명], ...] 형태로 반환
    const data = allRows.map(r => [r["표본국명"] || "", r["공정서국명"] || ""]);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ ok: true, data }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
