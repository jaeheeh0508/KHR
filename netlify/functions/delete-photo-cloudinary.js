const https = require("https");
const crypto = require("crypto");

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;
const ADMIN_KEY = "jeju2026!"; // 관리자 비밀번호 — 기존 표본 관리 기능과 동일한 값 사용

function httpsPost(url, headers, bodyBuf) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { ...headers, "Content-Length": bodyBuf.length },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

function cloudinarySignature(params, apiSecret) {
  const keys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== "").sort();
  const toSign = keys.map(k => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

const CORS = { "Access-Control-Allow-Origin": "*" };

// 표본 사진 하나를 Cloudinary에서 삭제한다. 관리자만 가능.
exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { ...CORS, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }
  try {
    const parsed = JSON.parse(event.body);
    if (parsed.apiKey !== ADMIN_KEY) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ ok: false, error: "인증 실패" }) };
    }
    const key = parsed.key; // public_id (예: "specimens/KHR123/173..._photo")
    if (!key) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "key 없음" }) };
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = cloudinarySignature({ public_id: key, timestamp }, API_SECRET);

    const form = new URLSearchParams();
    form.append("public_id", key);
    form.append("timestamp", String(timestamp));
    form.append("api_key", API_KEY);
    form.append("signature", signature);

    const bodyBuf = Buffer.from(form.toString(), "utf8");
    const res = await httpsPost(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`,
      { "Content-Type": "application/x-www-form-urlencoded" },
      bodyBuf
    );
    if (res.status !== 200) {
      throw new Error(`Cloudinary 삭제 실패 (${res.status}): ${res.body.substring(0, 300)}`);
    }
    const json = JSON.parse(res.body);
    if (json.result !== "ok" && json.result !== "not found") {
      throw new Error(`Cloudinary 삭제 실패: ${JSON.stringify(json).substring(0, 200)}`);
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
