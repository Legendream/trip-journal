// 住宿狀態與多晚操作：產生器端驗收（docs/acceptance/lodging-status.md 的 A3、D1、E5、F1～F4）
// 在 repo 根目錄啟動 python3 -m http.server 8766 後執行
const { launch } = require('./cdp');
const fs = require('fs'), path = require('path'), os = require('os');
const SP = process.env.OUT || path.join(os.tmpdir(), 'group-trip-pages');
const root = path.resolve(__dirname, '../../../..');
const out = [];
const ok = (id, cond, note) => out.push((cond ? '✅ ' : '❌ ') + id + (note ? '  ' + note : ''));
const J = JSON.stringify;
(async () => {
  const b = await launch({ width: 390, height: 844 });
  await b.goto('http://127.0.0.1:8766/generator/index.html');
  await b.eval(`localStorage.clear()`);
  await b.goto('http://127.0.0.1:8766/generator/index.html');
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'generator/schema-example.json'), 'utf8'));
  cfg.days[7].hotel = { name: '未訂的飯店', note: '還在比價', paid: false, booked: false, map: '未訂的飯店' };   // 舊→新：匯入帶記號
  await b.eval(`window.__cfg=${J(cfg)};importLoadedConfig(__cfg);renderDays();0`);
  const lodg = i => b.eval(`JSON.stringify(dayLodging(state.days[${i}]))`).then(x => x && JSON.parse(x));
  const exportHotel = i => b.eval(`JSON.stringify(collectConfig().days[${i}].hotel)`).then(x => JSON.parse(x));

  // A3：匯入帶記號、匯出還在；沒有記號的不輸出 booked
  let l = await lodg(7);
  ok('A3a 匯入：booked:false 進到住宿 item', l && l.data.booked === false, J(l && l.data));
  let eh = await exportHotel(7);
  ok('A3b 匯出：未訂的 hotel 有 booked:false、paid:false', eh.booked === false && eh.paid === false, J(eh));
  eh = await exportHotel(0);
  ok('A2 沒有記號的舊住宿匯出沒有 booked 欄位', !('booked' in eh), J(eh));
  // 再匯入再匯出
  await b.eval(`window.__c2=collectConfig();importLoadedConfig(JSON.parse(JSON.stringify(__c2)));0`);
  eh = await exportHotel(7);
  ok('A3c 匯出 → 匯入 → 匯出：記號還在', eh.booked === false, J(eh));

  // F3：日卡標題與住宿列
  const hdr = await b.eval(`JSON.stringify([...document.querySelectorAll('.day-card')].map(c=>({tag:!!c.querySelector('.day-card-header .hotel-unbooked-tag'),row:!!c.querySelector('.hotel-inline.unbooked')})))`).then(JSON.parse);
  ok('F3 只有第 8 天的日卡標題與住宿列顯示未訂', hdr.map((x, i) => x.tag && x.row ? i : -1).filter(i => i >= 0).join() === '7' && hdr.filter(x => x.tag).length === 1, J(hdr.map(x => x.tag)));
  const rowTxt = await b.eval(`(()=>{const r=document.querySelector('.hotel-inline.unbooked');return JSON.stringify({paid:[...r.querySelectorAll('.hotel-paid-label')].map(x=>x.textContent.trim()),ph:r.querySelector('.act-name-i').placeholder,note:r.querySelectorAll('.act-map-i')[1].placeholder})})()`).then(JSON.parse);
  ok('F1 未訂列：只有「還沒訂」勾選，「已付清」隱藏', rowTxt.paid.length === 1 && rowTxt.paid[0] === '還沒訂', J(rowTxt));
  ok('F2 備註提示文字是付款安排例子', rowTxt.note.includes('11/1 刷尾款'), rowTxt.note);

  // F1：新增住宿時就能標還沒訂，名稱可留空
  await b.eval(`state.days[7].items=state.days[7].items.filter(i=>i.type!=='lodging');renderDays();addHotel(7);0`);
  await b.eval(`(()=>{const r=document.querySelector('#day-7 .hotel-inline');const cb=r.querySelector('.hotel-paid-label input');cb.checked=true;cb.dispatchEvent(new Event('change'))})()`);
  l = await lodg(7);
  ok('F1b 新增後勾「還沒訂」：名稱空白也存成未訂', l && l.title === '' && l.data.booked === false, J(l && l.data));
  eh = await exportHotel(7);
  ok('F1c 空名稱的未訂可匯出', eh.booked === false && eh.name === '', J(eh));

  // F4：刪除未訂後復原
  await b.eval(`removeHotel(7)`);
  ok('F4a 移除後沒有住宿', (await lodg(7)) === null);
  await b.eval(`document.getElementById('undo-undo-btn').click()`);
  l = await lodg(7);
  ok('F4 復原後仍是未訂', l && l.data.booked === false, J(l && l.data));

  // D1：住宿複製可一次勾選多天；D6 複製出來仍是未訂；取代
  await b.eval(`startCopyItem(7,${await b.eval(`state.days[7].items.findIndex(i=>i.type==='lodging')`)});0`);
  const rows = await b.eval(`document.querySelectorAll('#copy-day-btns .copy-pick-cb').length`);
  ok('D1 複製面板：列出其他天、可勾選', rows === 7, String(rows));
  await b.eval(`document.querySelectorAll('#copy-day-btns .copy-pick-cb').forEach(c=>{if(['1','2'].includes(c.value))c.checked=true});confirmPick()`);
  const l1 = await lodg(1), l2 = await lodg(2), l7 = await lodg(7);
  ok('D1b 一次複製到兩天，各是獨立的卡（id 不同）', l1 && l2 && l1.id !== l2.id && l1.id !== l7.id && l2.id !== l7.id);
  ok('D6 複製出來仍是未訂', l1.data.booked === false && l2.data.booked === false);
  l1.data.note = null;
  await b.eval(`state.days[1].items.find(i=>i.type==='lodging').data.note='只改第2天';`);
  ok('D4 改其中一晚不影響其他晚', (await lodg(2)).data.note !== '只改第2天' && (await lodg(7)).data.note !== '只改第2天');

  // E5：產生器的「同一間其他晚」
  await b.eval(`importLoadedConfig(__cfg);renderDays();0`);   // Day1、Day2 是同名的京阪
  const li = await b.eval(`state.days[0].items.findIndex(i=>i.type==='lodging')`);
  await b.eval(`(()=>{const r=document.querySelector('#day-0 .hotel-inline');const c=[...r.querySelectorAll('.hotel-paid-label input')][1];c.checked=true;c.dispatchEvent(new Event('change'))})()`);
  const panel = await b.eval(`JSON.stringify({show:document.getElementById('copy-panel').classList.contains('show'),title:document.getElementById('copy-panel-title').textContent,rows:[...document.querySelectorAll('#copy-day-btns .copy-pick-cb')].map(c=>({v:c.value,on:c.checked}))})`).then(JSON.parse);
  ok('E5a 改付款狀態後出現「同時套用」清單，同名的 Day 2 預設勾選', panel.show && panel.title.includes('同一間') && panel.rows.length === 1 && panel.rows[0].v === '1' && panel.rows[0].on, J(panel));
  await b.eval(`confirmPick()`);
  const d2 = await lodg(1);
  ok('E5b 套用：Day 2 也變已付清，備註不被蓋掉', d2.data.paid === true && d2.data.note.includes('兩晚'), J(d2.data));
  // E4：沒有同名的就不出現
  await b.eval(`(()=>{const r=document.querySelector('#day-5 .hotel-inline');const c=[...r.querySelectorAll('.hotel-paid-label input')][1];c.checked=!c.checked;c.dispatchEvent(new Event('change'))})()`);
  ok('E4 沒有同名其他晚：不出現清單', !(await b.eval(`document.getElementById('copy-panel').classList.contains('show')`)));
  // E6b 沒名稱不算
  await b.eval(`importLoadedConfig(__cfg);state.days[0].items.find(i=>i.type==='lodging').title='';state.days[0].items.find(i=>i.type==='lodging').data={note:'',paid:false,booked:false};state.days[1].items.find(i=>i.type==='lodging').title='';state.days[1].items.find(i=>i.type==='lodging').data={note:'',paid:false,booked:false};renderDays();0`);
  await b.eval(`(()=>{const r=document.querySelector('#day-0 .hotel-inline');const n=r.querySelector('.act-row2:last-child .act-map-i');n.value='x';n.dispatchEvent(new Event('input'));n.dispatchEvent(new Event('change'))})()`);
  ok('E6b 沒名稱的未訂卡不算同一間', !(await b.eval(`document.getElementById('copy-panel').classList.contains('show')`)));

  // 活動複製仍是單選一鍵
  await b.eval(`importLoadedConfig(__cfg);renderDays();startCopyItem(0,0);0`);
  ok('活動複製維持原本的單日按鈕', (await b.eval(`document.querySelectorAll('#copy-day-btns .copy-day-btn').length`)) > 0 && (await b.eval(`document.querySelectorAll('#copy-day-btns .copy-pick-cb').length`)) === 0);
  await b.eval(`cancelCopy()`);

  await b.eval(`openFirst=document.querySelector('#day-7');openFirst&&openFirst.classList.add('open');document.querySelector('#day-7 .hotel-inline')?.scrollIntoView();0`);
  ok('無 JS 例外', !b.logs.some(l => l.startsWith('EXC')), J(b.logs.slice(0, 3)));
  await b.close();
  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('❌')) ? '\n有 ❌' : '\n全部通過');
})().catch(e => { console.log(out.join('\n')); console.error(e); process.exit(1); });
