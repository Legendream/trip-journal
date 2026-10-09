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
function test(name, fn) {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n    ' + String(e.message).split('\n').join('\n    ')); }
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

// ── 1-10：成員 id ───────────────────────────────────────────────
test('1-10 舊資料補成員 id；匯出仍用名字、不輸出分組欄位', () => {
  const g = loadGenerator();
  const legacy = { step: 1, members: [{ name: '甲', avatar: '🐱' }, { name: '乙', avatar: '' }], days: [], hotels: [] };
  g.ctx.__legacy = JSON.stringify(legacy);
  g.run(`localStorage.setItem(STATE_KEY, __legacy); loadState();`);
  const ids = g.run('state.members.map(m => m.id)');
  assert.ok(ids.every(Boolean) && new Set(ids).size === 2, '每位成員都有不同的 id');
  const cfg = JSON.parse(JSON.stringify(g.run('collectConfig()')));
  assert.deepStrictEqual(cfg.members, legacy.members);
  assert.ok(!JSON.stringify(cfg).includes('"id":"m'));
});
test('1-10b 分組資料不會流進匯出設定檔', () => {
  const { g } = importAi(path.join(AI, 'reference.json'));
  const cfg = JSON.stringify(g.run('collectConfig()'));
  for (const k of ['"with"', '"withUnknown"', '"unsure"', '"groups"', '"memberIds"']) assert.ok(!cfg.includes(k), '不應輸出 ' + k);
  assert.ok(!/"id":"m/.test(cfg), '成員 id 不應輸出');
});

// ── 1-2、1-3：規則 7（沒分組跟改前一樣）──────────────────────────
test('1-2 schema-example.json 匯入→匯出，與改前基準一字不差（匯入設定檔、AI 匯入兩條路線）', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt-'));
  capture(path.join(root, 'generator/generator-app.js'), tmp);
  for (const f of ['schema-example.export.json', 'schema-example.ai-import.export.json']) {
    assert.strictEqual(fs.readFileSync(path.join(tmp, f), 'utf8'), fs.readFileSync(path.join(FIX, f), 'utf8'), f + ' 與基準不同');
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

console.log(`\n${pass} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
