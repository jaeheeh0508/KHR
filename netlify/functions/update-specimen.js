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
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

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
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

// 관리자 활동 이력을 activity_log 테이블에 남긴다. 실패해도 원래 작업에는 영향 없음.
// beforeData: 수정 전 값(되돌리기용 스냅샷). 원본 행이 없었으면 null.
async function logActivity(action, specId, specName, detail, beforeData) {
  try {
    await httpsPost(
      `${SUPABASE_URL}/rest/v1/activity_log`,
      {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      JSON.stringify([{ action, spec_id: specId || null, spec_name: specName || null, detail: detail || null, before_data: beforeData !== undefined ? beforeData : null, site: "jeju" }])
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
    const row = parsed.data;

    if (!id || !row) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "관리번호 또는 데이터 없음" }),
      };
    }

    // 배열 → Supabase 객체로 변환
    const record = {
      "표본번호": row[1] || "",
      "수장고":   row[2] || "",
      "수장위치": row[3] || "",
      "생약명":   row[4] || "",
      "국명":     row[5] || "",
      "학명":     row[6] || "",
      "수집날짜": row[7] || "",
      "수집장소": row[8] || "",
      "중요도":   row[9] || "",
      "속명":     row[10] || "",
      "과명":     row[11] || "",
      "gps":      row[12] || "",
      "공정서":   row[13] || "",
      "과제명":   row[14] || "",
    };

    const encodedId = encodeURIComponent(id);
    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
    };

    // 되돌리기(undo)를 지원하기 위해, 수정하기 전 값을 먼저 조회해 스냅샷으로 남긴다.
    let beforeRow = null;
    try {
      const beforeRes = await httpsGet(
        `${SUPABASE_URL}/rest/v1/specimens?관리번호=eq.${encodedId}&select=*`,
        headers
      );
      const beforeRows = JSON.parse(beforeRes.body);
      if (Array.isArray(beforeRows) && beforeRows.length > 0) beforeRow = beforeRows[0];
    } catch (e) {
      // 이전 값 조회 실패해도 수정 자체는 계속 진행 (되돌리기만 불가능해짐)
    }

    // Supabase PATCH (관리번호 기준 업데이트)
    const result = await httpsPatch(
      `${SUPABASE_URL}/rest/v1/specimens?관리번호=eq.${encodedId}`,
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

    await logActivity("update", id, record["표본번호"] || "", "표본 정보 수정", beforeRow);

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
