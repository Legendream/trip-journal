// 用法：node make-pages.js  → 在 $OUT（預設系統暫存資料夾的 group-trip-pages）產生 {main,new}-{nogroup,nogroup-fb,grouped,grouped-fb,single-fb}.html
// main = BASE_REF（預設 62a76e9）的樣板，new = 目前工作區的樣板
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../../..');
const SP = process.env.OUT || path.join(require('os').tmpdir(), 'group-trip-pages');
fs.mkdirSync(SP, { recursive: true });
const BASE_REF = process.env.BASE_REF || '62a76e9';   // 「改前」樣板：包 3 合併後的 main
const GROUPED_REF = null;
const { loadGenerator } = require(path.join(root, 'scripts/lib/gen-sandbox'));
const AI = path.join(root, 'docs/design-handoff/group-trip/ai-test');

function fill(tmpl, cfg) {
  const m = cfg.meta;
  return tmpl
    .replace(/__TRIP_TITLE__/g, m.title).replace(/__SHORT_TITLE__/g, m.shortTitle)
    .replace(/__THEME_COLOR__/g, m.themeColor).replace(/__THEME_ACCENT__/g, m.themeAccent)
    .replace(/__THEME_LIGHT__/g, m.themeLight).replace(/__BG_COLOR__/g, m.bgColor)
    .replace(/__BG_PALE__/g, m.bgPale).replace(/__TRIP_HEADING__/g, m.heading || m.title)
    .replace(/__TRIP_SUBTITLE__/g, m.subtitle).replace(/__DATE_PILL__/g, m.datePill)
    .replace(/__DURATION_PILL__/g, m.durationPill).replace(/__PEOPLE_PILL__/g, m.peoplePill)
    .replace(/__TRIP_PIN__/g, m.pin || '0000')
    .split('__TRIP_CONFIG__').join(JSON.stringify(cfg));
}
const mockFb = fs.readFileSync(path.join(root, 'generator/generator-app.js'), 'utf8').match(/const PREVIEW_MOCK_FB = `([\s\S]*?)`;/)[1];
function withMock(html) {
  const FB_CDN_RE = /  <script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\n/g;
  return html.replace(FB_CDN_RE, '').replace('<script>\n// ─── Trip Config', () => mockFb + '<script>\n// ─── Trip Config');
}
function stripNet(html) { // 移除外部 script（離線也能跑）
  return html.replace(/  <script src="https:\/\/[^"]+"><\/script>\n/g, '');
}
const clone = o => JSON.parse(JSON.stringify(o));

// 沒分組設定檔：schema-example（去掉 firebase）
const schema = JSON.parse(fs.readFileSync(path.join(root, 'generator/schema-example.json'), 'utf8'));
schema.members.forEach(m => { m.id = m.id || m.name; });
const noFb = clone(schema); noFb.firebase = {}; noFb._quickShare = true; noFb.meta.pin = '0000';
const withFb = clone(schema); withFb.firebase = { apiKey: 'AIza-demo-mock', databaseURL: 'https://demo-mock.firebaseio.com' }; withFb.meta.pin = '0000';

// 分組設定檔：ai-test/reference.json 走產生器匯入再匯出
function groupedCfg(fb) {
  const { groups, year } = JSON.parse(fs.readFileSync(path.join(AI, 'groups.json'), 'utf8'));
  const out = JSON.parse(fs.readFileSync(path.join(AI, 'reference.json'), 'utf8'));
  const g = loadGenerator();
  g.ctx.__groups = groups; g.ctx.__out = out;
  g.run(`
    state.splitUp = true; state.members = [];
    __groups.forEach(gr => gr.members.forEach(n => { if (!state.members.some(m => m.name === n)) state.members.push({ name: n, avatar: ({小貓:'🐱',阿熊:'🐻',小魚:'🐟',阿鹿:'🦌'})[n] || '' }); }));
    ensureMemberIds();
    state.groups = __groups.map((gr, i) => ({ id: 'g' + i, name: gr.name, order: i, memberIds: gr.members.map(n => state.members.find(m => m.name === n).id) }));
    applyParsedData(__out);
  `);
  const cfg = JSON.parse(JSON.stringify(g.run('collectConfig()')));
  cfg.meta.pin = '0000'; cfg.meta.storagePrefix = cfg.meta.storagePrefix || 'kyushu2026';
  cfg.meta.themeColor = cfg.meta.themeColor || '#a8362f';
  cfg.firebase = fb ? { apiKey: 'AIza-demo-mock', databaseURL: 'https://demo-mock.firebaseio.com' } : {};
  if (!fb) cfg._quickShare = true;
  return cfg;
}
const grouped = groupedCfg(false), groupedFb = groupedCfg(true);
fs.writeFileSync(path.join(SP, 'grouped-config.json'), JSON.stringify(grouped, null, 1));

const tmplMain = require('child_process').execSync(`git show ${BASE_REF}:generator/template-src.html`, { cwd: root, maxBuffer: 1 << 28 }).toString('utf8');
const tmplNew = fs.readFileSync(path.join(root, 'generator/template-src.html'), 'utf8');
const build = (tmpl, cfg, fb) => stripNet(fb ? withMock(tmpl.replace(/<script src="https:\/\/www\.gstatic[^>]*><\/script>\n/g, '')) : tmpl).replace(/<script src="https:[^>]*><\/script>\n?/g, '');
for (const [tag, tmpl] of [['main', tmplMain], ['new', tmplNew]]) {
  const mk = (cfg, fb) => fill(fb ? withMock(tmpl) : tmpl, cfg).replace(/  <script src="https:\/\/[^"]+"><\/script>\n/g, '');
  fs.writeFileSync(path.join(SP, `${tag}-nogroup.html`), mk(noFb, false));
  fs.writeFileSync(path.join(SP, `${tag}-nogroup-fb.html`), mk(withFb, true));
  fs.writeFileSync(path.join(SP, `${tag}-grouped.html`), mk(grouped, false));
  fs.writeFileSync(path.join(SP, `${tag}-grouped-fb.html`), mk(groupedFb, true));
  const single = clone(withFb); single.members = [single.members[0]]; single.meta.peoplePill = '1人同行';
  fs.writeFileSync(path.join(SP, `${tag}-single-fb.html`), mk(single, true));
}
console.log('ok', Object.keys(grouped), grouped.members.map(m => m.id + ':' + m.name).join(' '), 'groups', JSON.stringify(grouped.groups));
