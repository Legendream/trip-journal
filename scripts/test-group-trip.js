// 分組旅行：資料層測試（Node 執行，不需瀏覽器）
// 用法：node scripts/test-group-trip.js
const fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
const { loadGenerator, root } = require('./lib/gen-sandbox');
const { capture, SAMPLE_TRIP_TEXT } = require('./capture-no-group-baseline');
const gt = require('../generator/group-trip.js');

const AI = path.join(root, 'docs/design-handoff/group-trip/ai-test');
const FIX = path.join(root, 'scripts/fixtures/no-group');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

let pass = 0, fail = 0;
const pendingTests = [];   // 非同步測試（回傳 Promise）
function test(name, fn) {
  const ok = () => { pass++; console.log('✓ ' + name); };
  const bad = e => { fail++; console.log('✗ ' + name + '\n    ' + String(e.message).split('\n').join('\n    ')); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pendingTests.push(r.then(ok, bad)); else ok();
  } catch (e) { bad(e); }
}

// 以 ai-test 的組別（用名字）建立產生器狀態，再匯入 AI 回傳的 JSON（走真正的 applyParsedData）
function importAi(outFile, tweak) {
  const { groups, year } = readJson(path.join(AI, 'groups.json'));
  const out = readJson(outFile);
  if (tweak) tweak(out);
  const g = loadGenerator();
  g.ctx.__groups = groups; g.ctx.__out = out;
  g.run(`
    state.splitUp = true;
    state.members = []; 
    __groups.forEach(gr => gr.members.forEach(n => { if (!state.members.some(m => m.name === n)) state.members.push({ name: n, avatar: '' }); }));
    ensureMemberIds();
    state.groups = __groups.map((gr, i) => ({ id: 'g' + i, name: gr.name, order: i, memberIds: gr.members.map(n => state.members.find(m => m.name === n).id) }));
    applyParsedData(__out);
  `);
  const alerts = g.run(`computeAlerts({ members: state.members, groups: state.groups, days: state.days, hotels: state.hotels, year: ${year}, dismissed: state.dismissedAlerts })`);
  return { g, alerts: JSON.parse(JSON.stringify(alerts)) };
}
const codes = alerts => alerts.map(a => a.code);

// check.js 的判讀提醒輸出 → 'A-2|阿熊|11/4' 這種比對用字串
function checkJsAlerts(outFile) {
  const txt = cp.execFileSync('node', [path.join(AI, 'check.js'), outFile], { encoding: 'utf8' });
  const block = txt.split('判讀提醒（產生器會顯示的）\n')[1].split('\n\n')[0];
  if (block.trim() === '（無）') return [];
  return block.split('\n').map(l => {
    const code = l.slice(0, 3);
    if (code === 'A-2') { const m = /^A-2\s+(\S+) (\S+) 出現/.exec(l); return `A-2|${m[1]}|${m[2]}`; }
    if (code === 'A-5') { const m = /^A-5\s+(\d+\/\d+)/.exec(l); return `A-5|${m[1]}`; }
    return l.replace(/\s+/g, ' ');
  }).sort();
}
const summarize = (alerts) => alerts.map(a => a.code === 'A-2' ? `A-2|${a.name}|${a.date}` : a.code === 'A-5' ? `A-5|${a.date}` : a.code).sort();
const uniq = a => [...new Set(a)];

// ── 1-4～1-7：判讀提醒 ──────────────────────────────────────────────
test('1-4 reference.json 只有 A-5（11/4）', () => {
  const { alerts } = importAi(path.join(AI, 'reference.json'));
  assert.deepStrictEqual(codes(alerts), ['A-5']);
  assert.strictEqual(alerts[0].date, '11/4');
});
test('1-5 out-antigravity-v3.json：A-2（阿熊 11/4）＋A-5，與 check.js 一致', () => {
  const f = path.join(AI, 'out-antigravity-v3.json');
  const { alerts } = importAi(f);
  assert.deepStrictEqual(uniq(codes(alerts)).sort(), ['A-2', 'A-5']);
  const a2 = alerts.find(a => a.code === 'A-2');
  assert.strictEqual(a2.name + a2.date, '阿熊11/4');
  assert.deepStrictEqual(uniq(summarize(alerts)), uniq(checkJsAlerts(f)));
});
test('1-6 out-gemini-web-v3.json 只有 A-5（11/4 那筆活動）', () => {
  const f = path.join(AI, 'out-gemini-web-v3.json');
  const { alerts } = importAi(f);
  assert.deepStrictEqual(codes(alerts), ['A-5']);
  assert.strictEqual(alerts[0].date, '11/4');
  assert.ok(alerts[0].itemId, 'A-5 應指到活動而不是整張日卡');
  assert.deepStrictEqual(uniq(summarize(alerts)), uniq(checkJsAlerts(f)));
});
test('1-7 同行名單寫成「福岡團」→ A-1', () => {
  const { alerts } = importAi(path.join(AI, 'reference.json'), out => {
    out.days.find(d => (d.with || []).includes('福岡組')).with = ['福岡團'];
  });
  const a1 = alerts.filter(a => a.code === 'A-1');
  assert.strictEqual(a1.length, 1);
  assert.strictEqual(a1[0].name, '福岡團');
  assert.strictEqual(a1[0].dismissable, false);
});

// ── 1-8：notes ───────────────────────────────────────────────────
test('1-8 notes 字串陣列 → { icon, text }', () => {
  const g = loadGenerator();
  g.ctx.__d = { days: [], notes: ['現金要帶夠', { icon: '🔥', text: '已經是物件' }] };
  g.run('applyParsedData(__d)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g.run('state.parsedExtras.notes'))),
    [{ icon: '⚠️', text: '現金要帶夠' }, { icon: '🔥', text: '已經是物件' }]);
});

// ── 1-9：提示詞分組段落 ──────────────────────────────────────────
test('1-9 有分組時提示詞 = build-prompt.js 的輸出（分組段落在 Schema 之前）', () => {
  const g = loadGenerator();
  const { groups } = readJson(path.join(AI, 'groups.json'));
  g.ctx.__groups = groups;
  g.run(`
    state.splitUp = true;
    __groups.forEach(gr => gr.members.forEach(n => { if (!state.members.some(m => m.name === n)) state.members.push({ name: n, avatar: '' }); }));
    ensureMemberIds();
    state.groups = __groups.map((gr, i) => ({ id: 'g' + i, name: gr.name, order: i, memberIds: gr.members.map(n => state.members.find(m => m.name === n).id) }));
  `);
  g.el('trip-text').value = fs.readFileSync(path.join(AI, 'draft.txt'), 'utf8').trim();
  const prompt = g.run('buildPrompt()');
  // 對照：ai-test/build-prompt.js 用同一份 PARSE_PROMPT＋group-section.txt 組出 prompt.txt（草稿接在後面，不 trim）
  const expectedSection = fs.readFileSync(path.join(AI, 'group-section.txt'), 'utf8')
    .replace('{分組清單}', groups.map(x => `- ${x.name}：${x.members.join('、')}`).join('\n'));
  const anchor = 'JSON Schema（嚴格遵守）：';
  assert.ok(prompt.includes(expectedSection + anchor), '分組段落應與 group-section.txt 完全一致，且緊接在 Schema 標題前');
  assert.strictEqual(prompt.split(anchor).length, 2);
  assert.strictEqual(gt.GROUP_SECTION_TEMPLATE, fs.readFileSync(path.join(AI, 'group-section.txt'), 'utf8'));
});
test('1-9b 分組開關關閉時，即使 groups 還在也不影響提示詞', () => {
  const g = loadGenerator();
  g.run(`state.members=[{name:'a',avatar:''}]; ensureMemberIds(); state.groups=[{id:'g0',name:'A組',order:0,memberIds:[state.members[0].id]}]; state.splitUp=false;`);
  g.el('trip-text').value = SAMPLE_TRIP_TEXT;
  assert.ok(!g.run('buildPrompt()').includes('分組規則'));
});

// ── 1-10：成員 id（2026-10-10 起匯出一律帶成員 id；沒分組仍不輸出分組欄位）────────
test('1-10 舊資料補成員 id；匯出帶成員 id、沒分組時不輸出分組欄位', () => {
  const g = loadGenerator();
  const legacy = { step: 1, members: [{ name: '甲', avatar: '🐱' }, { name: '乙', avatar: '' }], days: [], hotels: [] };
  g.ctx.__legacy = JSON.stringify(legacy);
  g.run(`localStorage.setItem(STATE_KEY, __legacy); loadState();`);
  const ids = g.run('state.members.map(m => m.id)');
  assert.ok(ids.every(Boolean) && new Set(ids).size === 2, '每位成員都有不同的 id');
  const cfg = JSON.parse(JSON.stringify(g.run('collectConfig()')));
  assert.deepStrictEqual(cfg.members, legacy.members.map((m, i) => ({ id: ids[i], ...m })));
  for (const k of ['"with"', '"groups"', '"memberIds"']) assert.ok(!JSON.stringify(cfg).includes(k), '不應輸出 ' + k);
});
test('1-10b 內部旗標不流進匯出設定檔（unsure、withUnknown）', () => {
  const { g } = importAi(path.join(AI, 'reference.json'));
  const cfg = JSON.stringify(g.run('collectConfig()'));
  for (const k of ['"withUnknown"', '"unsure"', '"dismissedAlerts"']) assert.ok(!cfg.includes(k), '不應輸出 ' + k);
});

// ── 1-2、1-3：規則 7（沒分組跟改前一樣）──────────────────────────
// 3-1：匯出一律多了 members[].id（2026-10-10 定案）；拿掉它以後要與改前基準一字不差
const stripMemberIds = txt => { const c = JSON.parse(txt); c.members.forEach(m => delete m.id); return JSON.stringify(c, null, 2) + '\n'; };
test('3-1 沒分組：schema-example.json 匯入→匯出，拿掉 members[].id 後與改前基準一字不差；每位成員都有 id', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt-'));
  capture(path.join(root, 'generator/generator-app.js'), tmp);
  for (const f of ['schema-example.export.json', 'schema-example.ai-import.export.json']) {
    const now = fs.readFileSync(path.join(tmp, f), 'utf8');
    JSON.parse(now).members.forEach(m => assert.ok(m.id, f + '：成員沒有 id'));
    assert.strictEqual(stripMemberIds(now), fs.readFileSync(path.join(FIX, f), 'utf8'), f + ' 與基準不同');
  }
});
test('1-3 沒分組時 buildPrompt() 與基準只差 notes 範例那一行', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt-'));
  capture(path.join(root, 'generator/generator-app.js'), tmp);
  const a = fs.readFileSync(path.join(FIX, 'prompt.txt'), 'utf8').split('\n');
  const b = fs.readFileSync(path.join(tmp, 'prompt.txt'), 'utf8').split('\n');
  assert.strictEqual(a.length, b.length);
  const diff = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
  assert.deepStrictEqual(diff, [['  "notes": []', '  "notes": [{ "icon": "⚠️", "text": "…" }]']]);
});

// ── 其他保護 ────────────────────────────────────────────────────
test('沒分組時，AI 就算回了 with／unsure 也會被丟掉', () => {
  const g = loadGenerator();
  g.ctx.__d = { members: [{ name: '甲' }], days: [{ day: 1, date: '4/1', wd: '三', theme: 't', emoji: '📍', with: ['甲'], unsure: true, acts: [{ icon: '📍', name: 'x', with: ['甲'] }] }] };
  g.run('applyParsedData(__d)');
  const s = JSON.stringify(g.run('state.days'));
  assert.ok(!/"with"|"unsure"|"withUnknown"/.test(s));
});
test('合併成員：保留 id 與頭像，AI 多給的才新增', () => {
  const m = gt.mergeMembers([{ id: 'a', name: '甲', avatar: '🐱' }], [{ name: '甲', avatar: '' }, { name: '乙', avatar: '🐻' }]);
  assert.deepStrictEqual(m, [{ id: 'a', name: '甲', avatar: '🐱' }, { name: '乙', avatar: '🐻' }]);
});
test('略過的提醒不再出現；A-1 不能略過', () => {
  const { g, alerts } = importAi(path.join(AI, 'out-antigravity-v3.json'));
  const keys = alerts.filter(a => a.dismissable).map(a => a.key);
  g.ctx.__keys = keys;
  g.run('state.dismissedAlerts = __keys');
  const again = g.run(`computeAlerts({ members: state.members, groups: state.groups, days: state.days, hotels: state.hotels, year: 2026, dismissed: state.dismissedAlerts })`);
  assert.strictEqual(again.length, 0);
});

// ═══ 包 2：畫面用的純函式與畫面片段 ═══════════════════════════════════
const M = (id, name) => ({ id, name, avatar: '' });
const MEM = [M('a', '小貓'), M('b', '阿熊'), M('c', '小魚'), M('d', '阿鹿')];
const GRP = [{ id: 'g0', name: '鹿兒島組', memberIds: ['a', 'b'], order: 0 }, { id: 'g1', name: '福岡組', memberIds: ['c', 'd'], order: 1 }];
const day = (id, date, w, items = []) => ({ id, day: 1, date, wd: '', theme: id, emoji: '📍', ...(w ? { with: w } : {}), items });
const act = (id, w) => ({ id, type: 'activity', title: id, ...(w ? { with: w } : {}) });

test('2-4 組名標籤配色：主題深色版（赭紅 #782825）、三種外觀', () => {
  assert.strictEqual(gt.deepTagColor('#a8362f'), '#782825');
  const [s1, s2, s3] = [0, 1, 2].map(i => gt.groupTagStyle(i, '#782825', '#f3e3d8'));
  assert.match(s1.tag, /background:#782825;color:#fff/);                       // 實心
  assert.match(s2.tag, /background:#fff;color:#782825;box-shadow/);            // 外框
  assert.match(s3.tag, /background:#f3e3d8;color:#782825;box-shadow/);         // 淡底加框
});
test('2-4 名單反推：全員／某組／對不上顯示成員', () => {
  assert.strictEqual(gt.describeList(undefined, GRP, MEM).kind, 'all');
  assert.strictEqual(gt.describeList(['a', 'b'], GRP, MEM).group.name, '鹿兒島組');
  assert.strictEqual(gt.describeList(['d', 'c'], GRP, MEM).index, 1);
  assert.deepStrictEqual(gt.describeList(['d', 'a'], GRP, MEM), { kind: 'members', ids: ['a', 'd'] });
});
test('2-8 改組別名單：名單完全吻合的卡（含活動）一起改，回傳卡數', () => {
  const days = [day('d1', '11/3', ['c', 'd'], [act('x', ['c', 'd']), act('y')]), day('d2', '11/3', ['a', 'b']), day('d3', '11/6', undefined, [act('z', ['c', 'd'])])];
  const n = gt.syncGroupLists(days, ['c', 'd'], ['c'], MEM);
  assert.strictEqual(n, 1, '只算日卡張數；活動名單照樣同步');
  assert.deepStrictEqual(days[0].with, ['c']);
  assert.strictEqual(days[0].items[0].with, undefined, '活動名單等於新的卡名單 → 改成沿用');
  assert.deepStrictEqual(days[1].with, ['a', 'b']);
  assert.deepStrictEqual(days[2].items[0].with, ['c']);
});
test('2-7 A-2「只留在」：同日其他卡拿掉這個人', () => {
  const days = [day('d1', '11/4', ['a']), day('d2', '11/4', ['b', 'c', 'd'], [act('x', ['b']), act('y', ['c'])])];
  days[0].with = ['a', 'b'];
  assert.strictEqual(gt.keepMemberOnlyIn(days, 'd2', 'b', MEM), 1);
  assert.deepStrictEqual(days[0].with, ['a']);
  const days2 = [day('d1', '11/4', ['a', 'b']), day('d2', '11/4', ['b', 'c'], [act('x', ['b'])])];
  gt.keepMemberOnlyIn(days2, 'd1', 'b', MEM);
  assert.deepStrictEqual(days2[1].with, ['c']);
  assert.strictEqual(days2[1].items[0].with, undefined, '活動只剩沒人 → 沿用日卡');
});
test('2-6 這天一起行動：合併成一張全員卡，活動保留原本屬於誰', () => {
  const days = [day('d1', '11/7', ['a', 'b'], [act('x')]), day('d2', '11/7', ['c', 'd'], [act('y', ['c'])]), day('d3', '11/8')];
  assert.ok(gt.mergeSameDateCards(days, '11/7', MEM));
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].with, undefined);
  assert.deepStrictEqual(days[0].items.map(i => [i.id, i.with]), [['x', ['a', 'b']], ['y', ['c']]]);
  assert.strictEqual(gt.mergeSameDateCards(days, '11/8', MEM), false);
});
test('2-6 這天分頭行動：替沒出現的人加卡；全員卡拆成第 1 組＋其餘', () => {
  const days = [day('d1', '11/5', ['a', 'b']), day('d9', '11/6')];
  const nc = { id: 'n1', day: 1, date: '', wd: '', theme: '', emoji: '📍', items: [] };
  assert.ok(gt.splitDateCards(days, '11/5', GRP, MEM, nc));
  assert.deepStrictEqual(nc.with, ['c', 'd']);
  assert.deepStrictEqual(days.map(d => d.id), ['d1', 'n1', 'd9']);
  assert.strictEqual(nc.date, '11/5');
  const days2 = [day('d1', '11/6')];
  const nc2 = { id: 'n2', items: [] };
  assert.ok(gt.splitDateCards(days2, '11/6', GRP, MEM, nc2));
  assert.deepStrictEqual(days2[0].with, ['a', 'b']);
  assert.deepStrictEqual(nc2.with, ['c', 'd']);
  assert.strictEqual(gt.splitDateCards(days2, '11/6', GRP, MEM, { id: 'n3', items: [] }), false, '兩張卡已涵蓋所有人 → 不再拆');
});
test('規則 13 刪除成員：從所有名單拿掉，名單變空的留下 A-1 提醒', () => {
  const st = { groups: JSON.parse(JSON.stringify(GRP)), hotels: [], days: [day('d1', '11/4', ['a']), day('d2', '11/4', ['a', 'b'])] };
  gt.removeMemberFromLists(st, 'a', '小貓');
  assert.deepStrictEqual(st.groups[0].memberIds, ['b']);
  assert.deepStrictEqual(st.days[1].with, ['b']);
  assert.strictEqual(st.days[0].with, undefined);
  assert.deepStrictEqual(st.days[0].withUnknown, ['小貓']);
  const al = gt.computeAlerts({ members: MEM.filter(m => m.id !== 'a'), groups: st.groups, days: st.days, hotels: [], year: 2026 });
  assert.ok(al.some(a => a.code === 'A-1'));
});
test('A-1：對不上的組名視為沒人，不會連帶觸發其他卡的 A-2／A-4', () => {
  const days = [day('d1', '11/3', ['a', 'b']), { ...day('d2', '11/3'), withUnknown: ['福岡團'] }];
  const al = gt.computeAlerts({ members: MEM, groups: GRP, days, hotels: [], year: 2026 });
  assert.ok(al.some(a => a.code === 'A-1' && a.name === '福岡團'));
  assert.ok(!al.some(a => a.code === 'A-2'));
});
test('同日的卡 Day 編號相同', () => {
  const days = [day('1', '11/1'), day('2', '11/1'), day('3', '11/2'), day('4', '11/3')];
  gt.renumberDaysByDate(days);
  assert.deepStrictEqual(days.map(d => d.day), [1, 1, 2, 3]);
});

test('跨年行程不會把整年列成 A-3；空白日期不誤報', () => {
  const days = [day('1', '12/30', ['a', 'b']), day('2', '12/30', ['c', 'd']), day('3', '12/31'), day('4', '1/1'), day('5', '1/2')];
  const al = gt.computeAlerts({ members: MEM, groups: GRP, days, hotels: [], year: 2026 });
  assert.ok(!al.some(a => a.code === 'A-3'), JSON.stringify(al.filter(a => a.code === 'A-3').slice(0, 2)));
  const gap = [day('1', '12/30'), day('2', '1/2', ['a', 'b']), day('3', '1/3')];
  assert.deepStrictEqual(gt.computeAlerts({ members: MEM, groups: GRP, days: gap, hotels: [], year: 2026 }).filter(a => a.code === 'A-3' && a.memberId === 'a').map(a => a.date), ['12/31', '1/1']);
  const typo = [day('1', '11/3'), day('2', '11/4'), day('3', '1/2'), day('4', '11/6')];
  assert.ok(gt.computeAlerts({ members: MEM, groups: GRP, days: typo, hotels: [], year: 2026 }).length < 20);
  const blank = [day('1', '')];
  assert.ok(!gt.computeAlerts({ members: MEM, groups: GRP, days: blank, hotels: [], year: 2026 }).some(a => a.code === 'A-3'));
});
test('名單只剩對不上的名字時，合併／分開／只留在都當成沒人（不變成全員）', () => {
  const ghost = { ...day('g', '11/4'), withUnknown: ['小貓'] };
  const days = [ghost, day('d2', '11/4', ['b'])];
  const nc = { id: 'n', items: [] };
  assert.ok(gt.splitDateCards(days, '11/4', GRP, MEM, nc));
  assert.deepStrictEqual(nc.with, ['a', 'c', 'd'], '幽靈卡不算涵蓋任何人');
});
test('G-9 只計日卡張數', () => {
  const days = [day('d1', '11/3', ['c', 'd'], [act('x', ['c', 'd'])]), day('d2', '11/6', undefined, [act('z', ['c', 'd'])])];
  assert.strictEqual(gt.syncGroupLists(days, ['c', 'd'], ['c'], MEM), 1);
  assert.deepStrictEqual(days[1].items[0].with, ['c']);
});

// 畫面片段（用假 DOM 跑 renderDays，檢查產生的 HTML）
function groupedSandbox() {
  const { groups } = readJson(path.join(AI, 'groups.json'));
  const g = loadGenerator();
  g.ctx.__groups = groups; g.ctx.__out = readJson(path.join(AI, 'out-antigravity-v3.json'));
  g.run(`
    state.splitUp = true;
    __groups.forEach(gr => gr.members.forEach(n => { if (!state.members.some(m => m.name === n)) state.members.push({ name: n, avatar: '' }); }));
    ensureMemberIds();
    state.groups = __groups.map((gr, i) => ({ id: 'g' + i, name: gr.name, order: i, memberIds: gr.members.map(n => state.members.find(m => m.name === n).id) }));
    applyParsedData(__out);
    renderStep2();
  `);
  return g;
}
test('2-4／2-7 日卡 HTML：組名標籤、全員虛線鈕、提醒列、A-0 計數', () => {
  const g = groupedSandbox();
  const html = g.el('day-cards').innerHTML;
  assert.ok(html.includes('class="g-tag g-who-btn"'), '有組名標籤');
  assert.ok(html.includes('g-pbtn'), '全員卡有虛線人形鈕');
  assert.ok(html.includes('阿熊 同一天出現兩次'));
  assert.ok(/只留在[^<]+<\/button>/.test(html), 'A-2 有修正鈕');
  assert.ok(html.includes('AI 沒把握，請確認同行的人'));
  assert.match(g.el('group-alert-bar').innerHTML, /\d+ 處需要確認/);
  assert.ok(html.includes('這天分頭行動'), '只有一張卡的日子有分頭行動鈕');
  assert.ok(html.includes('這天一起行動'), '同日兩張卡有一起行動鈕');
});
test('2-3 步驟 2 各組成員：摘要＋編輯；編輯區可展開、第 3 組後隱藏「再加一組」', () => {
  const g = groupedSandbox();
  const sum = g.el('group-members').innerHTML;
  assert.ok(sum.includes('各組成員') && sum.includes('編輯') && sum.includes('鹿兒島組') && sum.includes('福岡組'));
  g.run('toggleGroupEdit()');
  assert.ok(g.el('group-members').innerHTML.includes('＋ 再加一組'));
  g.run('addGroup()');
  assert.ok(!g.el('group-members').innerHTML.includes('＋ 再加一組'), '第 3 組建立後隱藏');
});
test('2-5 選擇器 HTML：單選項目依日卡／活動不同，選中項由名單反推', () => {
  const g = groupedSandbox();
  const idx = g.run(`state.days.findIndex(d => d.date === '11/6')`);
  g.run(`openWho('day', ${idx})`);
  let html = g.el('day-cards').innerHTML;
  assert.ok(/aria-checked="true" onclick="pickWho\('all'\)"/.test(html), '全員卡 → 選中「全員」');
  assert.ok(['全員', '鹿兒島組', '福岡組', '自己選'].every(t => html.includes(t)));
  g.run(`pickWho('g1')`);
  assert.ok(!g.el('day-cards').innerHTML.includes('g-who-picker'), '選組別後自動關閉');
  g.run(`openWho('day', ${idx}); pickWho('custom')`);
  assert.ok(g.el('day-cards').innerHTML.includes('g-who-picker'), '自己選維持開啟');
  g.run(`openWho('item', ${idx}, 0)`);
  html = g.el('day-cards').innerHTML;
  assert.ok(html.includes('跟這天一樣'));
});
test('2-1 沒分組：renderDays 不產生任何分組元素；切回「全程一起」也一樣', () => {
  const g = loadGenerator();
  g.ctx.__cfg = readJson(path.join(root, 'generator/schema-example.json'));
  g.run('importLoadedConfig(__cfg); renderStep2();');
  const bad = html => /g-tag|g-pbtn|g-avs|g-who|g-warn|g-pair|g-a3|group-members|group-alert-bar/.test(html);
  assert.ok(!bad(g.el('day-cards').innerHTML));
  assert.strictEqual(g.run(`document.getElementById('group-alert-bar')`).innerHTML, '', '沒有 A-0 計數列內容');
  // 有分組資料但關閉「有分頭」
  g.run(`state.members.slice(0,2).forEach(m => {}); state.groups = [{ id: 'g0', name: 'X組', memberIds: [state.members[0].id], order: 0 }]; state.splitUp = false; renderStep2();`);
  assert.ok(!bad(g.el('day-cards').innerHTML));
});
test('2-2 D1 分組設定文字（G-1～G-8）', () => {
  const g = loadGenerator({ search: '?groups=1' });
  g.run('renderSplitSetup()');
  let h = g.el('split-setup').innerHTML;
  assert.ok(h.includes('有人分頭行動嗎？') && h.includes('全程一起') && h.includes('有分頭'));
  assert.ok(!h.includes('各組成員'), '預設「全程一起」不顯示組別區塊');
  g.run('setSplitUp(true)');
  h = g.el('split-setup').innerHTML;
  for (const t of ['各組成員', '組名照草稿的寫法填，AI 才對得上', '例：福岡組', '代號或暱稱', '＋ 再加一組']) assert.ok(h.includes(t), '缺 ' + t);
  g.run('addGroup()');
  assert.ok(!g.el('split-setup').innerHTML.includes('＋ 再加一組'), '第 3 組建立後隱藏');
});

test('入口閘門：沒有 ?groups=1 時不顯示「有人分頭行動嗎？」；已選有分頭的草稿照常顯示', () => {
  let g = loadGenerator();
  g.run('renderSplitSetup()');
  assert.strictEqual(g.el('split-setup').innerHTML, '');
  g = loadGenerator();
  g.run('state.splitUp = true; renderSplitSetup()');
  assert.ok(g.el('split-setup').innerHTML.includes('各組成員'));
});
test('切回「全程一起」：同日有 2 張以上的卡時顯示說明，沒有則不顯示', () => {
  const g = groupedSandbox();
  g.run('setSplitUp(false)');
  const h = g.el('split-setup').innerHTML;
  assert.ok(h.includes('分頭走') && h.includes('這天一起行動'), h);
  const g2 = loadGenerator({ search: '?groups=1' });
  g2.run('setSplitUp(true); setSplitUp(false)');
  assert.ok(!g2.el('split-setup').innerHTML.includes('分頭走'));
});
test('組名重複或沒填：顯示提醒', () => {
  const g = loadGenerator({ search: '?groups=1' });
  g.run(`setSplitUp(true); const m = findOrCreateMember('甲'); state.groups[0].memberIds.push(m.id); state.groups[1].name = 'X'; state.groups[0].name = '';`);
  assert.match(g.run('groupNameHint(0)'), /還沒填組名/);
  g.run(`state.groups[0].name = 'X'`);
  assert.match(g.run('groupNameHint(0)'), /重複/);
  assert.strictEqual(g.run('groupNameHint(1)'), '組名和別組重複，AI 和標籤都分不出來');
  g.run(`state.groups[0].name = 'Y'`);
  assert.strictEqual(g.run('groupNameHint(0)'), '');
});
test('A-6：日期格式看不懂會提醒（空白不算）；分組行程改日期後依日期重新編號', () => {
  const days = [day('1', '2026-11-01'), day('2', ''), day('3', '11/2')];
  const al = gt.computeAlerts({ members: MEM, groups: GRP, days, hotels: [], year: 2026 });
  assert.deepStrictEqual(al.filter(a => a.code === 'A-6').map(a => a.date), ['2026-11-01']);
  assert.strictEqual(al.find(a => a.code === 'A-6').dismissable, false);
  const g = groupedSandbox();
  g.run(`state.days[1].date = state.days[0].date; onDayDateChange();`);
  const nums = g.run(`state.days.slice(0, 3).map(d => d.day)`);
  assert.strictEqual(nums[0], nums[1] - 0 === nums[0] ? nums[1] : nums[0]);
  assert.ok(g.run(`state.days.every((d, i) => i === 0 || d.day === state.days[i-1].day || d.day === state.days[i-1].day + 1)`));
});
test('分組模式匯入沒有 days 的 JSON：顯示錯誤，不顯示成功', () => {
  const g = groupedSandbox();
  g.el('json-paste').value = '{"tripName":"x"}';
  g.run('importAiJson()');
  assert.ok(g.el('ai-import-status').innerHTML.includes('沒有 days'));
});


// ═══ 包 3：資料通道＋同日多卡 ═══════════════════════════════════════════
const clone = o => JSON.parse(JSON.stringify(o));
// 用設定檔走一次真正的 importLoadedConfig，回傳產生器實例
function restoreConfig(cfg) {
  const g = loadGenerator();
  g.ctx.__cfg = clone(cfg);
  g.run('importLoadedConfig(__cfg)');
  return g;
}
const exportOf = g => clone(g.run('collectConfig()'));
const alertsOf = (g, year) => clone(g.run(`computeAlerts({ members: state.members, groups: activeGroups(), days: state.days, hotels: state.hotels, year: ${year || 2026}, dismissed: state.dismissedAlerts })`));
const refExport = () => exportOf(importAi(path.join(AI, 'reference.json')).g);

test('3-2 分組行程匯出：有 groups；日卡有 id；with 全是成員 id；沒有 unsure、withUnknown', () => {
  const cfg = refExport();
  const ids = new Set(cfg.members.map(m => m.id));
  assert.ok(cfg.members.every(m => m.id), '成員都有 id');
  assert.deepStrictEqual(cfg.groups.map(g => g.name), ['鹿兒島組', '福岡組']);
  cfg.groups.forEach(g => { assert.ok(g.id); g.memberIds.forEach(id => assert.ok(ids.has(id), '組別成員 id 對得上成員')); });
  assert.ok(cfg.days.every(d => d.id), '每張日卡有 id');
  assert.strictEqual(new Set(cfg.days.map(d => d.id)).size, cfg.days.length, '日卡 id 不重複');
  const withs = [];
  cfg.days.forEach(d => { withs.push(d.with, d.hotel && d.hotel.with); d.acts.forEach(a => withs.push(a.with)); });
  cfg.hotels.forEach(h => withs.push(h.with));
  const given = withs.filter(Boolean);
  assert.ok(given.length > 0, '應該有 with');
  given.forEach(w => { assert.ok(Array.isArray(w) && w.length); w.forEach(id => assert.ok(ids.has(id), 'with 必須是成員 id：' + id)); });
  const txt = JSON.stringify(cfg);
  for (const k of ['"unsure"', '"withUnknown"', '"dismissedAlerts"']) assert.ok(!txt.includes(k), '不應輸出 ' + k);
  // 11/3 兩張卡都在，各自帶名單
  const d3 = cfg.days.filter(d => d.date === '11/3');
  assert.strictEqual(d3.length, 2);
  assert.notDeepStrictEqual(d3[0].with, d3[1].with);
});
test('3-3 來回一致：匯出 → 還原 → 再匯出，兩次結果相同；提醒清單也相同', () => {
  const imported = importAi(path.join(AI, 'reference.json'));
  const e1 = exportOf(imported.g);
  const g1 = restoreConfig(e1), e2 = exportOf(g1);
  const noSw = c => { const o = clone(c); delete o.meta.swCacheKey; return o; };   // 載入設定檔 = 新版部署，快取版號 +1（既有行為）
  assert.deepStrictEqual(noSw(e2), noSw(e1));
  const g2 = restoreConfig(e2);
  assert.deepStrictEqual(noSw(exportOf(g2)), noSw(e2));
  assert.deepStrictEqual(alertsOf(g2), alertsOf(g1));
  // 還原後提醒只比「匯入 AI 回傳當下」少 A-5：unsure 是 AI 的判讀旗標，不寫進設定檔
  const lost = imported.alerts.filter(a => a.code !== 'A-5');
  assert.deepStrictEqual(alertsOf(g1).map(a => a.key).sort(), lost.map(a => a.key).sort());
  assert.strictEqual(g1.run('state.splitUp'), true);
});
test('3-4 還原同一份匯出檔兩次，成員 id、日卡 id 都不變', () => {
  const e1 = refExport();
  for (let i = 0; i < 2; i++) {
    const g = restoreConfig(e1);
    assert.deepStrictEqual(clone(g.run('state.members.map(m => m.id)')), e1.members.map(m => m.id));
    assert.deepStrictEqual(clone(g.run('state.days.map(d => d.id)')), e1.days.map(d => d.id));
    assert.deepStrictEqual(clone(g.run('state.groups.map(x => x.id)')), e1.groups.map(x => x.id));
  }
});
test('3-5 沒有 groups、沒有成員 id 的舊設定檔：可還原、可匯出；匯出補成員 id、不輸出分組欄位', () => {
  const old = readJson(path.join(root, 'scripts/demo-config.json'));
  old.members.forEach(m => assert.ok(!('id' in m)));
  const g = restoreConfig(old);
  const out = exportOf(g);
  assert.ok(out.members.every(m => m.id));
  assert.ok(!('groups' in out));
  assert.ok(out.days.every(d => !('id' in d) && !('with' in d)));
  assert.strictEqual(g.run('state.splitUp'), false);
});
test('3-5b 載入設定檔時，步驟 1 已填的組別仍用名字對上載入的成員（沒有 groups 的檔）', () => {
  const g = loadGenerator();
  g.run(`state.splitUp = true; state.members = [{ name: 'Claire', avatar: '' }, { name: 'Tony', avatar: '' }];
    ensureMemberIds(); state.groups = [{ id: 'g1', name: 'A', order: 0, memberIds: [state.members[1].id] }];`);
  g.ctx.__cfg = readJson(path.join(root, 'generator/schema-example.json'));
  g.run('importLoadedConfig(__cfg)');
  assert.deepStrictEqual(clone(g.run('state.groups[0].memberIds.map(memberName)')), ['Tony']);
});
test('3-13c 有 A-1／A-6 時下載與分享都被擋下並顯示「還有 n 處需要確認」；修正後可正常匯出', async () => {
  const bad = importAi(path.join(AI, 'reference.json'), out => {
    out.days.find(d => (d.with || []).includes('福岡組')).with = ['福岡團'];
    out.days[0].date = '十一月一日';
  });
  const g = bad.g;
  const html = g.run('exportBlockedHtml()');
  assert.ok(/還有 2 處需要確認/.test(html), html);
  assert.ok(html.includes('goTo(1)'), '連回步驟 2');
  // 下載
  g.ctx.window.JSZip = function () { throw new Error('不該走到打包'); };
  g.el('download-status').innerHTML = '';
  g.el('f-title').value = 'x'; g.run(`state.fields['f-title'] = 'x'`);
  g.run('downloadZip()');
  assert.ok(g.el('download-status').innerHTML.includes('還有 2 處需要確認'));
  // 分享
  let err = null;
  try { g.run('buildShareUrl()').catch(e => { err = e; }); await new Promise(r => setImmediate(r)); } catch (e) { err = e; }
  assert.ok(err && err.message.includes('還有 2 處需要確認'), '分享連結被擋下');
  // 修正後：沒有擋下
  const ok = importAi(path.join(AI, 'reference.json'));
  assert.strictEqual(ok.g.run('exportBlockedHtml()'), '');
  // 只有可略過的提醒（A-5）不擋
  assert.ok(ok.alerts.some(a => a.code === 'A-5'));
  // 沒分組不檢查
  assert.strictEqual(loadGenerator().run('exportBlockedHtml()'), '');
});
test('3-14 組名標籤文字對比：七款主題三種外觀皆 ≥ 4.5:1', () => {
  const g = loadGenerator();
  const themes = clone(g.run('THEMES'));
  assert.strictEqual(themes.length, 7);
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  themes.forEach(t => {
    const deep = gt.deepTagColor(t.color);
    const rows = [['實心 白字／深底', '#ffffff', deep], ['外框 深字／白底', deep, '#ffffff'], ['淡底加框 深字／淡底', deep, t.pale], ['成員頭像 文字／淡底', '#1e0d12', t.pale]];
    rows.forEach(([n, fg, bg]) => assert.ok(ratio(fg, bg) >= 4.5, `${t.name} ${n} = ${ratio(fg, bg).toFixed(2)}`));
  });
});

// App 樣板裡複製的純函式，要跟 generator/group-trip.js 的結果一致（兩邊各維護一份，靠這條保證不分岔）
test('3-0 App 樣板與 group-trip.js 的名單換算／標籤配色／名單反推結果一致', () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(root, 'generator/template-src.html'), 'utf8');
  const m = /\/\/ <group-pure-begin>([\s\S]*?)\/\/ <group-pure-end>/.exec(src);
  assert.ok(m, '找不到 group-pure 區段');
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx);
  const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const groups = [{ memberIds: ['a', 'b'] }, { memberIds: ['c', 'd'] }, { memberIds: ['a', 'c', 'd'] }];
  const lists = [undefined, [], ['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'], ['a', 'b'], ['b', 'a'], ['c', 'd'], ['a', 'c', 'd'], ['a'], ['d', 'a'], ['b', 'c', 'd']];
  lists.forEach(l => assert.deepStrictEqual(clone(ctx.describeList(l, groups, members)), clone(gt.describeList(l, groups, members)), JSON.stringify(l)));
  ['#a8362f', '#5d7242', '#2e6e72', '#a6586a', '#2c456c', '#6a5897', '#b8842a', '', 'x', null].forEach(h => assert.strictEqual(ctx.deepTagColor(h), gt.deepTagColor(h), String(h)));
  [0, 1, 2, 3, 4, 5].forEach(i => assert.deepStrictEqual(clone(ctx.groupTagStyle(i, '#782825', '#f3e3d8')), clone(gt.groupTagStyle(i, '#782825', '#f3e3d8'))));
  assert.deepStrictEqual(clone(ctx.groupTagStyle(1, '#782825')), clone(gt.groupTagStyle(1, '#782825')));
});

Promise.all(pendingTests).then(() => {
  console.log(`\n${pass} 通過、${fail} 失敗`);
  process.exit(fail ? 1 : 0);
});
