const https = require("https");

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

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
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const CORS = { "Access-Control-Allow-Origin": "*" };

// 특정 표본(관리번호)의 Cloudinary 사진 목록을 조회한다. 누구나 조회 가능(로그인 불필요).
exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  }
  try {
    const id = (event.queryStringParameters || {}).id;
    if (!id) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "id 없음" }) };
    }
    const prefix = `specimens/${id}/`;
    const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?prefix=${encodeURIComponent(prefix)}&type=upload&max_results=200`;
    const res = await httpsGet(url, { "Authorization": `Basic ${auth}` });
    if (res.status !== 200) {
      throw new Error(`Cloudinary 오류 (${res.status}): ${res.body.substring(0, 200)}`);
    }
    const json = JSON.parse(res.body);
    const photos = (json.resources || []).map(r => ({
      name: r.public_id.split("/").pop(),
      key: r.public_id, // 삭제 시 필요
      url: r.secure_url,
    }));
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, data: photos }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
