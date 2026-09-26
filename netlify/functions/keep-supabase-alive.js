/**
 * Supabase 무료 플랜은 7일간 DB 요청이 없으면 프로젝트가 자동으로 일시정지됩니다.
 * 이 함수는 정해진 주기(아래 config.schedule)마다 자동으로 실행되어
 * specimens 테이블에 아주 가벼운 조회(1건만)를 날려서 "활동 중"으로 표시되게 합니다.
 * 사람이 직접 호출할 필요 없이 Netlify가 알아서 스케줄대로 실행합니다.
 *
 * 배포 방법:
 *   1) 이 파일을 다른 함수들과 같은 netlify/functions 폴더에 넣기
 *   2) 터미널에서 프로젝트 폴더(= netlify.toml이 있는 최상위 폴더)로 이동해서:
 *        npm install @netlify/functions
 *      실행 (package.json이 없다고 하면 먼저 `npm init -y` 한 번 실행)
 *   3) GitHub에 올리고 배포
 *
 * 확인 방법: Netlify 대시보드 → 해당 함수 → "Function log"에서 스케줄대로
 *          실행 기록이 쌓이는지 확인할 수 있습니다.
 */
const { schedule } = require("@netlify/functions");
const https = require("https");

const SUPABASE_URL = "https://rfyovtepspyseidktiea.supabase.co";
const SUPABASE_KEY = "sb_publishable_UU8vDCtULeR9XBb-wDgP0g_Ef7eDncE";

function ping(table) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`;
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "GET",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const handler = async function () {
  // 여러 테이블 중 하나만 조회해도 프로젝트 전체의 활동 타이머가 리셋됩니다.
  const status = await ping("specimens");
  console.log(`[keep-supabase-alive] specimens 테이블 조회 응답 코드: ${status}`);
  return { statusCode: 200, body: "ok" };
};

// 매주 일요일·수요일 00:00(UTC)에 실행 — 7일 한도보다 여유 있게 주 2회
exports.handler = schedule("0 0 * * 0,3", handler);
