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

// Cloudinary 업로드 서명 계산: file/api_key/signature/cloud_name을 제외한 나머지 파라미터를
// key 이름 기준으로 정렬해 "key=value&key2=value2" 형태로 이어붙인 뒤 api_secret을 붙여 SHA1 해시.
function cloudinarySignature(params, apiSecret) {
  const keys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== null && params[k] !== "").sort();
  const toSign = keys.map(k => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

const CORS = { "Access-Control-Allow-Origin": "*" };

// 표본 사진 하나를 Cloudinary에 업로드한다. 관리자만 가능.
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
    const { id, fileName, contentType, fileBase64 } = parsed;
    if (!id || !fileName || !fileBase64) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "id/fileName/fileBase64 없음" }) };
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, ""); // Cloudinary가 확장자를 자동으로 붙이므로 제거

    // 중복 업로드 방지: 파일 "내용"의 SHA-1 해시(앞 12자리)를 public_id에 넣는다.
    // 같은 표본(id) 폴더에 같은 내용의 사진을 다시 올리면 public_id가 똑같아지고,
    // overwrite=false 이므로 Cloudinary가 새로 만들지 않고 기존 사진 정보를 그대로 돌려준다(existing: true).
    // → 파일 이름이 바뀌어도 내용이 같으면 중복으로 인식하고, 이름만 같고 내용이 다르면 별개 사진으로 취급한다.
    const contentHash = crypto.createHash("sha1").update(Buffer.from(fileBase64, "base64")).digest("hex").slice(0, 12);
    const publicId = `specimens/${id}/${contentHash}-${safeName}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = cloudinarySignature({ public_id: publicId, timestamp, overwrite: "false" }, API_SECRET);

    const form = new URLSearchParams();
    form.append("file", `data:${contentType || "application/octet-stream"};base64,${fileBase64}`);
    form.append("public_id", publicId);
    form.append("overwrite", "false");
    form.append("timestamp", String(timestamp));
    form.append("api_key", API_KEY);
    form.append("signature", signature);

    const bodyBuf = Buffer.from(form.toString(), "utf8");
    const res = await httpsPost(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { "Content-Type": "application/x-www-form-urlencoded" },
      bodyBuf
    );
    if (res.status !== 200) {
      throw new Error(`Cloudinary 업로드 실패 (${res.status}): ${res.body.substring(0, 300)}`);
    }
    const json = JSON.parse(res.body);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        duplicate: json.existing === true, // true면 이미 같은 사진이 있어서 새로 올리지 않고 건너뛴 것
        name: json.public_id.split("/").pop(),
        key: json.public_id,
        url: json.secure_url,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};