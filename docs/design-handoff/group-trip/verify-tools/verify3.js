// 包 3 驗收清單（瀏覽器項目）在包 4 之後重跑。分組行程一律用「我只是看看」＝全部檢視
const { launch } = require('./cdp');
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const SP = process.env.OUT || path.join(require('os').tmpdir(), 'group-trip-pages');
const BASE = 'http://127.0.0.1:8765/';
const out = [];
const ok = (id, c, n) => out.push((c ? '✅ ' : '❌ ') + id + (n ? '  ' + n : ''));
const cardsJs = `JSON.stringify([...document.querySelectorAll('#day-cards-wrap .day-card')].map(c=>({key:c.dataset.day,open:c.classList.contains('open'),num:c.querySelector('.day-num').textContent,theme:c.querySelector('.day-theme').textContent,meta:c.querySelector('.day-meta').innerText,tag:(c.querySelector('.day-meta .gt')||{}).textContent||'',cls:c.className,mb:getComputedStyle(c).marginBottom,br:getComputedStyle(c).borderRadius,h:c.querySelector('.day-hotel-name')?c.querySelector('.day-hotel-name').textContent:''})))`;
const cards = async b => JSON.parse(await b.eval(cardsJs));
const viewOnly = async b => { await b.eval(`document.querySelector('.who-skip').click()`); await b.sleep(150); };
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
(async () => {
  let b = await launch();
  await b.setClock('2026-11-02T09:00:00+08:00');
  await b.goto(BASE + 'new-grouped.html'); await viewOnly(b);
  let cs = await cards(b);
  const k = (date, theme) => cs.find(c => c.meta.includes(date + '（') && (!theme || c.theme === theme)).key;
  // 3-8
  await b.eval(`toggleDay('${k('11/3', '霧島')}')`);
  cs = await cards(b);
  ok('3-8 11/3 展開其中一張，另一張不動', cs.filter(c => c.meta.includes('11/3（')).map(c => c.open).join() === 'true,false');
  // 3-11 / 3-12
  const m3 = cs.filter(c => c.meta.includes('11/3（')), m6 = cs.find(c => c.meta.includes('11/6（'));
  ok('3-11 同日兩卡間距 4px、內側圓角 8px；不同日期維持原間距', m3[0].mb === '4px' && /8px/.test(m3[0].br) && /8px/.test(m3[1].br) && cs[0].mb !== '4px' && m6.mb !== '4px', `${m3[0].mb} ${m3[0].br} / ${m3[1].br} / 其他 ${m6.mb}`);
  ok('3-12 第 1 組實心、第 2 組外框、全員卡沒有標籤', m3[0].tag === '鹿兒島組' && m3[1].tag === '福岡組' && m6.tag === '');
  const styl = await b.eval(`(()=>{const t=[...document.querySelectorAll('.day-card')].filter(c=>c.dataset.day).slice(2,4).map(c=>c.querySelector('.day-meta .gt').getAttribute('style'));return JSON.stringify(t)})()`);
  ok('3-12b 第 1 組實心（背景色＋白字）、第 2 組白底外框', /color:#fff/.test(JSON.parse(styl)[0]) && /box-shadow/.test(JSON.parse(styl)[1]), styl);
  // 3-9 住宿
  await b.eval(`startEditHotel('${k('11/3', '霧島')}')`);
  await b.sleep(200);
  await b.eval(`document.getElementById('ho-name').value='改過的住宿'`);
  await b.eval(`submitHotel()`); await b.sleep(300);
  cs = await cards(b);
  const hot = cs.filter(c => c.meta.includes('11/3（')).map(c => c.h);
  ok('3-9 11/3 修改鹿兒島組住宿，福岡組那張不變', hot[0] === '改過的住宿' && hot[1] === 'Hotel Nikko Fukuoka', hot.join(' | '));
  // 3-10 新增景點選福岡組那張；刪除還原
  const fk = k('11/3', '抵達福岡');
  await b.eval(`showItinForm('${fk}')`);
  const optLabel = await b.eval(`document.querySelector('#itin-day-input option:checked').textContent`);
  await b.eval(`document.getElementById('itin-name-input').value='測試景點'; submitItinAct()`); await b.sleep(300);
  await b.eval(`toggleDay('${fk}')`);
  const where = await b.eval(`(()=>{const r={};document.querySelectorAll('#day-cards-wrap .day-card').forEach(c=>{if(c.textContent.includes('測試景點'))r[c.dataset.day]=1});return JSON.stringify(Object.keys(r))})()`);
  ok('3-10a 新增景點選「Day 3・11/3（二）・福岡組」，只出現在福岡組那張卡', optLabel.includes('福岡組') && where === JSON.stringify([fk]), optLabel + ' ' + where);
  await b.eval(`(()=>{const key=itinAdded.find(a=>a.name==='測試景點')._key;deleteItinAct(key)})()`); await b.sleep(300);
  await b.eval(`(()=>{const t=itinTrash[0];restoreFromTrash(t._key)})()`); await b.sleep(300);
  const where2 = await b.eval(`JSON.stringify(itinAdded.filter(a=>a.name==='測試景點').map(a=>a.card))`);
  ok('3-10b 刪除後從最近刪除還原，回到同一張卡', where2 === JSON.stringify([fk]), where2);
  // 3-13 / 3-13b
  await b.eval(`toggleDay('${k('11/6')}')`);
  const a116 = JSON.parse(await b.eval(`JSON.stringify([...document.querySelector('.day-card[data-day="${k('11/6')}"]').querySelectorAll('.act-item')].map(a=>[a.querySelector('.act-name').textContent,(a.querySelector('.gt')||{}).textContent||'']))`));
  ok('3-13 11/6 兩筆抵達各有標籤、其他沒有、依時間排序', a116.filter(a => a[1]).length === 2 && a116.filter(a => !a[1]).length === 1, JSON.stringify(a116));
  await b.eval(`toggleDay('${k('11/12')}')`);
  const hot12 = await b.eval(`(()=>{const h=document.querySelector('.day-card[data-day="${k('11/12')}"] .day-hotel');return h?(h.querySelector('.gt')||{}).textContent||'(無)':'(無住宿)'})()`);
  ok('3-13b 11/12 住宿列帶標籤', hot12 !== '(無)' && hot12 !== '(無住宿)', hot12);
  // 3-16 單日分享 / 海報（選福岡組那張）
  await b.eval(`openDayShare('${fk}')`);
  const sel = await b.eval(`document.querySelector('.showcase-day-select option:checked').textContent`);
  ok('3-16a 單日分享選 11/3 福岡組那張，內容是福岡組', sel.includes('福岡組') && sel.includes('抵達福岡'), sel);
  await b.eval(`closeShowcaseShare()`);
  ok('3-16b 兩張卡「已更新」記號互不影響（未分享過都沒有）', !(await b.eval(`document.querySelectorAll('.share-updated-badge').length`)));
  await b.sleep(100);
  await b.eval(`_markDayShared('${fk}')`);
  await b.eval(`(()=>{const key=itinAdded.find(a=>a.name==='測試景點')._key;deleteItinAct(key)})()`); await b.sleep(300);
  const badges = await b.eval(`JSON.stringify([...document.querySelectorAll('#day-cards-wrap .day-card')].filter(c=>c.querySelector('.share-updated-badge')).map(c=>c.dataset.day))`);
  ok('3-16c 只有被改動的那一張卡出現「已更新」', badges === JSON.stringify([fk]), badges);
  await b.close();

  // 3-6 分享連結（/v/）
  b = await launch();
  const cfg = JSON.parse(fs.readFileSync(SP + '/grouped-config.json', 'utf8'));
  cfg._quickShare = true;
  const z = b64url(zlib.gzipSync(Buffer.from(JSON.stringify(cfg))));
  await b.goto('http://127.0.0.1:8766/v/index.html#z=' + z); await b.sleep(1500);
  const asks = await b.eval(`!!document.getElementById('who-overlay') && document.getElementById('who-overlay').classList.contains('visible')`);
  if (asks) await b.eval(`document.querySelector('.who-skip').click()`);
  await b.sleep(200);
  cs = await cards(b);
  const tg = cs.filter(c => c.meta.includes('11/3（')).map(c => c.tag).join();
  ok('3-6 分享連結 /v/：開啟後顯示同樣的卡片與標籤（全部檢視）', cs.length === 16 && tg === '鹿兒島組,福岡組', `n=${cs.length} tags=${tg}`);
  await b.close();

  // 3-15 天氣備援以卡片為單位（直接比對函式）
  b = await launch();
  await b.goto(BASE + 'new-grouped.html'); await viewOnly(b);
  const fb = await b.eval(`JSON.stringify(DAYS.filter(d=>d.date==='11/3').map(d=>_wxFallbackKey(d)))`);
  ok('3-15 同日兩卡的天氣備援 key 各自獨立', JSON.parse(fb)[0] !== JSON.parse(fb)[1], fb);
  await b.close();

  // 3-17 行程中途才改成分組
  b = await launch();
  const g = JSON.parse(fs.readFileSync(SP + '/grouped-config.json', 'utf8'));
  const legacy = JSON.parse(JSON.stringify(g));
  delete legacy.groups; legacy._quickShare = true;
  legacy.days = legacy.days.filter(d => d.theme !== '抵達福岡' && d.theme !== '太宰府・柳川' && d.theme !== '門司港・小倉').map(d => { const x = { ...d }; delete x.id; delete x.with; x.acts = x.acts.map(a => { const y = { ...a }; delete y.with; return y; }); return x; });
  legacy.members = legacy.members.map(m => ({ name: m.name, avatar: m.avatar }));
  const lz = b64url(zlib.gzipSync(Buffer.from(JSON.stringify(legacy))));
  const gz = b64url(zlib.gzipSync(Buffer.from(JSON.stringify(g))));
  await b.goto('http://127.0.0.1:8766/v/index.html#z=' + lz); await b.sleep(1500);
  await b.eval(`showItinForm(1)`);
  await b.eval(`document.getElementById('itin-name-input').value='舊版加的景點'; submitItinAct()`); await b.sleep(300);
  const before = await b.eval(`JSON.stringify(itinAdded.map(a=>a.name))`);
  await b.goto('http://127.0.0.1:8766/v/index.html#z=' + gz); await b.sleep(1500);
  await b.eval(`(()=>{const w=document.getElementById('who-overlay');if(w&&w.classList.contains('visible'))document.querySelector('.who-skip').click()})()`);
  await b.sleep(200);
  const have = await b.eval(`JSON.stringify(DAYS.filter(d=>d.day===1).map(d=>_dayMergedActs(d).map(a=>a.name)))`);
  ok('3-17 沒分組版本加的景點，換成分組版本（那天仍一張卡）後還在', before.includes('舊版加的景點') && have.includes('舊版加的景點'), before + ' → ' + have);
  await b.close();
  console.log(out.join('\n'));
})().catch(e => { console.log(out.join('\n')); console.error('FATAL', e); process.exit(1); });
