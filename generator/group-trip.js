// ═══════════════════════════════════════════════════════════════════
// 分組旅行：純函式（不碰 DOM）。generator-app.js 之前載入；Node 測試直接 require。
// 規格：docs/design-handoff/group-trip/（decisions.md、ai-prompt.md）
//
// 資料約定：
//   成員 members   [{ id, name, avatar }]
//   組別 groups    [{ id, name, memberIds, order }]（名單的別名，最多 3 組）
//   日卡／活動／住宿／航班的 `with`：成員 id 陣列；空值或沒有 = 全員（日卡）／沿用日卡（活動）
//   `withUnknown`：AI 寫了對不到組名或代號的字串（A-1 用）
//   `unsure`：AI 標示沒把握（A-5 用）
// ═══════════════════════════════════════════════════════════════════

// 提示詞分組段落（第 3 版定稿，文字以 docs/design-handoff/group-trip/ai-test/group-section.txt 為準）
const GROUP_SECTION_TEMPLATE = `分組（使用者已設定，只能用這些組名與代號，不要新增或改寫）：
{分組清單}

分組規則：
- members 只列上面的代號，name 照抄
- 同一天兩組在不同地方：拆成兩筆 days，date、day 相同，各自填 with、theme、emoji、hotel、acts
- 全員一起的日子：一筆 days，不填 with
- 只有部分人在旅途中的日子（還沒出發、已經離開）：只建那些人的卡，with 填他們的組名
- 會合日、分開日：一筆全員卡；只屬於某組的活動，在那筆活動填 with
- with 是陣列，只能放上面的組名或代號；整組同行寫組名，不要拆成組員；跨組或單獨行動才列代號
- 活動沒填 with = 跟這張卡同一批人
- day = 全團第幾天，從草稿最早的日期算起；同一天的兩張卡 day 相同
- 草稿裡的組名寫法不同（例：某某團、簡稱），對應到上面最接近的組名
- 草稿沒寫清楚是誰，或你是推測的：在那筆加 "unsure": true；不要為了填滿而猜
- 各組住不同地方時，hotels 也加 with；全員卡上的 hotel 只有部分人住時（例：分開日），那張卡的 hotel 也加 with；flight 同理
- 會合日各組的抵達活動，time 填抵達時間（不是出發時間），出發時間寫在 sub

分組時 days 的格式範例（其他欄位照下方 Schema）：
[
  { "day": 2, "date": "5/2", "wd": "六", "theme": "大阪", "emoji": "🏯", "with": ["A組"], "acts": [] },
  { "day": 2, "date": "5/2", "wd": "六", "theme": "京都", "emoji": "⛩️", "with": ["B組", "小明"], "unsure": true, "acts": [] },
  { "day": 3, "date": "5/3", "wd": "日", "theme": "奈良會合", "emoji": "🦌",
    "acts": [
      { "icon": "🚃", "name": "近鐵抵達奈良", "time": "10:00", "with": ["A組"] },
      { "icon": "🚃", "name": "JR 抵達奈良", "time": "11:30", "with": ["B組"] },
      { "icon": "📍", "name": "東大寺集合", "time": "13:00" }
    ]
  }
]

`;

// 插在 PARSE_PROMPT「JSON Schema（嚴格遵守）：」之前
const GROUP_PROMPT_ANCHOR = 'JSON Schema（嚴格遵守）：';

// groups：[{ name, members: [代號…] }]，一組一行
function buildGroupSection(groups) {
  const list = (groups || []).map(g => `- ${g.name}：${(g.members || []).join('、')}`).join('\n');
  return GROUP_SECTION_TEMPLATE.replace('{分組清單}', list);
}

// ── 名單換算 ────────────────────────────────────────────────────────
function _gtIds(members) { return (members || []).map(m => m.id); }
function _gtSortByMembers(ids, members) {
  const order = new Map(_gtIds(members).map((id, i) => [id, i]));
  return [...new Set(ids)].sort((a, b) => order.get(a) - order.get(b));
}
function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}
// 空值 = 全員
function effectiveIds(withIds, members) {
  return withIds && withIds.length ? withIds : _gtIds(members);
}

// 組名／代號 → 成員 id 清單（依成員順序、去重）＋對不到的字串
// groups：[{ name, memberIds }]；members：[{ id, name }]
function resolveWith(withArr, groups, members) {
  const list = withArr == null ? [] : (Array.isArray(withArr) ? withArr : [withArr]);
  const ids = [], unknown = [];
  list.forEach(raw => {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return;
    const g = (groups || []).find(x => x.name === s);
    if (g) { ids.push(...g.memberIds); return; }
    const m = (members || []).find(x => x.name === s);
    if (m) { ids.push(m.id); return; }
    unknown.push(s);
  });
  return { ids: _gtSortByMembers(ids, members), unknown };
}

// 匯入時把 AI 回的成員併進現有成員（用名字對）：保留 id 與頭像，AI 多給的才新增
function mergeMembers(prev, incoming) {
  const out = (prev || []).map(m => ({ ...m }));
  (incoming || []).forEach(m => {
    const old = out.find(x => x.name === m.name);
    if (old) { if (m.avatar) old.avatar = m.avatar; }
    else out.push({ ...m });
  });
  return out;
}

function normalizeImported(data, groups, members) {
  const out = JSON.parse(JSON.stringify(data || {}));
  const hasGroups = (groups || []).length > 0;
  const all = _gtIds(members);

  // with → ids；回傳寫回物件的結果
  const conv = (obj, fallbackIds) => {
    if (!obj || typeof obj !== 'object') return;
    const raw = obj.with, unsure = obj.unsure === true;
    delete obj.with; delete obj.unsure; delete obj.withUnknown;
    if (!hasGroups) return;                       // 沒分組：丟掉 with／unsure，行為跟以前一樣
    if (unsure) obj.unsure = true;
    const given = raw != null && !(Array.isArray(raw) && !raw.length);
    if (!given) return;
    const r = resolveWith(raw, groups, members);
    if (r.unknown.length) obj.withUnknown = r.unknown;
    if (r.ids.length && !sameIdSet(r.ids, fallbackIds)) obj.with = r.ids;
  };

  (out.days || []).forEach(d => {
    conv(d, all);
    const cardIds = effectiveIds(d.with, members);
    (d.acts || []).forEach(a => conv(a, cardIds));
    if (d.hotel) conv(d.hotel, cardIds);
    if (d.flight) conv(d.flight, cardIds);
  });
  (out.hotels || []).forEach(h => conv(h, all));

  // 同日多卡排序：全員卡最前，其餘依 D1 組別順序（日期順序不動）
  if (hasGroups && Array.isArray(out.days)) {
    const rank = d => {
      const ids = effectiveIds(d.with, members);
      if (sameIdSet(ids, all)) return -1;
      const i = groups.findIndex(g => sameIdSet(g.memberIds, ids));
      return i >= 0 ? i : groups.length;
    };
    const firstAt = new Map();
    out.days.forEach((d, i) => { if (!firstAt.has(d.date)) firstAt.set(d.date, i); });
    out.days = out.days
      .map((d, i) => ({ d, i }))
      .sort((x, y) => (firstAt.get(x.d.date) - firstAt.get(y.d.date)) || (rank(x.d) - rank(y.d)) || (x.i - y.i))
      .map(x => x.d);
  }
  return out;
}

// ── 判讀提醒 ────────────────────────────────────────────────────────
// 'M/D' → Date；無法解析回 null
function _gtParseDate(md, year) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(md || '').trim());
  if (!m) return null;
  return new Date(year, Number(m[1]) - 1, Number(m[2]));
}
function _gtFmt(t) { return `${t.getMonth() + 1}/${t.getDate()}`; }

// state：{ members, groups, days, hotels, year, dismissed }
// 回傳 [{ code, key, dismissable, … }]；沒分組回傳空陣列（規則 7）；已略過的不回傳
function computeAlerts(state) {
  const members = state.members || [], groups = state.groups || [];
  if (!groups.length) return [];
  const days = state.days || [], year = state.year || new Date().getFullYear();
  const dismissed = new Set(state.dismissed || []);
  const all = _gtIds(members), nameOf = id => (members.find(m => m.id === id) || {}).name || '';
  const alerts = [];
  const push = (a) => { a.dismissable = a.code !== 'A-1'; if (!(a.dismissable && dismissed.has(a.key))) alerts.push(a); };

  const cards = days.map(d => {
    const set = effectiveIds(d.with, members), pd = _gtParseDate(d.date, year);
    return {
      d, set, date: d.date, time: pd ? pd.getTime() : null,
      acts: (d.items || []).filter(it => it.type === 'activity')
        .map(it => ({ it, set: it.with && it.with.length ? it.with : set })),
    };
  });

  // A-1：用了設定裡沒有的組名
  days.forEach(d => {
    (d.withUnknown || []).forEach(s => push({ code: 'A-1', key: `A-1|${d.id}|${s}`, name: s, dayId: d.id, date: d.date }));
    (d.items || []).forEach(it => (it.withUnknown || []).forEach(s =>
      push({ code: 'A-1', key: `A-1|${it.id}|${s}`, name: s, dayId: d.id, itemId: it.id, date: d.date })));
  });
  (state.hotels || []).forEach((h, i) => (h.withUnknown || []).forEach(s =>
    push({ code: 'A-1', key: `A-1|hotel${i}|${s}`, name: s, hotelIndex: i })));

  // A-2：同一人同一天出現在兩張以上的卡
  [...new Set(cards.map(c => c.date))].forEach(date => {
    all.forEach(id => {
      const hit = cards.filter(c => c.date === date && c.set.includes(id));
      if (hit.length > 1) push({ code: 'A-2', key: `A-2|${date}|${id}`, memberId: id, name: nameOf(id), date, dayIds: hit.map(c => c.d.id) });
    });
  });

  // A-3：自己第一張卡到最後一張卡之間，某天沒有卡
  all.forEach(id => {
    const mine = cards.filter(c => c.time != null && c.set.includes(id)).map(c => c.time);
    if (!mine.length) { push({ code: 'A-3', key: `A-3||${id}`, memberId: id, name: nameOf(id), date: '' }); return; }
    const have = new Set(mine.map(t => _gtFmt(new Date(t))));
    const last = Math.max(...mine);
    for (const t = new Date(Math.min(...mine)); t.getTime() <= last; t.setDate(t.getDate() + 1)) {
      const date = _gtFmt(t);
      if (!have.has(date)) push({ code: 'A-3', key: `A-3|${date}|${id}`, memberId: id, name: nameOf(id), date });
    }
  });

  // A-4：會合日／分開日的全員卡，某組沒有自己的活動
  cards.filter(c => c.time != null && sameIdSet(c.set, all)).forEach(c => {
    const boundary = [-1, 1].some(n => {
      const nd = new Date(c.time); nd.setDate(nd.getDate() + n);
      const near = cards.filter(x => x.time != null && _gtFmt(new Date(x.time)) === _gtFmt(nd));
      return near.length && !near.some(x => sameIdSet(x.set, all));
    });
    if (!boundary) return;
    groups.forEach(g => {
      if (!c.acts.some(x => sameIdSet(x.set, g.memberIds)))
        push({ code: 'A-4', key: `A-4|${c.d.id}|${g.id}`, dayId: c.d.id, date: c.date, groupId: g.id, groupName: g.name });
    });
  });

  // A-5：AI 沒把握
  cards.forEach(c => {
    if (c.d.unsure) push({ code: 'A-5', key: `A-5|${c.d.id}`, dayId: c.d.id, date: c.date });
    c.acts.forEach(x => { if (x.it.unsure) push({ code: 'A-5', key: `A-5|${x.it.id}`, dayId: c.d.id, itemId: x.it.id, date: c.date, title: x.it.title }); });
  });
  return alerts;
}

if (typeof module !== 'undefined') {
  module.exports = { GROUP_SECTION_TEMPLATE, GROUP_PROMPT_ANCHOR, buildGroupSection, resolveWith, mergeMembers, normalizeImported, computeAlerts, effectiveIds, sameIdSet };
}
