// 視覺減量：App 端驗收（docs/acceptance/visual-cleanup.md 的 A、B、D）
// 自己產 7 款主題的頁面並起靜態伺服器，不需要先跑 make-pages.js。用法：node verify-visual-cleanup.js
const { launch } = require('./cdp');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const root = path.resolve(__dirname, '../../../..');
const SP = process.env.OUT || path.join(os.tmpdir(), 'visual-cleanup-pages');
fs.mkdirSync(SP, { recursive: true });
const out = [];
const ok = (id, cond, note) => out.push((cond ? '✅ ' : '❌ ') + id + (note ? '  ' + note : ''));
const J = x => JSON.stringify(x);

// ── 頁面：schema-example + 模擬後端（有 Firebase 才看得到集合／記帳分頁）──
const tmpl = fs.readFileSync(path.join(root, 'generator/template-src.html'), 'utf8');
const gen = fs.readFileSync(path.join(root, 'generator/generator-app.js'), 'utf8');
const mockFb = gen.match(/const PREVIEW_MOCK_FB = `([\s\S]*?)`;/)[1];
const THEMES = [...gen.matchAll(/\{ name: '([^']+)',\s+wa: '[^']+',\s+color: '(#\w+)', accent: '(#\w+)', light: '(#\w+)', bg: '(#\w+)', pale: '(#\w+)' \}/g)]
  .map(m => ({ name: m[1], color: m[2], accent: m[3], light: m[4], bg: m[5], pale: m[6] }));
if (THEMES.length !== 7) throw new Error('主題數量不對：' + THEMES.length);
const schema = JSON.parse(fs.readFileSync(path.join(root, 'generator/schema-example.json'), 'utf8'));
schema.members.forEach(m => { m.id = m.id || m.name; });
function page(t, fb) {
  const cfg = JSON.parse(JSON.stringify(schema));
  Object.assign(cfg.meta, { themeColor: t.color, themeAccent: t.accent, themeLight: t.light, bgColor: t.bg, bgPale: t.pale, pin: '0000' });
  cfg.firebase = fb ? { apiKey: 'AIza-demo-mock', databaseURL: 'https://demo-mock.firebaseio.com' } : {};
  if (!fb) cfg._quickShare = true;
  const m = cfg.meta;
  let h = tmpl.replace(/  <script src="https:\/\/www\.gstatic[^>]*><\/script>\n/g, '');
  if (fb) h = h.replace('<script>\n// ─── Trip Config', () => mockFb + '<script>\n// ─── Trip Config');
  return h
    .replace(/__TRIP_TITLE__/g, m.title).replace(/__SHORT_TITLE__/g, m.shortTitle)
    .replace(/__THEME_COLOR__/g, m.themeColor).replace(/__THEME_ACCENT__/g, m.themeAccent)
    .replace(/__THEME_LIGHT__/g, m.themeLight).replace(/__BG_COLOR__/g, m.bgColor)
    .replace(/__BG_PALE__/g, m.bgPale).replace(/__TRIP_HEADING__/g, m.heading || m.title)
    .replace(/__TRIP_SUBTITLE__/g, m.subtitle).replace(/__DATE_PILL__/g, m.datePill)
    .replace(/__DURATION_PILL__/g, m.durationPill).replace(/__PEOPLE_PILL__/g, m.peoplePill)
    .replace(/__TRIP_PIN__/g, '0000').split('__TRIP_CONFIG__').join(JSON.stringify(cfg))
    .replace(/  <script src="https:\/\/[^"]+"><\/script>\n/g, '');
}
THEMES.forEach((t, i) => fs.writeFileSync(path.join(SP, `t${i}.html`), page(t, true)));
const srv = http.createServer((q, r) => {
  const f = path.join(SP, path.basename(q.url.split('?')[0]));
  if (!fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(fs.readFileSync(f));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}/`;

// WCAG 對比
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = rgb => { const m = rgb.match(/\d+(\.\d+)?/g).map(Number); return '#' + m.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); };

const EMO = `/\\p{Extended_Pictographic}/u`;
const scanJs = `(()=>{const rx=${EMO};const res=new Set();
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=w.nextNode()){const t=n.nodeValue;if(!rx.test(t))continue;const p=n.parentElement;if(!p||p.closest('script,style'))continue;
    res.add((p.className||p.tagName)+' :: '+t.trim().replace(/\\s+/g,' ').slice(0,60));}
  document.querySelectorAll('[placeholder]').forEach(e=>{if(rx.test(e.placeholder))res.add('placeholder :: '+e.placeholder)});
  return JSON.stringify([...res])})()`;

(async () => {
  const b = await launch();
  await b.setClock('2026-04-10T09:00:00+08:00');
  await b.goto(BASE + 't6.html');   // 琥珀黃
  await b.eval(`window.alert=()=>{};window.confirm=()=>true`);
  const seen = new Set();
  const scan = async () => JSON.parse(await b.eval(scanJs)).forEach(x => seen.add(x));
  const sleep = () => b.sleep(150);

  // 密碼層與「你是誰」若擋著，先放行
  await b.eval(`(()=>{const p=document.getElementById('pin-overlay');if(p)p.style.display='none'})()`);
  await b.eval(`chooseWho(-1)`); await sleep();

  // ── 行程分頁 ──
  await b.eval(`DAYS.forEach(d=>openDays.add(_ck(d)));renderItinerary({cardsOnly:true})`); await sleep();
  const texts = sel => b.eval(`JSON.stringify([...document.querySelectorAll(${J(sel)})].map(e=>e.textContent.replace(/\\s+/g,' ').trim()))`).then(JSON.parse);
  const mapBtns = await texts('.map-btn:not(.park-btn)');
  ok('A1 地圖按鈕只剩文字', mapBtns.length > 0 && mapBtns.every(t => t === '地圖'), J([...new Set(mapBtns)]));
  await b.eval(`DAYS.forEach(d=>{d.selfDrive=true});renderItinerary({cardsOnly:true})`); await sleep();
  const parkBtns = await texts('.park-btn');
  ok('A1 停車按鈕只剩文字', parkBtns.length > 0 && parkBtns.every(t => t === '停車'), J([...new Set(parkBtns)]));
  await b.eval(`(()=>{const e=document.querySelector('.act-menu-btn');e.click()})()`); await sleep();
  ok('E4 自駕日的交通類活動沒有停車按鈕', await b.eval(`(()=>{const rows=[...document.querySelectorAll('.act-icon')].filter(e=>/[✈🚄🚅🚃🚆🚇🚈🚝🛫🛬🚢⛴🚤]/u.test(e.textContent));return rows.length>0&&rows.every(e=>{const it=e.closest('.act-item,.act-row,.act')||e.parentElement.parentElement;return !it.querySelector('.park-btn')})})()`));
  const menu = await texts('.act-menu-item');
  ok('A1 編輯／刪除選單只剩文字', menu.length > 0 && menu.every(t => ['編輯', '刪除'].includes(t)), J([...new Set(menu)]));
  const addBtns = await texts('.itin-add-btn, .slot-add-btn, .day-share-btn');
  ok('A1 新增景點／新增住宿／分享這天只剩文字', addBtns.length > 0 && addBtns.every(t => /^(新增景點|新增住宿|分享這天)/.test(t)), J([...new Set(addBtns)]));
  ok('A1 搜尋停車場按鈕只剩文字', (await b.eval(`[...document.querySelectorAll('.parking-search-btn, [onclick*="searchParking"], .parking-body button')].every(e=>!${EMO}.test(e.textContent))`)));
  ok('A2 建議餐廳／停車場資訊標題只剩文字', (await texts('.restaurant-header, .parking-header')).every(t => ['建議餐廳', '停車場資訊'].includes(t)));
  ok('A5 住宿列沒有 🏨', await b.eval(`document.querySelectorAll('.day-hotel .day-hotel-icon').length===0 && ![...document.querySelectorAll('.day-hotel')].some(e=>e.textContent.includes('🏨'))`));
  ok('A4 製作行程海報鈕只剩文字', (await texts('.showcase-entry-btn')).every(t => t === '製作行程海報'));
  await scan();
  await b.shot(SP + '/s-itinerary.png');

  // ── 表單 ──
  await b.eval(`showItinForm(${J(1)})`); await sleep();
  await scan();
  const title = id => b.eval(`document.getElementById(${J(id)}).textContent.trim()`);
  ok('A4 新增景點標題與送出鈕', (await title('itin-form-title')) === '新增景點' && (await b.eval(`/加入行程$/.test(document.querySelector('#itin-form-body .btn-pink').textContent.trim())&&!${EMO}.test(document.querySelector('#itin-form-body .btn-pink').textContent)`)));
  ok('A7 「到 Google 地圖找」只剩文字', await b.eval(`document.querySelector('#itin-form-body .map-find-btn').textContent.trim()==='到 Google 地圖找'`));
  await b.eval(`hideItinForm()`);
  await b.eval(`startAddHotel(${J(8)})`); await sleep(); await scan();
  ok('A4 新增住宿標題', (await title('hotel-form-title')) === '新增住宿');
  await b.eval(`hideHotelForm()`);
  await b.eval(`startEditHotel(${J(1)})`); await sleep();
  ok('A4 編輯住宿標題', (await title('hotel-form-title')) === '編輯住宿');
  await b.eval(`hideHotelForm()`);
  await b.eval(`openDayShare(${J(1)})`); await sleep(); await scan();
  ok('A4 分享這天標題與按鈕', (await title('showcase-form-title')) === '分享這天' && await b.eval(`!${EMO}.test(document.getElementById('showcase-send-btn').textContent)&&!${EMO}.test(document.getElementById('showcase-copy-btn').textContent)`));
  await b.eval(`closeShowcaseShare()`);
  await b.eval(`openShowcaseShare()`); await sleep(); await scan();
  ok('A4 製作行程海報標題', (await title('showcase-form-title')) === '製作行程海報');
  await b.eval(`closeShowcaseShare()`);

  // ── 清單 ──
  await b.eval(`switchTab('checklist')`); await sleep();
  for (const s of ['packing', 'shopping', 'notes']) { await b.eval(`switchChecklistTab(${J(s)})`); await sleep(); await scan(); }
  ok('A3 清單分頁鈕只剩文字', (await texts('.checklist-tab-btn')).slice(-3).every(t => ['打包', '購物', '注意事項'].includes(t)), J(await texts('.checklist-tab-btn')));
  await b.eval(`switchChecklistTab('shopping');showShoppingInput=true;renderShopping()`); await sleep(); await scan();
  await b.eval(`startAddNote()`); await sleep(); await scan();
  await b.eval(`hideNoteOverlay()`);
  await b.eval(`switchChecklistTab('packing')`); await sleep();
  ok('A2 行前清單標題只剩文字', (await texts('.sec-title')).some(t => /^行前清單/.test(t)));

  // ── 集合 ──
  await b.eval(`switchTab('meeting')`); await sleep(); await scan();
  await b.eval(`showMeetingForm()`); await sleep(); await scan();
  ok('A4 集合表單按鈕只剩文字', await b.eval(`[...document.querySelectorAll('#tab-meeting .btn-primary, [onclick*="submitMeeting"]')].some(e=>e.textContent.trim()==='送出通知')`));

  // ── 記帳 ──
  await b.eval(`switchTab('expenses')`); await sleep(); await scan();
  await b.eval(`showExpForm()`); await sleep(); await scan();
  ok('A4 新增記帳標題', (await title('exp-form-title')) === '新增記帳');
  await b.eval(`hideExpForm()`);
  await b.eval(`expShowSettle=true;renderExpenses()`); await sleep(); await scan();
  await b.eval(`expShowSettle=false;renderExpenses()`);
  await b.eval(`switchTab('itinerary')`);

  console.log('— 畫面上殘留的 emoji（請對照驗收文件「留下來」與「這包不動」兩份清單）—');
  [...seen].sort().forEach(x => console.log('  ' + x));

  // ── B：日卡主題 emoji ──
  const card = await b.eval(`JSON.stringify((()=>{const c=document.querySelector('.day-card');const e=c.querySelector('.day-emoji'),ch=c.querySelector('.day-chevron'),th=c.querySelector('.day-theme');
    const st=()=>({vis:getComputedStyle(e).visibility,x:Math.round(ch.getBoundingClientRect().left),tx:Math.round(th.getBoundingClientRect().left),w:Math.round(th.getBoundingClientRect().width)});
    c.classList.remove('open');const closed=st();c.classList.add('open');const open=st();return {closed,open,txt:e.textContent}})())`).then(JSON.parse);
  ok('B1 收合時顯示主題 emoji', card.closed.vis === 'visible' && card.txt.length > 0, J(card));
  ok('B2 展開後隱藏、標題列其他元素位置不變', card.open.vis === 'hidden' && card.open.x === card.closed.x && card.open.tx === card.closed.tx && card.open.w === card.closed.w, J(card));

  // ── D：七款主題對比 ──
  let allOk = true; const rows = [];
  for (let i = 0; i < THEMES.length; i++) {
    const t = THEMES[i];
    await b.goto(BASE + `t${i}.html`);
    await b.eval(`(()=>{const p=document.getElementById('pin-overlay');if(p)p.style.display='none'})()`);
    // 讓時間標籤、住宿未訂標籤、集合按鈕、橫幅都出現：用模擬資料塞一筆未訂與集合
    await b.eval(`DAYS.forEach(d=>openDays.add(_ck(d)));renderItinerary({cardsOnly:true})`);
    const probe = await b.eval(`JSON.stringify((()=>{
      const g=(el)=>{const s=getComputedStyle(el);return {c:s.color,bg:s.backgroundColor}};
      const tt=document.querySelector('.time-tag');
      const mk=document.createElement('span');mk.className='hotel-unbooked-tag';mk.textContent='住宿未訂';document.body.appendChild(mk);
      const pb=document.createElement('button');pb.className='btn btn-primary';document.body.appendChild(pb);
      const bn=document.getElementById('meeting-banner');
      return {time:g(tt),unb:g(mk),btn:g(pb),banner:getComputedStyle(bn).color,bannerBg:getComputedStyle(bn).backgroundImage,pinkDeep:getComputedStyle(document.documentElement).getPropertyValue('--pink-deep').trim()}})())`).then(JSON.parse);
    // 時間標籤背景是 --pale（不透明色）；其餘取計算值
    const timeC = cr(hex(probe.time.c), hex(probe.time.bg));
    const unbC = cr(hex(probe.unb.c), hex(probe.unb.bg));
    const btnC = cr(hex(probe.btn.c), hex(probe.btn.bg));
    const banC = [cr(hex(probe.banner), '#f59e0b'), cr(hex(probe.banner), '#f97316')];
    const pass = timeC >= 4.5 && unbC >= 4.5 && btnC >= 4.5 && banC.every(x => x >= 4.5);
    allOk = allOk && pass;
    rows.push(`${t.name}: 時間標籤 ${timeC.toFixed(2)}｜未訂標籤 ${unbC.toFixed(2)}｜集合按鈕 ${btnC.toFixed(2)}｜橫幅 ${banC.map(x => x.toFixed(2)).join('/')}｜深色 ${probe.pinkDeep}`);
    if (i === 6 || i === 3) {   // D5：實際畫面抽看（琥珀黃、櫻花粉）：未訂住宿、時間標籤、橫幅、集合按鈕
      await b.eval(`chooseWho(-1)`); await b.sleep(200);
      await b.eval(`startAddHotel(8)`); await b.sleep(150);
      await b.eval(`[...document.querySelectorAll('#hotel-form-body .member-pill')].find(x=>x.textContent.trim()==='還沒訂').click()`);
      await b.eval(`submitHotel()`); await b.sleep(250);
      await b.eval(`(()=>{const bn=document.getElementById('meeting-banner');bn.classList.add('visible');document.getElementById('banner-countdown').textContent='00:12:30';document.getElementById('banner-sub').textContent='小貓：櫻花公園門口集合'})()`);
      await b.eval(`DAYS.forEach(d=>openDays.add(_ck(d)));renderItinerary({cardsOnly:true});document.querySelector('.day-card[data-day="8"]').scrollIntoView()`); await b.sleep(250);
      await b.shot(SP + `/s-theme-${t.name}-day.png`);
      await b.eval(`window.scrollTo(0,0);switchTab('itinerary')`); await b.sleep(150);
      await b.shot(SP + `/s-theme-${t.name}-top.png`);
      await b.eval(`switchTab('meeting');showMeetingForm()`); await b.sleep(250);
      await b.shot(SP + `/s-theme-${t.name}-meeting.png`);
    }
  }
  ok('D1～D4 七款主題四處對比都 ≥ 4.5', allOk);
  rows.forEach(r => console.log('  ' + r));
  ok('頁面沒有執行錯誤', b.logs.filter(l => l.startsWith('EXC')).length === 0, J(b.logs.slice(0, 3)));

  await b.close(); srv.close();
  console.log(out.join('\n'));
  console.log(out.some(x => x.startsWith('❌')) ? '有未通過項目' : '全部通過');
})().catch(e => { console.error(e); process.exit(1); });
