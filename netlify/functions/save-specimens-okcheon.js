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

// 관리자 활동 이력(업로드/수정/삭제)을 activity_log 테이블에 남긴다.
// 이력 기록에 실패하더라도 원래 작업(이 경우 업로드)은 이미 끝난 뒤이므로 조용히 무시한다.
// beforeData: 업로드로 영향받은 각 관리번호의 "이전 값" 목록(되돌리기용 스냅샷).
//   [{ id, before: 이전 행 객체 또는 null(새로 추가된 경우) }, ...]
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

    const rows = parsed.rows;
    const isUpsert = parsed.upsert === true; // 수정 모드 여부

    if (!rows || rows.length === 0) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "데이터 없음" }),
      };
    }

    const records = rows.map(r => ({
      "관리번호": r[0] || "",
      "표본번호": r[1] || "",
      "수장고":   r[2] || "",
      "수장위치": r[3] || "",
      "생약명":   r[4] || "",
      "국명":     r[5] || "",
      "학명":     r[6] || "",
      "수집날짜": r[7] || "",
      "수집장소": r[8] || "",
      "중요도":   r[9] || "",
      "속명":     r[10] || "",
      "과명":     r[11] || "",
      "gps":      r[12] || "",
      "공정서":   r[13] || "",
      "과제명":   r[14] || "",
    }));

    const CHUNK = 200;
    let totalAdded = 0;
    const allBeforeInfo = []; // 되돌리기용: 업로드가 건드린 관리번호별 이전 값(없었으면 null)

    const headers = {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept": "application/json",
    };

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);

      // 되돌리기를 지원하기 위해, 이 청크의 관리번호들이 이미 DB에 있었는지(있었다면 이전 값이 뭐였는지)
      // 먼저 조회해둔다. (실패해도 업로드 자체는 계속 진행 — 그 청크만 되돌리기가 불가능해짐)
      let existingMap = new Map();
      try {
        const ids = chunk.map(r => r["관리번호"]).filter(Boolean);
        if (ids.length > 0) {
          const inList = ids.map(id => encodeURIComponent(id)).join(",");
          const existingRes = await httpsGet(
            `${SUPABASE_URL}/rest/v1/specimens_okcheon?관리번호=in.(${inList})&select=*`,
            headers
          );
          const existingRows = JSON.parse(existingRes.body);
          if (Array.isArray(existingRows)) {
            existingRows.forEach(r => existingMap.set(r["관리번호"], r));
          }
        }
      } catch (e) {
        // 조회 실패 시 이 청크는 전부 "이전 값 없음"으로 간주 (되돌리기 시 전부 삭제됨 — 최선의 대응)
      }
      chunk.forEach(r => {
        allBeforeInfo.push({ id: r["관리번호"], before: existingMap.get(r["관리번호"]) || null });
      });

      // upsert=true면 중복 시 업데이트, false면 중복 무시
      const prefer = isUpsert
        ? "resolution=merge-duplicates,return=minimal"
        : "resolution=ignore-duplicates,return=minimal";

      // ⚠ on_conflict를 지정하지 않으면 PostgREST는 기본적으로 테이블의 기본 키(id)를
      // 기준으로 충돌을 판단한다. 이 테이블은 "관리번호"에 별도의 유니크 제약
      // (specimens_okcheon_관리번호_key)이 걸려 있고 기본 키는 아니므로, on_conflict를
      // 명시하지 않으면 관리번호 중복을 못 잡아내고 그대로 INSERT를 시도해
      // "duplicate key value violates unique constraint" 409 오류가 난다.
      const result = await httpsPost(
        `${SUPABASE_URL}/rest/v1/specimens_okcheon?on_conflict=${encodeURIComponent("관리번호")}`,
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

    await logActivity(
      "upload",
      null,
      null,
      `표본 ${totalAdded}건 업로드 (${isUpsert ? "중복 시 덮어쓰기" : "중복 시 건너뜀"})`,
      allBeforeInfo
    );

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
