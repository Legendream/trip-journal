// 包 5 驗收清單 5-1 … 5-20 的瀏覽器驗證（headless Chrome，行動尺寸 390×844）
// 需要「兩個以上的瀏覽器連同一個後端」：用 shared-mock.js 的共用模擬後端（不進產品程式）。
// 用法：先 node make-pages.js，再 node verify5.js。輸出每行 ✅／❌，沒有 ❌ 才算過。
// 5-21（拿掉閘門）與 5-22（包 3、4 回歸）不在這支：5-21 看 test-group-trip.js 與產生器畫面，5-22 跑 verify3／verify4。
const { launch } = require('./cdp');
const { startServer } = require('./shared-mock');
const fs = require('fs'), path = require('path');
const SP = process.env.OUT || path.join(require('os').tmpdir(), 'group-trip-pages');
const cfg = JSON.parse(fs.readFileSync(path.join(SP, 'grouped-config.json'), 'utf8'));
const PFX = cfg.meta.storagePrefix;
const [CAT, BEAR, FISH, DEER] = cfg.members.map(m => m.id);     // 小貓、阿熊（鹿兒島組）；小魚、阿鹿（福岡組）
const out = [];
let fails = 0;
const ok = (id, cond, note) => { if (!cond) fails++; const line = (cond ? '✅ ' : '❌ ') + id + (note ? '  ' + note : ''); out.push(line); console.log(line); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sj = o => JSON.stringify(o);

let srv;
const open = async (page, who, clock) => {   // who: 0..3 成員序號；-1 我只是看看；null 不選
  const b = await launch();
  await b.setClock(clock);
  await b.goto(srv.url(page));
  await b.eval(`window.__rings = []; (function(){ const o = triggerAlarm; triggerAlarm = function(m){ window.__rings.push(m.time); return o.apply(this, arguments); }; })()`);
  if (who !== null) await b.eval(`chooseWho(${who})`);
  await sleep(300);
  return b;
};
const T4 = '2026-11-04T17:28:30';
const meetText = b => b.eval(`document.getElementById('tab-meeting').innerText`);
const bigCards = b => b.eval(`JSON.stringify([...document.querySelectorAll('#tab-meeting .meeting-active-card')].map(c => c.querySelector('.meeting-time-row').innerText.trim()))`).then(JSON.parse);
const smallCards = b => b.eval(`JSON.stringify([...document.querySelectorAll('#tab-meeting .meeting-small')].map(c => ({ t: c.querySelector('.meeting-small-time').innerText.trim(), tag: (c.querySelector('.gt')||{}).textContent||'', mute: !!c.querySelector('.meeting-mute') })))`).then(JSON.parse);
const btnTexts = b => b.eval(`JSON.stringify([...document.querySelectorAll('#tab-meeting .meeting-actions button')].map(x => x.textContent.trim()))`).then(JSON.parse);
const banner = b => b.eval(`JSON.stringify({ vis: document.getElementById('meeting-banner').classList.contains('visible'), sub: document.getElementById('banner-sub').textContent, cd: document.getElementById('banner-countdown').textContent })`).then(JSON.parse);
const fillMeeting = (b, time, msg) => b.eval(`document.getElementById('m-time').value = ${sj(time)}; document.getElementById('m-msg').value = ${sj(msg || '')};`);
const meetings = () => srv.get(PFX + '/meetings') || {};
const meetList = () => Object.entries(meetings()).map(([k, v]) => ({ key: k, ...v }));

(async () => {
  srv = await startServer({ pagesDir: SP });
  const toClose = [];
  const O = async (...a) => { const b = await open(...a); toClose.push(b); return b; };
  try {
    // ───────── 集合：5-1 ～ 5-9 ─────────
    const A = await O('new-grouped-fb.html', 0, T4);
    const B = await O('new-grouped-fb.html', 2, T4);
    const C = await O('new-grouped-fb.html', 1, T4);
    const D = await O('new-grouped-fb.html', 3, T4);

    // 5-1 小貓發起 17:30（預設通知鹿兒島組）、小魚發起 18:00（福岡組）
    ok('5-1a 11/4 發起集合時「通知誰」預設是我當天那張卡的組別', (await A.eval('meetNotifyMode')) === 'g0' && (await B.eval('meetNotifyMode')) === 'g1');
    await fillMeeting(A, '17:30', '7-11 旁邊'); await A.eval('submitMeeting()');
    await fillMeeting(B, '18:00', '福岡組集合'); await B.eval('submitMeeting()');
    await sleep(700);
    const ml = meetList();
    const m1730 = ml.find(m => m.time === '17:30'), m1800 = ml.find(m => m.time === '18:00');
    ok('5-1b 兩筆並存、互不覆蓋，各存發起者與通知對象', ml.length === 2 && m1730 && m1800 && m1730.setBy === CAT && sj(m1730.notify) === sj([CAT, BEAR]) && m1800.setBy === FISH && sj(m1800.notify) === sj([FISH, DEER]), sj(ml.map(m => [m.time, m.setBy, m.notify])));

    // 5-2 小貓的畫面
    const aBig = await bigCards(A), aSmall = await smallCards(A), aBan = await banner(A);
    ok('5-2 小貓：17:30 大卡＋橫幅倒數；18:00 小卡帶福岡組標籤與不響鈴圖示', aBig.length === 1 && aBig[0].includes('17:30') && aSmall.length === 1 && aSmall[0].t.includes('18:00') && aSmall[0].tag === '福岡組' && aSmall[0].mute && aBan.vis && aBan.sub.includes('17:30') && aBan.cd.includes('距集合'), sj([aBig, aSmall, aBan]));
    await A.eval(`switchTab('meeting')`); await sleep(200); await A.shot(SP + '/s-5-2-xiaomao-meeting.png');

    // 5-9 已選身分：表單沒有「你的名字」，卡片顯示「由 小貓 設定」
    await A.eval('showMeetingForm()');
    ok('5-9a 已選身分：表單沒有「你的名字」欄位', (await A.eval(`!document.getElementById('m-by')`)));
    ok('5-9b 卡片顯示「由 小貓 設定」', (await meetText(A)).includes('由 小貓 設定'));
    await A.eval('hideMeetingForm()');

    // 5-4 取消只有發起者；5-7 更新時間發起者與被通知的人
    const cBtn = await btnTexts(C), bBtn = await btnTexts(B), aBtn = await btnTexts(A);
    ok('5-4a 小貓看得到 17:30 的「取消集合」；阿熊看不到', aBtn.includes('✕ 取消集合') && !cBtn.includes('✕ 取消集合'), sj([aBtn, cBtn]));
    ok('5-7a 被通知的阿熊看得到「更新時間」；沒被通知的小魚看不到 17:30 的更新', cBtn.includes('✏️ 更新時間'), sj([cBtn, bBtn]));
    const bHas1730Update = await B.eval(`[...document.querySelectorAll('#tab-meeting .meeting-small')].some(c => c.innerText.includes('17:30') && c.parentElement.innerText.includes('更新時間'))`);
    ok('5-7a2 小魚的 17:30 小卡沒有更新鈕', !bHas1730Update);

    // 5-7 阿熊更新 17:30：帶出原本時間、備註、通知誰；補上阿鹿
    await C.eval(`showMeetingForm(${sj(m1730.key)})`);
    const form = JSON.parse(await C.eval(`JSON.stringify({ t: document.getElementById('m-time').value, m: document.getElementById('m-msg').value, mode: meetNotifyMode })`));
    ok('5-7b 更新表單帶出原本的時間、備註、通知誰', form.t === '17:30' && form.m === '7-11 旁邊' && form.mode === 'g0', sj(form));
    await C.eval(`setMeetNotify('custom')`);
    const ids0 = await C.eval('meetNotifyIds.length');
    await C.eval(`toggleMeetNotify(3)`);   // 阿鹿
    await C.eval('submitMeeting()');
    await sleep(700);
    const upd = meetings()[m1730.key];
    ok('5-7c 補上阿鹿後存成四人中的三人，發起者不變', ids0 === 2 && upd && sj(upd.notify) === sj([CAT, BEAR, DEER]) && upd.setBy === CAT, sj(upd));
    const dBan = await banner(D);
    ok('5-7d 阿鹿的裝置出現 17:30 橫幅', dBan.vis && dBan.sub.includes('17:30'), sj(dBan));
    ok('5-8 同時有兩筆通知阿鹿的集合：橫幅顯示時間較近的 17:30', dBan.sub.includes('17:30') && !dBan.sub.includes('18:00'));

    // 5-3 到時間：小貓、阿熊、（補上的）阿鹿響鈴；小魚不響
    for (let i = 0; i < 200; i++) {
      const past = await Promise.all([A, B, C, D].map(b => b.eval(`new Date().getHours()*3600+new Date().getMinutes()*60+new Date().getSeconds() >= 17*3600+30*60+4`)));
      if (past.every(Boolean)) break;
      await sleep(1000);
    }
    await sleep(1500);
    const rings = await Promise.all([A, B, C, D].map(b => b.eval('window.__rings.length')));
    ok('5-3 17:30 到時：小貓、阿熊、阿鹿響鈴一次；小魚不響', sj(rings) === sj([1, 0, 1, 1]), sj(rings));

    // 5-4b 小貓取消後兩邊都消失
    await A.eval(`clearMeeting(${sj(m1730.key)})`);
    await sleep(700);
    ok('5-4b 小貓取消 17:30 後，資料庫與阿熊、阿鹿的畫面都沒有了', !meetings()[m1730.key] && (await bigCards(C)).length === 0 && !(await meetText(D)).includes('17:30'));

    // 5-6 過了集合時間 30 分鐘自動收起（18:00 那筆）
    const E1 = await O('new-grouped-fb.html', 2, '2026-11-04T18:29:00');
    ok('5-6a 18:29（集合後 29 分鐘）還看得到', (await bigCards(E1)).some(t => t.includes('18:00')));
    const E2 = await O('new-grouped-fb.html', 2, '2026-11-04T18:31:00');
    ok('5-6b 18:31（集合後 31 分鐘）已收起，橫幅也沒有', (await bigCards(E2)).length === 0 && !(await banner(E2)).vis);
    // 同一頁不重新整理也會收起：把時鐘撥到 18:29:50，等它走過 18:30
    const E3 = await O('new-grouped-fb.html', 2, '2026-11-04T18:29:56');
    const before = (await bigCards(E3)).length;
    await sleep(6500);
    ok('5-6c 不重新整理，過了 30 分鐘也自動收起', before === 1 && (await bigCards(E3)).length === 0 && !(await banner(E3)).vis, 'before=' + before);

    // 5-5 未選身分的人發起的集合，任何人都能取消
    const F = await O('new-grouped-fb.html', -1, '2026-11-04T17:40:00');
    await F.eval('showMeetingForm()');
    ok('5-5a 未選身分：表單有「你的名字」欄位', await F.eval(`!!document.getElementById('m-by')`));
    await fillMeeting(F, '19:00', '路人集合'); await F.eval(`document.getElementById('m-by').value = '路人甲'; submitMeeting()`);
    await sleep(700);
    const mF = meetList().find(m => m.time === '19:00');
    ok('5-5b 記錄的發起者欄位是空的，帶名字', mF && mF.setBy === '' && mF.setByName === '路人甲', sj(mF));
    const cBtn2 = await C.eval(`[...document.querySelectorAll('#tab-meeting .meeting-item')].filter(i => i.innerText.includes('19:00')).some(i => i.innerText.includes('取消集合'))`);
    ok('5-5c 阿熊也看得到這筆的「取消集合」', cBtn2);
    ok('5-5d 未選身分的人視為每個集合都有通知他（18:00 福岡組那筆也是大卡）', (await bigCards(F)).some(t => t.includes('18:00')));

    // 5-10 舊路徑 meeting
    srv.reset();
    srv.set(PFX + '/meeting', { time: '19:30', message: '舊版集合', setBy: '老王', setAt: new Date(2026, 10, 4, 17, 0).getTime() });
    const G = await O('new-grouped-fb.html', 1, '2026-11-04T17:40:00');
    const gText = await meetText(G);
    ok('5-10a 舊路徑有資料時看得到（通知全員、由老王設定）', gText.includes('19:30') && gText.includes('舊版集合') && gText.includes('由 老王 設定') && (await banner(G)).sub.includes('19:30'));
    ok('5-10b 誰都能取消，取消後舊路徑被清掉', (await btnTexts(G)).includes('✕ 取消集合') && (await G.eval(`clearMeeting('__legacy'); 1`), await sleep(500), srv.get(PFX + '/meeting') === null));

    // 5-11 沒分組行程
    srv.reset();
    const H = await O('new-nogroup-fb.html', 0, '2026-11-04T17:00:00');
    await H.eval(`switchTab('meeting')`);
    const noNotify = await H.eval(`!document.getElementById('tab-meeting').innerText.includes('通知誰') && !document.querySelector('#tab-meeting .gt')`);
    const PFX_H = await H.eval('_PFX');
    await fillMeeting(H, '17:30', 'a'); await H.eval('submitMeeting()'); await sleep(300);
    await H.eval('showMeetingForm()');
    const noNotify2 = await H.eval(`!document.getElementById('tab-meeting').innerText.includes('通知誰')`);
    await fillMeeting(H, '18:00', 'b'); await H.eval('submitMeeting()'); await sleep(500);
    ok('5-11 沒分組行程：集合表單沒有「通知誰」、沒有標籤；兩筆可同時存在', noNotify && noNotify2 && Object.keys(srv.get(PFX_H + '/meetings') || {}).length === 2 && (await bigCards(H)).length === 2 && !(await H.eval(`!!document.querySelector('#tab-meeting .gt')`)));

    // ───────── 換卡同步：5-12 ～ 5-14 ─────────
    srv.reset();
    const S1 = await O('new-grouped-fb.html', 2, '2026-11-04T10:00:00');   // 小魚
    const S2 = await O('new-grouped-fb.html', 1, '2026-11-04T10:00:00');   // 阿熊
    await S1.eval(`setView('all')`);
    const tagsOf = b => b.eval(`JSON.stringify(_sameDayCards(4).map(c => { const el = document.querySelector('.day-card[data-day="' + _ck(c) + '"] .day-meta .gt'); return el ? el.textContent : ''; }))`).then(JSON.parse);
    const t0 = await tagsOf(S1);
    await S2.eval(`openSwap(4)`);
    const swapTxt = await S2.eval(`document.getElementById('swap-body').innerText`);
    const toFukuoka = await S2.eval(`_sameDayCards(4).findIndex(c => describeList(c.with, GROUPS, GMEMBERS).group && describeList(c.with, GROUPS, GMEMBERS).group.name === '福岡組')`);
    await S2.eval(`chooseSwap(4, ${toFukuoka})`);
    await sleep(700);
    const t1 = await tagsOf(S1);
    const ovr = srv.get(PFX + '/overrides/' + BEAR);
    ok('5-12a 換卡存到 overrides/<成員id>/<day>', ovr && Object.values(ovr).length === 1, sj(srv.get(PFX + '/overrides')));
    ok('5-12b 小魚的「全部」檢視立刻看到名單變動（福岡組那張變成阿熊＋小魚＋阿鹿、鹿兒島組只剩小貓）', sj(t0) === sj(['鹿兒島組', '福岡組']) && t1[0].includes('🐱') && !t1[0].includes('🐻') && t1[1].includes('🐻') && t1[1].includes('🐟') && t1[1].includes('🦌'), sj([t0, t1]));
    ok('5-12c 換卡面板沒有「只有這支手機會換」', !swapTxt.includes('只有這支手機會換') && swapTxt.includes('這天跟誰走？'));

    // 5-13 阿熊在 11/4 發起集合：預設通知福岡組那張卡的人（含阿熊）
    await S2.eval(`switchTab('meeting')`);
    await sleep(200);
    const mode = await S2.eval(`JSON.stringify({ mode: meetNotifyMode, ids: meetNotifyIds })`);
    const mj = JSON.parse(mode);
    ok('5-13 換卡後發起集合，預設通知的是福岡組那張卡的人（含阿熊）', mj.mode === 'custom' && sj([...mj.ids].sort()) === sj([BEAR, FISH, DEER].sort()), mode);

    // 5-14 兩人（同一人的兩支手機）同時換卡，後存的為準、兩邊最後一致
    const S3 = await O('new-grouped-fb.html', 1, '2026-11-04T10:00:00');
    await Promise.all([S2.eval(`chooseSwap(4, 0)`), S3.eval(`chooseSwap(4, 1)`)]);
    await sleep(900);
    const [o2, o3] = await Promise.all([S2.eval(`JSON.stringify(OVERRIDES)`), S3.eval(`JSON.stringify(OVERRIDES)`)]);
    const dbOvr = JSON.stringify(srv.get(PFX + '/overrides'));
    ok('5-14 同時換卡：兩邊與資料庫最後一致', o2 === o3 && o2 === dbOvr, sj([o2, o3, dbOvr]));

    // 手機上既有的換卡（包 4 存在手機上的）第一次連上時寫進去一次
    srv.reset();
    const M = await launch(); toClose.push(M);
    await M.setClock('2026-11-04T10:00:00');
    await M.goto(srv.url('new-grouped-fb.html'));
    const c4b = await M.eval(`_ck(_sameDayCards(4)[1])`);
    await M.eval(`localStorage.setItem(${sj(PFX + '-overrides-v1')}, JSON.stringify({ ${sj(CAT)}: { 4: ${sj(c4b)} } }))`);
    await M.goto(srv.url('new-grouped-fb.html'));
    await sleep(800);
    ok('5-12d 手機上既有的換卡第一次連上時寫進雲端，並清掉手機上的紀錄', srv.get(PFX + '/overrides/' + CAT + '/4') === c4b && (await M.eval(`localStorage.getItem(${sj(PFX + '-overrides-v1')})`)) === null);

    // ───────── 記帳：5-15 ～ 5-19 ─────────
    srv.reset();
    const X = await O('new-grouped-fb.html', 0, '2026-11-04T12:00:00');
    await X.eval(`switchTab('expenses'); showExpForm()`);
    const d1 = JSON.parse(await X.eval(`JSON.stringify({ payer: expFormPayer, who: [...expFormForWhom] })`));
    ok('5-15a 11/4 小貓新增記帳：付款人預設小貓，分擔預設鹿兒島組', d1.payer === CAT && sj(d1.who.sort()) === sj([CAT, BEAR].sort()), sj(d1));
    const X8 = await O('new-grouped-fb.html', 0, '2026-11-08T12:00:00');
    await X8.eval(`switchTab('expenses'); showExpForm()`);
    const d8 = JSON.parse(await X8.eval(`JSON.stringify({ payer: expFormPayer, who: [...expFormForWhom] })`));
    const X20 = await O('new-grouped-fb.html', 0, '2026-12-20T12:00:00');
    await X20.eval(`switchTab('expenses'); showExpForm()`);
    const d20 = JSON.parse(await X20.eval(`JSON.stringify({ who: [...expFormForWhom] })`));
    ok('5-15b 11/8 預設全員；行程日期外預設全員', d8.who.length === 4 && d20.who.length === 4);
    // 沒動過分擔就換付款人：預設跟著走
    await X.eval(`selectExpPayer(2)`);
    const dSw = JSON.parse(await X.eval(`JSON.stringify([...expFormForWhom])`));
    ok('5-15c 還沒動分擔名單就換付款人（小魚）：預設改成福岡組', sj(dSw.sort()) === sj([FISH, DEER].sort()), sj(dSw));
    await X.eval(`selectExpPayer(0)`);

    // 5-16 新增記帳存成員 id 與當時的名字
    await X.eval(`document.getElementById('exp-amount-input').value = '1200'; document.getElementById('exp-note-input').value = '晚餐'; submitExpense()`);
    await sleep(600);
    const exps = Object.values(srv.get(PFX + '/expenses') || {});
    const e0 = exps[0] || {};
    ok('5-16 新記帳：payer、forWhom 是成員 id，並有 names', exps.length === 1 && e0.payer === CAT && sj(e0.forWhom.slice().sort()) === sj([CAT, BEAR].sort()) && e0.names && e0.names[CAT] === '小貓' && e0.names[BEAR] === '阿熊', sj(e0));

    // 5-17 舊名字紀錄相容，結算與同一人的新紀錄合併
    srv.set(PFX + '/expenses/old1', { currency: 'JPY', payer: '阿熊', forWhom: ['小貓', '阿熊'], amount: 600, note: '舊帳', timestamp: 1 });
    srv.set(PFX + '/expenses/old2', { currency: 'JPY', payer: '路人乙', forWhom: ['小貓', '路人乙'], amount: 200, note: '對不上', timestamp: 2 });
    const Y = await O('new-grouped-fb.html', 0, '2026-11-04T12:00:00');
    await Y.eval(`switchTab('expenses')`);
    await sleep(300);
    const list = await Y.eval(`document.getElementById('tab-expenses').innerText`);
    await Y.eval(`expShowSettle = true; renderExpenses()`);
    const settle = await Y.eval(`document.getElementById('tab-expenses').innerText`);
    const rows = JSON.parse(await Y.eval(`JSON.stringify([...document.querySelectorAll('.settle-row')].map(r => r.innerText.replace(/\\s+/g,' ')))`));
    // 小貓付 1200 分給小貓、阿熊（各 600）；阿熊付 600 分給小貓、阿熊（各 300）；路人乙付 200 分給小貓、路人乙（各 100）
    // 小貓 +1200-600-300-100 = 200；阿熊 -600+600-300 = -300；路人乙 +200-100 = +100
    ok('5-17a 舊紀錄正常顯示（名字對得上成員；對不上的顯示原名字）', list.includes('阿熊') && list.includes('舊帳') && list.includes('路人乙'));
    ok('5-17b 結算以成員為單位合併新舊紀錄：阿熊還小貓 200、還路人乙 100', rows.length === 2 && rows.some(r => r.includes('阿熊') && r.includes('小貓') && r.includes('200')) && rows.some(r => r.includes('阿熊') && r.includes('路人乙') && r.includes('100')), sj(rows));

    // 5-18 改代號：以 id 存的紀錄顯示新代號、金額不變；5-19 刪除成員：舊帳仍顯示當時的名字、結算仍計入
    srv.reset();
    srv.set(PFX + '/expenses/n1', { currency: 'JPY', payer: BEAR, forWhom: [CAT, BEAR, FISH], names: { [CAT]: '小貓', [BEAR]: '阿熊', [FISH]: '小魚' }, amount: 900, note: '新帳', timestamp: 1 });
    const variant = (fn, name) => {   // 以「分組＋Firebase 模擬」頁面為底，改設定檔後另存
      const html = fs.readFileSync(path.join(SP, 'new-grouped-fb.html'), 'utf8');
      const m = /^const _CFG = (.*);$/m.exec(html);
      const c = JSON.parse(m[1]); fn(c);
      fs.writeFileSync(path.join(SP, name), html.replace(m[0], () => 'const _CFG = ' + JSON.stringify(c) + ';'));
    };
    variant(c => { c.members.find(m => m.id === CAT).name = '貓貓'; }, 'variant-renamed.html');
    variant(c => { c.members = c.members.filter(m => m.id !== FISH); c.groups.forEach(g => { g.memberIds = g.memberIds.filter(i => i !== FISH); }); c.days.forEach(d => { (d.with || []).includes(FISH) && (d.with = d.with.filter(i => i !== FISH)); }); }, 'variant-deleted.html');
    const R = await O('variant-renamed.html', 1, '2026-11-04T12:00:00');
    await R.eval(`switchTab('expenses')`); await sleep(300);
    const rList = await R.eval(`document.getElementById('tab-expenses').innerText`);
    await R.eval(`expShowSettle = true; renderExpenses()`);
    const rRows = JSON.parse(await R.eval(`JSON.stringify([...document.querySelectorAll('.settle-row')].map(r => r.innerText.replace(/\\s+/g,' ')))`));
    ok('5-18 改代號後：記帳與結算都顯示新代號，金額不變（阿熊付 900 分三人，各 300）', rList.includes('阿熊') === true && rRows.length === 2 && rRows.every(r => r.includes('300') && r.includes('阿熊')) && rRows.some(r => r.includes('貓貓')) && !rRows.some(r => r.includes('小貓')), sj(rRows));
    const Dl = await O('variant-deleted.html', 1, '2026-11-04T12:00:00');
    await Dl.eval(`switchTab('expenses')`); await sleep(300);
    const dList = await Dl.eval(`document.getElementById('tab-expenses').innerText`);
    await Dl.eval(`expShowSettle = true; renderExpenses()`);
    const dRows = JSON.parse(await Dl.eval(`JSON.stringify([...document.querySelectorAll('.settle-row')].map(r => r.innerText.replace(/\\s+/g,' ')))`));
    ok('5-19 刪除成員後：舊帳仍顯示當時的名字（小魚），結算仍計入', dList.includes('小魚') && dRows.length === 2 && dRows.some(r => r.includes('小魚') && r.includes('300')), sj([dRows]));
    // 編輯有已刪除成員的舊帳：不會把他默默拿掉
    await Dl.eval(`expShowSettle = false; renderExpenses(); editExpense('n1')`);
    const keep = JSON.parse(await Dl.eval(`JSON.stringify([...expFormForWhom])`));
    ok('5-19b 編輯含已刪除成員的舊帳：分擔名單仍含他（顯示「已不在名單」）', keep.includes(FISH) && (await Dl.eval(`document.getElementById('exp-form-body').innerText`)).includes('已不在名單'));

    // ───────── 5-20 沒有 Firebase 的分組行程 ─────────
    srv.reset();
    const N = await O('new-grouped.html', 0, '2026-11-04T10:00:00');
    const hid = await N.eval(`getComputedStyle(document.getElementById('nav-meeting')).display === 'none' && getComputedStyle(document.getElementById('nav-expenses')).display === 'none'`);
    await N.eval(`openSwap(4)`);
    const nSwap = await N.eval(`document.getElementById('swap-body').innerText`);
    await N.eval(`chooseSwap(4, 1)`);
    ok('5-20 沒有 Firebase 的分組行程：集合與記帳分頁隱藏；換卡仍只存手機並顯示「只有這支手機會換」', hid && nSwap.includes('只有這支手機會換') && (await N.eval(`localStorage.getItem(${sj(PFX + '-overrides-v1')})`)) !== null && srv.get(PFX + '/overrides') === null);

    // 主控台錯誤
    const errs = [A, B, C, D, S1, S2, X, Y, R, Dl].flatMap(b => b.logs).filter(l => /EXC|Uncaught|TypeError|ReferenceError/.test(l));
    ok('5-0 頁面沒有執行期例外', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    ok('verify5 執行', false, e.stack || String(e));
  } finally {
    for (const b of toClose) { try { await b.close(); } catch (e) {} }
    srv.close();
  }
  console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
  process.exit(fails ? 1 : 0);
})();
