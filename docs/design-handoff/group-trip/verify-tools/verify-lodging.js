// 住宿狀態與多晚操作：App 端驗收（docs/acceptance/lodging-status.md 的 A～E、H）
// 先跑 make-pages.js，並在 $OUT 啟動 http.server 8765；用 new-nogroup-fb.html（模擬後端，沒分組）與 new-grouped-fb.html（分組）
const { launch } = require('./cdp');
const fs = require('fs'), path = require('path'), os = require('os');
const SP = process.env.OUT || path.join(os.tmpdir(), 'group-trip-pages');
const BASE = 'http://127.0.0.1:8765/';
const out = [];
const ok = (id, cond, note) => out.push((cond ? '✅ ' : '❌ ') + id + (note ? '  ' + note : ''));
const J = x => JSON.stringify(x);

(async () => {
  const b = await launch();
  await b.setClock('2026-04-10T09:00:00+08:00');
  await b.goto(BASE + (process.env.PAGE || 'new-nogroup-fb.html'));
  await b.eval(`window.__alerts=[];window.__confirms=[];window.__confirmAns=true;window.alert=m=>window.__alerts.push(String(m));window.confirm=m=>{window.__confirms.push(String(m));return window.__confirmAns}`);
  const sleep = () => b.sleep(120);
  const hotel = day => b.eval(`(()=>{const h=_dayHotelInfo(_cardByKey(${J(day)}));return h?JSON.stringify(h):null})()`).then(x => x && JSON.parse(x));
  const clickPill = text => b.eval(`(()=>{const e=[...document.querySelectorAll('#hotel-form-body .member-pill')].find(x=>x.textContent.trim()===${J(text)});if(!e)return false;e.click();return true})()`);
  const setVal = (id, v) => b.eval(`(()=>{const e=document.getElementById(${J(id)});if(!e)return false;e.value=${J(v)};return true})()`);
  const rowInfo = day => b.eval(`(()=>{const c=document.querySelector('.day-card[data-day="${day}"]');if(!c)return null;const h=c.querySelector('.day-hotel');return JSON.stringify({
    row: h ? h.innerText.replace(/\\s+/g,' ').trim() : null, unbooked: !!(h && h.classList.contains('unbooked')),
    badge: h ? (h.querySelector('.hotel-paid-badge')||{}).textContent?.trim() || null : null,
    fill: !!(h && h.querySelector('.hotel-fill-btn')), tag: !!c.querySelector('.day-meta .hotel-unbooked-tag'),
    meta: c.querySelector('.day-meta').innerText.replace(/\\s+/g,' ') })})()`).then(x => x && JSON.parse(x));
  const alerts = () => b.eval(`window.__alerts.splice(0)`);
  const openAll = () => b.eval(`DAYS.forEach(d=>openDays.add(_ck(d)));renderItinerary({cardsOnly:true})`);
  await openAll();

  // ── A2／B4：舊行程沒有記號，視為已訂；「現場付」變「未付款」──
  let r = await rowInfo(1);
  ok('A2/B4 舊行程住宿：已訂、徽章「未付款」、沒有未訂標記', r && !r.unbooked && r.badge === '未付款' && !r.tag && !r.row.includes('現場付'), J(r));
  r = await rowInfo(6);
  ok('B4 已付清顯示「已付清」', r && r.badge === '已付清', J(r));
  ok('B6 沒有新增 emoji：未訂標記與按鈕沒有 emoji', !(await b.eval(`/\\p{Extended_Pictographic}/u.test(document.querySelector('.hotel-unbooked-tag')?.textContent||'')`)));

  // ── C1：新增住宿選「還沒訂」，名稱可不填 ──
  await b.eval(`startAddHotel(8)`);
  ok('C2 新增表單預設「已訂」，有付款選項', (await b.eval(`!!document.querySelector('#hotel-form-body .member-pill.selected')`)) && await b.eval(`document.getElementById('hotel-form-body').innerText.includes('付款狀態')`));
  await clickPill('還沒訂');
  ok('C2 選「還沒訂」時付款選項隱藏', !(await b.eval(`document.getElementById('hotel-form-body').innerText.includes('付款狀態')`)));
  ok('C5 備註提示文字是付款安排例子', (await b.eval(`document.getElementById('ho-note').placeholder`)).includes('11/1 刷尾款'));
  await b.eval(`submitHotel()`); await sleep();
  ok('C1 未填名稱存成未訂：沒跳警告', (await alerts()).length === 0);
  let h = await hotel(8);
  ok('A1 資料有 booked:false', h && h.booked === false && h.paid === false, J(h));
  r = await rowInfo(8);
  ok('B1 未訂：整塊底色列、顯示「住宿未訂」、有「填入住宿」按鈕', r && r.unbooked && r.row.includes('住宿未訂') && r.fill, J(r));
  ok('B2 日卡標題列有「住宿未訂」標記', r && r.tag, r && r.meta);
  ok('B3 未訂時沒有付款徽章', r && r.badge === null);
  // 收合時也看得到
  await b.eval(`openDays.delete(8);renderItinerary({cardsOnly:true})`);
  ok('B2b 收合時標題列仍看得到標記', await b.eval(`!!document.querySelector('.day-card[data-day="8"]:not(.open) .day-meta .hotel-unbooked-tag')`));
  await b.eval(`openDays.add(8);renderItinerary({cardsOnly:true})`);
  await b.shot(SP + '/s-lodging-unbooked.png');

  // ── A4／C3：改備註後仍未訂；改已訂要填名稱 ──
  await b.eval(`startEditHotel(8)`);
  await setVal('ho-note', '要訂的話看 11/1 的優惠');
  await b.eval(`submitHotel()`); await sleep();
  h = await hotel(8);
  ok('A4 只改備註後仍是未訂', h.booked === false && h.note.includes('11/1'), J(h));
  await b.eval(`startEditHotel(8)`);
  await clickPill('已訂');
  await b.eval(`submitHotel()`); await sleep();
  ok('C3 未訂 → 已訂沒填名稱：提示並沒有存', (await alerts()).some(a => a.includes('住宿名稱')) && (await hotel(8)).booked === false);
  await setVal('ho-name', '那霸測試飯店');
  await b.eval(`submitHotel()`); await sleep();
  h = await hotel(8);
  ok('C3b 填名稱後存成已訂（booked:true 明寫）', h.booked === true && h.name === '那霸測試飯店', J(h));
  r = await rowInfo(8);
  ok('B4b 已訂顯示「未付款」徽章、沒有標題列標記', r.badge === '未付款' && !r.tag && !r.unbooked, J(r));

  // ── C7：已訂（已付清）改回還沒訂 ──
  await b.eval(`startEditHotel(8)`);
  await clickPill('已付清');
  await b.eval(`submitHotel()`); await sleep();
  ok('C7a 先設已付清', (await hotel(8)).paid === true);
  await b.eval(`startEditHotel(8)`);
  await clickPill('還沒訂');
  await b.eval(`submitHotel()`); await sleep();
  h = await hotel(8);
  ok('C7 已訂改回還沒訂：名稱保留、付款清成未付款', h.booked === false && h.name === '那霸測試飯店' && h.paid === false, J(h));
  r = await rowInfo(8);
  ok('B1b 未訂且有名稱：同時顯示「住宿未訂」與名稱', r.row.includes('住宿未訂') && r.row.includes('那霸測試飯店'), r.row);

  // ── C6：刪除未訂後復原 ──
  await b.eval(`deleteHotel(8)`); await sleep();
  ok('C6a 刪除後該天沒有住宿', (await hotel(8)) === null);
  await b.eval(`doUndo()`); await sleep();
  h = await hotel(8);
  ok('C6 復原後仍是未訂、名稱保留', h && h.booked === false && h.name === '那霸測試飯店', J(h));

  // ── H1：未訂不出現在單日小卡 ──
  const drawn = async () => b.eval(`(async()=>{const t=[];const o=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(s,...a){t.push(String(s));return o.call(this,s,...a)};
    try{await drawShowcaseCanvas(document.createElement('canvas'),'day',8,'',null,null)}finally{CanvasRenderingContext2D.prototype.fillText=o}
    return JSON.stringify(t)})()`).then(JSON.parse);
  let texts = await drawn();
  ok('H1 未訂：單日小卡沒有住宿名稱', !texts.some(t => t.includes('那霸測試飯店')), J(texts.slice(-4)));
  await b.eval(`startEditHotel(8)`); await clickPill('已訂'); await b.eval(`submitHotel()`); await sleep();
  texts = await drawn();
  ok('H1b 已訂：單日小卡有住宿名稱（對照）', texts.some(t => t.includes('那霸測試飯店')));

  // ── D：複製到其他天 ──
  // 先把 8 號設回未訂，複製到 7（已訂：要問）與 3（已訂）
  await b.eval(`startEditHotel(8)`); await clickPill('還沒訂'); await b.eval(`submitHotel()`); await sleep();
  await b.eval(`startCopyHotel(8)`);
  const menuRows = await b.eval(`document.querySelectorAll('#hotel-form-body .ho-copy-cb').length`);
  ok('D2 複製面板列出其他 7 天、可勾選', menuRows === 7, String(menuRows));
  await b.eval(`document.querySelectorAll('.ho-copy-cb').forEach(c=>{if(['7','3'].includes(c.value))c.checked=true})`);
  await b.eval(`window.__confirmAns=false;submitCopyHotel()`); await sleep();
  ok('D3 目標天已有已訂住宿：取代前先問，答「否」就不動', (await b.eval(`window.__confirms.length`)) === 1 && (await hotel(7)).name === '仙台皇家公園酒店');
  await b.eval(`window.__confirmAns=true;submitCopyHotel()`); await sleep();
  const h7 = await hotel(7), h3 = await hotel(3);
  ok('D2b 答「是」後兩天都變成複製的住宿', h7.name === '那霸測試飯店' && h3.name === '那霸測試飯店', J([h7, h3]));
  ok('D6 複製未訂的卡，複製出來仍是未訂', h7.booked === false && h3.booked === false);
  // D7：目標是未訂佔位時直接取代，不問
  await b.eval(`window.__confirms.length=0;startCopyHotel(8)`);
  await b.eval(`document.querySelectorAll('.ho-copy-cb').forEach(c=>{c.checked=c.value==='7'})`);
  await b.eval(`submitCopyHotel()`); await sleep();
  ok('D7 目標天是未訂的佔位：直接取代不用問', (await b.eval(`window.__confirms.length`)) === 0);
  // D4：獨立
  await b.eval(`startEditHotel(7)`); await setVal('ho-note', '只改第 7 天'); await clickPill('已訂'); await b.eval(`hotelFormApply={}; ${'_sameHotelCards(hotelFormDay).forEach(d=>{hotelFormApply[String(_ck(d))]=false})'}`);
  await b.eval(`submitHotel()`); await sleep();
  ok('D4 改其中一晚不影響其他晚（取消勾選套用）', (await hotel(7)).note === '只改第 7 天' && (await hotel(3)).note !== '只改第 7 天' && (await hotel(8)).note !== '只改第 7 天');

  // ── E：套用到同一間的其他晚 ──
  // Day 1、2 同名「ホテル京阪仙台」備註各自不同；Day 4、5 另一間
  await b.eval(`startEditHotel(1)`);
  let listed = await b.eval(`[...document.querySelectorAll('#hotel-form-body .hotel-apply-row')].map(e=>e.innerText.trim())`);
  ok('E1 編輯 Day 1：列出同名的其他晚（Day 2），預設勾選', listed.length === 1 && listed[0].includes('Day 2') && await b.eval(`document.querySelector('#hotel-form-body .hotel-apply-row input').checked`), J(listed));
  await clickPill('已付清');
  await b.eval(`submitHotel()`); await sleep();
  h = await hotel(2);
  ok('E1b 套用：Day 2 也變已付清', h.paid === true, J(h));
  ok('E2 只套用改動的欄位：Day 2 的備註沒被蓋掉', h.note === '¥123,400（含4/15-16 兩晚）' && (await hotel(1)).note === '¥123,400（含4/16）');
  // E3：之後各自可編輯
  await b.eval(`startEditHotel(2)`); await setVal('ho-note', 'Day 2 自己改');
  await b.eval(`hotelFormApply={}; _sameHotelCards(hotelFormDay).forEach(d=>{hotelFormApply[String(_ck(d))]=false})`);
  await b.eval(`submitHotel()`); await sleep();
  ok('E3 套用後每晚仍可單獨編輯', (await hotel(2)).note === 'Day 2 自己改' && (await hotel(1)).note === '¥123,400（含4/16）');
  // 取消勾選
  await b.eval(`startEditHotel(4)`);
  await b.eval(`toggleHotelApply(5,false)`);
  await clickPill('已付清');
  await b.eval(`submitHotel()`); await sleep();
  ok('E1c 取消勾選的晚不套用', (await hotel(4)).paid === true && (await hotel(5)).paid === false);
  // E6：改名稱也能套用（用修改前的名稱比對）
  await b.eval(`startEditHotel(4)`);
  await setVal('ho-name', 'Fantastic Story 新館');
  await b.eval(`submitHotel()`); await sleep();
  ok('E6 改飯店名稱：以修改前名稱比對，套用到其他晚', (await hotel(5)).name === 'Fantastic Story 新館', (await hotel(5)).name);
  // E4：沒有同名其他晚就沒有清單
  await b.eval(`startEditHotel(6)`);
  ok('E4 沒有同名的其他晚：沒有「同時套用」清單', (await b.eval(`document.querySelectorAll('#hotel-form-body .hotel-apply-row').length`)) === 0);
  await b.eval(`hideHotelForm()`);
  // E6b：沒填名稱的未訂卡不算同一間
  await b.eval(`startAddHotel(8)`).catch(() => {});
  await b.eval(`deleteHotel(8)`); await sleep();
  await b.eval(`startAddHotel(8)`); await clickPill('還沒訂'); await b.eval(`submitHotel()`); await sleep();
  await b.eval(`startAddHotel(7)`).catch(() => {});
  await b.eval(`deleteHotel(7)`); await sleep();
  await b.eval(`startAddHotel(7)`); await clickPill('還沒訂'); await b.eval(`submitHotel()`); await sleep();
  await b.eval(`startEditHotel(8)`);
  ok('E6b 沒填名稱的未訂卡彼此不算同一間（沒有清單）', (await b.eval(`document.querySelectorAll('#hotel-form-body .hotel-apply-row').length`)) === 0);
  await b.eval(`hideHotelForm()`);

  // ── 版面：長備註換行（B5）──
  await b.eval(`startEditHotel(6)`); await setVal('ho-note', '現場付／11/1 刷尾款，先換卡方案，記得先到銀行網站把信用卡的海外刷卡額度調高並確認 3D 驗證可以收到簡訊，不然刷不過'); await b.eval(`submitHotel()`); await sleep();
  const wrap = await b.eval(`(()=>{const n=document.querySelector('.day-card[data-day="6"] .day-hotel-note');const r=n.getBoundingClientRect();return JSON.stringify({h:r.height,w:r.width,sw:n.scrollWidth,cw:n.clientWidth,doc:document.documentElement.scrollWidth})})()`).then(JSON.parse);
  ok('B5 長備註換行、不橫向溢出', wrap.h > 30 && wrap.doc <= 390, J(wrap));
  await b.shot(SP + '/s-lodging-longnote.png');

  // ── 不報錯 ──
  ok('無 JS 例外', !b.logs.some(l => l.startsWith('EXC')), J(b.logs.slice(0, 3)));
  await b.close();

  // ══ 分組行程 ══
  const g = await launch();
  await g.setClock('2026-10-15T09:00:00+08:00');
  await g.goto(BASE + 'new-grouped-fb.html');
  await g.eval(`window.alert=()=>{};window.confirm=()=>true`);
  await g.eval(`DAYS.forEach(d=>openDays.add(_ck(d)));`);
  const target = await g.eval(`(()=>{const d=DAYS.find(d=>!_dayHotelInfo(d));return d?_ck(d):null})()`);
  await g.eval(`startAddHotel(${J(target)})`);
  await g.eval(`hotelFormBooked=false;renderHotelFormBody();submitHotel()`); await g.sleep(150);
  const tags = await g.eval(`JSON.stringify([...document.querySelectorAll('.day-card')].filter(c=>c.querySelector('.hotel-unbooked-tag')).map(c=>c.dataset.day))`).then(JSON.parse);
  ok('B7 分組行程：標記只出現在該張卡', tags.length === 1 && tags[0] === String(target), J([tags, target]));
  await g.close();

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('❌')) ? '\n有 ❌' : '\n全部通過');
})().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(1); });
