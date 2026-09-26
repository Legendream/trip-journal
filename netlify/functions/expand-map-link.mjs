// 展開 Google 地圖分享短網址（maps.app.goo.gl/…）→ 回傳轉址後的完整網址。
//
// 為什麼要伺服器端：分享短網址本身不含位置，要看它「轉址到哪裡」才知道；
// 瀏覽器受安全限制讀不到跨網站轉址的目標，所以由這支函式代讀。
// 所有使用者的行程 App（含各自部署的進階版）都呼叫這一支，會消耗本站額度，因此：
//   - 只接受 Google 地圖分享短網址，其他網址一律拒絕（不當成任意網址的代理）
//   - 只送 HEAD、不跟隨轉址、不下載任何網頁內容；逾時 5 秒放棄
//   - 成功結果放進 Netlify durable cache：同一條短網址之後由 CDN 直接回答，不再執行函式
//   - 不記錄使用者傳來的網址（本檔沒有任何 console 輸出）

const SHORT_RE = /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+\/?(?:\?[A-Za-z0-9_=&%.-]*)?$/;
// 轉址目標要是 Google 地圖；短網址偶爾會先轉到另一個 goo.gl 短網址，最多再跟一層
const GOOGLE_MAPS_RE = /^https:\/\/(?:www\.|maps\.)?google\.[a-z.]{2,6}\/maps[/?]/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function reply(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...(extra || {}) },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return reply(405, { error: 'method' });

  const input = (new URL(req.url).searchParams.get('u') || '').trim();
  if (!SHORT_RE.test(input)) return reply(400, { error: 'not_a_map_short_link' });

  let target = input;
  try {
    for (let hop = 0; hop < 2; hop++) {
      const r = await fetch(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      const loc = r.headers.get('location');
      if (r.status < 300 || r.status >= 400 || !loc) return reply(404, { error: 'not_found' });
      const next = new URL(loc, target).href;
      if (GOOGLE_MAPS_RE.test(next)) {
        return reply(200, { url: next }, {
          // 短網址對應的地點不會變：成功結果快取一年（durable＝跨 CDN 節點共用，命中時不執行函式）
          'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000',
          'Cache-Control': 'public, max-age=86400',
        });
      }
      if (!SHORT_RE.test(next)) return reply(422, { error: 'unexpected_target' });
      target = next;
    }
    return reply(422, { error: 'too_many_redirects' });
  } catch (e) {
    return reply(502, { error: 'upstream' });
  }
};
