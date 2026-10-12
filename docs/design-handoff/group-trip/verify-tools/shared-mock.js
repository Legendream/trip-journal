// 驗證用的「共用模擬後端」：讓多個瀏覽器（各自獨立的 Chrome 設定檔）連到同一份資料。
// 只給 verify5.js 用，不進產品程式。
//
//   const srv = await startServer({ pagesDir })   // 同時當作靜態頁面伺服器與資料庫
//   srv.url('new-grouped-fb.html')                // 頁面網址（內建的單頁模擬已換成連到這個伺服器的版本）
//   srv.db / srv.set(path, value) / srv.get(path) // 像「Firebase 主控台」一樣直接讀寫
//
// 頁面端：用 fetch 輪詢（約 80ms）＋寫入時先套本機再送出；以版號避免舊回應蓋掉新資料。
const http = require('http'), fs = require('fs'), path = require('path');

const seg = p => String(p || '').split('/').filter(Boolean);
function getAt(db, p) { let n = db; for (const s of seg(p)) { if (n == null || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : n; }
function setAt(db, p, v) {
  const a = seg(p); let n = db;
  for (let i = 0; i < a.length - 1; i++) { if (typeof n[a[i]] !== 'object' || n[a[i]] == null) n[a[i]] = {}; n = n[a[i]]; }
  if (v === null || v === undefined) delete n[a[a.length - 1]]; else n[a[a.length - 1]] = v;
}

const CLIENT = `<script>
(function(){
  let store = {}, ver = -1; const listeners = [];
  const seg = p => String(p || '').split('/').filter(Boolean);
  const getAt = p => { let n = store; for (const s of seg(p)) { if (n == null || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : n; };
  const setAt = (p, v) => { const a = seg(p); let n = store; for (let i = 0; i < a.length - 1; i++) { if (typeof n[a[i]] !== 'object' || n[a[i]] == null) n[a[i]] = {}; n = n[a[i]]; } if (v == null) delete n[a[a.length - 1]]; else n[a[a.length - 1]] = v; };
  const clone = v => v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
  function fire() {
    listeners.forEach(l => {
      const cur = JSON.stringify(getAt(l.path));
      if (cur !== l.last) { l.last = cur; l.cb({ val: () => clone(getAt(l.path)) }); }
    });
  }
  function apply(r) { if (r && r.ver > ver) { ver = r.ver; store = r.db || {}; fire(); } }
  function send(op) { return fetch('/__db/op', { method: 'POST', body: JSON.stringify(op) }).then(r => r.json()).then(apply).catch(() => {}); }
  let ready = false; const readyQ = [];   // 第一次讀到資料庫之前，監聽器不觸發（跟真的 Firebase 一樣：第一個 value 事件就帶著伺服器上的資料）
  fetch('/__db/get').then(r => r.json()).then(r => { apply(r); ready = true; readyQ.splice(0).forEach(f => f()); }).catch(() => {});
  setInterval(() => { fetch('/__db/get').then(r => r.json()).then(apply).catch(() => {}); }, 80);
  function ref(p) { return {
    on: (ev, cb) => {
      const l = { path: p, cb, last: undefined }; listeners.push(l);
      const start = () => { l.last = JSON.stringify(getAt(p)); cb({ val: () => clone(getAt(p)) }); };
      if (ready) setTimeout(start, 0); else readyQ.push(start);
    },
    set: v => { setAt(p, clone(v)); fire(); return send({ op: 'set', path: p, value: v }); },
    update: v => { setAt(p, Object.assign({}, getAt(p) || {}, clone(v))); fire(); return send({ op: 'update', path: p, value: v }); },
    remove: () => { setAt(p, null); fire(); return send({ op: 'remove', path: p }); },
    push: v => { const k = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); setAt(p + '/' + k, clone(v)); fire(); send({ op: 'set', path: p + '/' + k, value: v }); return { key: k }; },
  }; }
  window.firebase = { initializeApp(){}, database(){ return { ref }; } };
})();
</script>
`;

async function startServer({ pagesDir, port = 0 }) {
  let db = {}, ver = 0;
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u === '/__db/get') return json({ ver, db });
    if (u === '/__db/op' && req.method === 'POST') {
      let body = ''; req.on('data', c => body += c); req.on('end', () => {
        const o = JSON.parse(body || '{}');
        if (o.op === 'set') setAt(db, o.path, o.value);
        else if (o.op === 'update') setAt(db, o.path, Object.assign({}, getAt(db, o.path) || {}, o.value));
        else if (o.op === 'remove') setAt(db, o.path, null);
        ver++;
        json({ ver, db });
      });
      return;
    }
    const f = path.join(pagesDir, decodeURIComponent(u.slice(1)));
    if (!f.startsWith(pagesDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('404'); }
    let html = fs.readFileSync(f, 'utf8');
    if (/\.html$/.test(f)) {
      // 單頁模擬後端換成連到這個伺服器的版本
      html = html.replace(/<script>\n\(function\(\)\{\n  const store = \{\}; const listeners = \[\];[\s\S]*?<\/script>\n/, () => CLIENT);
    }
    res.setHeader('content-type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(html);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const p = server.address().port;
  return {
    port: p,
    url: name => `http://127.0.0.1:${p}/${name}`,
    get db() { return db; },
    get: pth => getAt(db, pth),
    set: (pth, v) => { setAt(db, pth, v); ver++; },
    reset: () => { db = {}; ver++; },
    close: () => server.close(),
  };
}
module.exports = { startServer };
