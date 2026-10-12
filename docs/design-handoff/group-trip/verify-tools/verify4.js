// 包 4 驗收清單 4-1 … 4-17 的瀏覽器驗證（headless Chrome，行動尺寸 390×844）
const { launch } = require('./cdp');
const fs = require('fs'), path = require('path');
const SP = process.env.OUT || path.join(require('os').tmpdir(), 'group-trip-pages');
const BASE = 'http://127.0.0.1:8765/';
const out = [];
const ok = (id, cond, note) => { out.push((cond ? '✅ ' : '❌ ') + id + (note ? '  ' + note : '')); };
const cardsJs = `JSON.stringify([...document.querySelectorAll('#day-cards-wrap .day-card')].map(c=>({key:c.dataset.day,num:c.querySelector('.day-num').textContent,date:c.querySelector('.day-date').textContent,theme:c.querySelector('.day-theme').textContent,meta:c.querySelector('.day-meta').innerText,tag:(c.querySelector('.day-meta .gt')||{}).textContent||'',tagBtn:!!c.querySelector('.day-meta button.gt-btn'),cls:c.className})))`;
const cards = async b => JSON.parse(await b.eval(cardsJs));
const clickText = (b, sel, text) => b.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(!e)return false;e.click();return true})()`);
(async () => {
  // ── 4-1 ──
  let b = await launch();
  await b.setClock('2026-10-15T09:00:00+08:00');
  await b.goto(BASE + 'new-grouped.html');
  let names = await b.eval(`[...document.querySelectorAll('#who-body .who-name')].map(x=>x.textContent).join(',')`);
  let skip = await b.eval(`document.querySelector('#who-body .who-skip').textContent`);
  let vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  ok('4-1a 第一次開啟問「你是誰」，四位成員＋我只是看看', vis && names === '小貓,阿熊,小魚,阿鹿' && skip.includes('我只是看看'), names);
  await b.shot(SP + '/s-4-1-who.png');
  await b.eval(`document.querySelectorAll('.who-btn')[0].click()`);
  await b.goto(BASE + 'new-grouped.html');
  vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  ok('4-1b 選小貓後重新整理不再問', !vis && (await b.eval('ME')) === await b.eval(`GMEMBERS[0].id`));

  // ── 4-3 小貓的我的行程 ──
  let cs = await cards(b);
  const themes = cs.map(c => c.theme).join('|');
  ok('4-3 小貓的我的行程只有鹿兒島組的卡', !themes.includes('抵達福岡') && !themes.includes('太宰府') && !themes.includes('門司港') && themes.includes('霧島') && themes.includes('指宿') && themes.includes('仙巖園'), themes);
  ok('4-3b 切換列：「我的行程」是目前檢視', (await b.eval(`document.querySelector('.view-bar .checklist-tab-btn.active').textContent`)) === '我的行程');
  await b.shot(SP + '/s-4-3-mine-xiaomao.png');

  // ── 4-5 小貓的 11/6 ──
  await b.eval(`toggleDay(_ck(DAYS.find(d=>d.date==='11/6')))`);
  const acts116 = await b.eval(`(()=>{const c=document.querySelector('.day-card.open');return JSON.stringify([...c.querySelectorAll('.act-item')].map(a=>({name:a.querySelector('.act-name').textContent,tag:(a.querySelector('.gt')||{}).textContent||''})))})()`);
  const a116 = JSON.parse(acts116);
  ok('4-5 11/6 看得到福岡組搭船抵達並帶標籤', a116.some(a => a.name.includes('搭船抵達') && a.tag === '福岡組') && a116.some(a => a.name.includes('搭機抵達') && a.tag === '鹿兒島組') && a116.some(a => a.name.includes('集合') && a.tag === ''), acts116);
  await b.shot(SP + '/s-4-5-1106.png');

  // ── 4-9 標籤與可點 ──
  const tagByDate = Object.fromEntries(cs.map(c => [c.meta.split('（')[0].replace(/^.*?(\d+\/\d+)$/, '$1'), c]));
  const g = d => cs.find(c => c.meta.includes(d + '（'));
  ok('4-9 11/3、11/4、11/5 標籤有 ▾ 可點；11/1、11/2、11/6 之後沒有標籤',
    ['11/3', '11/4', '11/5'].every(d => g(d) && g(d).tagBtn && g(d).tag.includes('▾')) &&
    ['11/1', '11/2', '11/6', '11/7', '11/13'].every(d => g(d) && g(d).tag === ''),
    ['11/3','11/4','11/5','11/1','11/2','11/6'].map(d=>d+':'+(g(d)&&g(d).tag)).join(' '));

  // ── 4-15 點擊範圍 ──
  const hit = await b.eval(`(()=>{const r=e=>{const x=e.getBoundingClientRect();return Math.round(x.height)};
    const t=document.querySelector('.day-meta button.gt-btn'); const cs=getComputedStyle(t,'::after');
    return JSON.stringify({tagAfterH:cs.height, seg:r(document.querySelector('.view-bar .checklist-tab-btn')), me:r(document.querySelector('.me-btn'))})})()`);
  const hj = JSON.parse(hit);
  ok('4-15a 切換按鈕與頭像鈕高度 ≥ 44px；標籤點擊範圍 44px', hj.seg >= 44 && hj.me >= 44 && hj.tagAfterH === '44px', hit);

  // ── 4-10 換卡 ──
  await b.eval(`document.querySelectorAll('.day-card')[0].scrollIntoView()`);
  const d4 = cs.find(c => c.meta.includes('11/4（'));
  await b.eval(`openSwap(4)`);
  const swapTxt = await b.eval(`document.getElementById('swap-body').innerText`);
  ok('4-10a 換卡面板：標題、日期、兩個選項、只有這支手機會換', swapTxt.includes('這天跟誰走？') && swapTxt.includes('11/4') && swapTxt.includes('指宿・知覽') && swapTxt.includes('太宰府・柳川') && swapTxt.includes('只有這支手機會換'), swapTxt.replace(/\n+/g, ' / '));
  const sizes = await b.eval(`JSON.stringify([...document.querySelectorAll('#swap-body .swap-opt, #swap-body .msg-close-btn')].map(e=>Math.round(e.getBoundingClientRect().height)))`);
  ok('4-15b 換卡選項與關閉鈕高度 ≥ 44px', JSON.parse(sizes).every(h => h >= 44), sizes);
  await b.shot(SP + '/s-4-10-swap.png');
  await clickText(b, '#swap-body .swap-opt', '太宰府');
  cs = await cards(b);
  ok('4-10b 小貓的 11/4 換成福岡組那張卡', cs.some(c => c.meta.includes('11/4（') && c.theme === '太宰府・柳川') && !cs.some(c => c.theme === '指宿・知覽'), cs.filter(c=>c.meta.includes('11/4（')).map(c=>c.theme+c.tag).join());
  await b.goto(BASE + 'new-grouped.html');
  cs = await cards(b);
  ok('4-10c 重新整理後仍是換過的卡', cs.some(c => c.theme === '太宰府・柳川') && !cs.some(c => c.theme === '指宿・知覽'));
  await b.shot(SP + '/s-4-10-swapped.png');

  // ── 4-11 換人看 ──
  await b.eval(`openWho(true)`);
  await b.eval(`document.querySelectorAll('.who-btn')[1].click()`);   // 阿熊
  cs = await cards(b);
  ok('4-11 換成阿熊：11/4 仍是鹿兒島組的卡（換卡只影響小貓）', cs.some(c => c.theme === '指宿・知覽') && !cs.some(c => c.theme === '太宰府・柳川'));
  // ── 4-7 ──
  ok('4-7 換人後檢視回到「我的行程」，內容是阿熊的', (await b.eval(`VIEW`)) === 'mine' && (await b.eval(`document.querySelector('.me-btn').getAttribute('aria-label')`)) === '阿熊，換人');
  // ── 4-8 我只是看看 ──
  await b.eval(`openWho(true)`);
  await b.eval(`document.querySelector('.who-skip').click()`);
  const view8 = await b.eval(`JSON.stringify({view:VIEW, active:document.querySelector('.view-bar .checklist-tab-btn.active').textContent, face:document.querySelector('.me-btn').textContent, n:document.querySelectorAll('#day-cards-wrap .day-card').length})`);
  const v8 = JSON.parse(view8);
  ok('4-8a 我只是看看：停在「全部」、頭像鈕變人形圖示', v8.view === 'all' && v8.active === '全部' && v8.face === '👤' && v8.n === 16, view8);
  await clickText(b, '.view-bar .checklist-tab-btn', '我的行程');
  vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  ok('4-8b 點「我的行程」打開「你是誰」', vis);
  await b.eval(`closeWho()`);
  ok('4-8c 有關閉鈕可關（換人面板）', !(await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`)));
  await b.close();

  // ── 4-4 小魚 ──
  b = await launch();
  await b.setClock('2026-10-15T09:00:00+08:00');
  await b.goto(BASE + 'new-grouped.html');
  await b.eval(`document.querySelectorAll('.who-btn')[2].click()`);   // 小魚
  cs = await cards(b);
  const first = cs[0];
  ok('4-4a 小魚的我的行程：第一張卡是 11/3、顯示 Day 1', first.meta.includes('11/3（') && first.num === 'Day 1', first.num + ' ' + first.meta);
  const cd = await b.eval(`document.getElementById('cd-num').textContent + '|' + document.getElementById('cd-label').textContent`);
  ok('4-4b 頭部倒數算到 11/3（10/15 → 19 天）', cd === '19|天後出發', cd);
  await b.shot(SP + '/s-4-4-mine-xiaoyu.png');
  await clickText(b, '.view-bar .checklist-tab-btn', '全部');
  cs = await cards(b);
  const d1 = cs.find(c => c.meta.includes('11/1（')), d3 = cs.filter(c => c.meta.includes('11/3（'));
  ok('4-4c 全部檢視：11/1 Day 1、11/3 Day 3；切回我的行程 11/3 是 Day 1', d1 && d1.num === 'Day 1' && d3.length === 2 && d3.every(c => c.num === 'Day 3'));
  await clickText(b, '.view-bar .checklist-tab-btn', '我的行程');
  cs = await cards(b);
  ok('4-4d 切回我的行程 11/3 是 Day 1', cs[0].num === 'Day 1' && cs[0].meta.includes('11/3（'));
  // 4-6 全部：11/3、11/4 各有兩張卡，各帶標籤，且不可點
  await clickText(b, '.view-bar .checklist-tab-btn', '全部');
  cs = await cards(b);
  const dup = d => cs.filter(c => c.meta.includes(d + '（'));
  ok('4-6 全部：11/3、11/4 各兩張卡堆疊、各帶標籤、標籤不可點', ['11/3', '11/4'].every(d => dup(d).length === 2 && dup(d).every(c => c.tag && !c.tagBtn) && dup(d)[0].cls.includes('pair-top') && dup(d)[1].cls.includes('pair-bot')), JSON.stringify(dup('11/3').map(c=>c.tag)));
  await b.shot(SP + '/s-4-6-all.png');
  // 4-13 海報
  await clickText(b, '.view-bar .checklist-tab-btn', '我的行程');
  await b.eval(`openDayShare(_ck(DAYS.find(d=>d.date==='11/3'&&d.theme==='抵達福岡')))`);
  const optTxt = await b.eval(`document.querySelector('.showcase-day-select').innerText`);
  const lines = optTxt.split('\n').filter(Boolean);
  ok('4-13a 我的行程下單日分享：只有我的卡、Day 編號與畫面一致', !optTxt.includes('霧島') && lines[0].startsWith('Day 1') && lines.every(l => !l.includes('櫻島')), lines.slice(0, 3).join(' / '));
  await b.eval(`closeShowcaseShare(); openShowcaseShare()`);
  await b.sleep(400);
  const n1 = await b.eval(`_showcaseDaysWithContent().length`);
  await b.eval(`closeShowcaseShare(); setView('all'); openShowcaseShare()`);
  await b.sleep(400);
  const n2 = await b.eval(`_showcaseDaysWithContent().length`);
  ok('4-13b 切到全部再做，內容跟著變（我的行程卡數 < 全部）', n1 < n2 && n2 === 16, n1 + ' vs ' + n2);
  await b.eval(`closeShowcaseShare()`);
  await b.shot(SP + '/s-4-13-poster-all.png');
  await b.close();

  // ── 4-12 新增景點同行的人 ──
  b = await launch();
  await b.goto(BASE + 'new-grouped.html');
  await b.eval(`document.querySelectorAll('.who-btn')[0].click()`);
  await b.sleep(200);
  await b.eval(`showItinForm(_ck(DAYS.find(d=>d.date==='11/6')))`);
  const formTxt = await b.eval(`document.getElementById('itin-form-body').innerText`);
  const pre = await b.eval(`document.querySelector('#itin-form-body [role=radio][aria-checked=true]').textContent.trim()`);
  ok('4-12a 新增景點：「同行的人」預設「跟這天一樣」，選項有各組與自己選', formTxt.includes('同行的人') && pre === '跟這天一樣' && formTxt.includes('鹿兒島組') && formTxt.includes('福岡組') && formTxt.includes('自己選'), pre);
  await b.shot(SP + '/s-4-12-form.png');
  await clickText(b, '#itin-form-body [role=radio]', '福岡組');
  await b.eval(`document.getElementById('itin-name-input').value='藏王狐狸村'`);
  await b.eval(`submitItinAct()`);
  await b.sleep(300);
  await b.eval(`toggleDay(_ck(DAYS.find(d=>d.date==='11/6')))`);
  const added = await b.eval(`(()=>{const a=[...document.querySelectorAll('.day-card.open .act-item')].find(x=>x.textContent.includes('藏王狐狸村'));return a?(a.querySelector('.gt')||{}).textContent||'(無標籤)':'(找不到)'})()`);
  ok('4-12b 改選福岡組後，景點帶福岡組標籤', added === '福岡組', added);
  await b.close();

  // ── 4-14 重問 ──
  b = await launch();
  await b.goto(BASE + 'new-grouped.html');
  await b.eval(`localStorage.setItem(ME_KEY, 'deleted-member-id')`);
  await b.goto(BASE + 'new-grouped.html');
  vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  ok('4-14 手機記的身分不在成員名單裡 → 重新問「你是誰」', vis && (await b.eval(`localStorage.getItem(ME_KEY)`)) === null);
  await b.close();

  // ── 4-2 單一成員 ──
  b = await launch();
  await b.goto(BASE + 'new-single-fb.html');
  vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  ok('4-2 只有一位成員的行程不問，直接套用', !vis && (await b.eval(`ME`)) === (await b.eval(`GMEMBERS[0].id`)));
  await b.close();

  // ── 4-16b 沒分組、有 Firebase ──
  b = await launch();
  await b.goto(BASE + 'new-nogroup-fb.html');
  vis = await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`);
  const hasBar = await b.eval(`!!document.querySelector('.view-bar')`);
  const tags = await b.eval(`document.querySelectorAll('.gt').length`);
  ok('4-16b-1 沒分組有 Firebase：首次開啟問「你是誰」；沒有切換列與標籤', vis && !hasBar && tags === 0);
  await b.eval(`document.querySelectorAll('.who-btn')[0].click()`);
  const row = await b.eval(`JSON.stringify({btn:!!document.querySelector('.showcase-entry-row.has-me .showcase-entry-btn'), me:!!document.querySelector('.showcase-entry-row.has-me .me-btn'), h:Math.round(document.querySelector('.me-btn').getBoundingClientRect().height), n:document.querySelectorAll('#day-cards-wrap .day-card').length})`);
  const rj = JSON.parse(row);
  ok('4-16b-2 頭像鈕在「製作行程海報」那一列右側；卡片全部顯示', rj.btn && rj.me && rj.h >= 44 && rj.n === 8, row);
  await b.shot(SP + '/s-4-16b-nogroup-fb.png');
  await b.eval(`document.querySelector('.me-btn').click()`);
  ok('4-16b-3 點頭像鈕可換人', await b.eval(`document.getElementById('who-overlay').classList.contains('visible')`));
  await b.close();

  // ── 4-16 沒分組沒 Firebase：與改前 DOM 相同 ──
  const norm = s => s.replace(/\s+/g, ' ');
  const snap = async (file, clock) => {
    const bb = await launch(); await bb.setClock('2026-04-10T09:00:00+08:00');
    await bb.goto(BASE + file); await bb.sleep(1200);
    const r = {};
    for (const t of ['itinerary', 'checklist']) { await bb.eval(`switchTab('${t}')`); r[t] = norm(await bb.eval(`document.getElementById('tab-${t}').innerHTML`)); }
    r.header = norm(await bb.eval(`document.getElementById('app-header').innerHTML`));
    r.nav = await bb.eval(`getComputedStyle(document.getElementById('nav-meeting')).display + '/' + getComputedStyle(document.getElementById('nav-expenses')).display`);
    await bb.eval(`switchTab('itinerary')`);
    await bb.shot(SP + '/' + file.replace('.html', '.png'));
    r.who = await bb.eval(`!!(document.getElementById('who-overlay')&&document.getElementById('who-overlay').classList.contains('visible'))`);
    await bb.close(); return r;
  };
  const A = await snap('main-nogroup.html'), B = await snap('new-nogroup.html');
  ok('4-16 沒分組沒 Firebase：行程分頁與標頭 DOM 與改前相同、不問身分', A.itinerary === B.itinerary && A.header === B.header && A.checklist === B.checklist && A.nav === B.nav && B.who === false, `itin ${A.itinerary.length}/${B.itinerary.length}`);
  const px = fs.readFileSync(SP + '/main-nogroup.png').equals(fs.readFileSync(SP + '/new-nogroup.png'));
  ok('4-16 截圖逐像素相同（行程分頁）', px);

  console.log(out.join('\n'));
})().catch(e => { console.log(out.join('\n')); console.error('FATAL', e); process.exit(1); });
