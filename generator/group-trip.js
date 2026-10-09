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

  // 名單只有對不上的組名（A-1）時當成沒人，才不會被當成全員而連帶觸發其他提醒（check.js 同）
  const unresolved = o => !(o.with && o.with.length) && o.withUnknown && o.withUnknown.length;
  const cards = days.map(d => {
    const set = unresolved(d) ? [] : effectiveIds(d.with, members), pd = _gtParseDate(d.date, year);
    return {
      d, set, date: d.date, time: pd ? pd.getTime() : null,
      acts: (d.items || []).filter(it => it.type === 'activity')
        .map(it => ({ it, set: unresolved(it) ? [] : (it.with && it.with.length ? it.with : set) })),
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

// ═══ 包 2：產生器畫面用的純函式 ═══════════════════════════════════════

// ── 組名標籤配色 ────────────────────────────────────────────────────
// 深色 = 主題主色混入 #1e0d12 35%（Colors.dc.html；七款主題對比皆 ≥ 4.51:1）
function deepTagColor(themeHex) {
  const hx = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16));
  const base = /^#[0-9a-f]{6}$/i.test(themeHex || '') ? themeHex : '#a8362f';
  const ink = hx('#1e0d12');
  return '#' + hx(base).map((v, i) => Math.round(v * 0.65 + ink[i] * 0.35).toString(16).padStart(2, '0')).join('');
}
// 第 1 組實心、第 2 組外框、第 3 組淡底加框；回傳標籤本體與圓點的 inline style
function groupTagStyle(index, deep, pale) {
  const kind = index % 3;
  if (kind === 0) return { tag: `background:${deep};color:#fff`, dot: 'background:#fff' };
  if (kind === 1) return { tag: `background:#fff;color:${deep};box-shadow:0 0 0 1.5px ${deep} inset`, dot: `background:${deep}` };
  return { tag: `background:${pale || '#f3e3d8'};color:${deep};box-shadow:0 0 0 1.5px ${deep} inset`, dot: `background:${deep}` };
}

// ── 名單反推顯示 ────────────────────────────────────────────────────
// 'all'：全員；'group'：恰等於某組；'members'：對不上任何一組（顯示成員頭像）
function describeList(ids, groups, members) {
  const all = _gtIds(members);
  const list = effectiveIds(ids, members);
  if (sameIdSet(list, all)) return { kind: 'all', ids: all };
  const i = (groups || []).findIndex(g => sameIdSet(g.memberIds, list));
  if (i >= 0) return { kind: 'group', index: i, group: groups[i], ids: list };
  return { kind: 'members', ids: _gtSortByMembers(list, members) };
}

// 把名單寫回 obj.with：等於預設（全員或日卡）就存空值
function setWithList(obj, ids, fallbackIds, members) {
  delete obj.withUnknown;
  const list = _gtSortByMembers(ids, members);
  if (!list.length || sameIdSet(list, fallbackIds)) delete obj.with;
  else obj.with = list;
}

// ── 改組別名單時，名單完全吻合的卡一起改（G-9）。回傳受影響的卡數 ──────────
function syncGroupLists(days, oldIds, newIds, members) {
  if (!newIds.length || sameIdSet(oldIds, newIds)) return 0;
  const all = _gtIds(members);
  let n = 0;
  (days || []).forEach(d => {
    let hit = false;
    const cardWas = d.with && d.with.length ? d.with : null;
    if (cardWas && sameIdSet(cardWas, oldIds)) { setWithList(d, newIds, all, members); hit = true; }
    const cardNow = effectiveIds(d.with, members);
    (d.items || []).forEach(it => {
      if (it.with && it.with.length && sameIdSet(it.with, oldIds)) { setWithList(it, newIds, cardNow, members); hit = true; }
    });
    if (hit) n++;
  });
  return n;
}

// ── A-2 修正：同一天其他卡把這個人拿掉 ───────────────────────────────
function keepMemberOnlyIn(days, dayId, memberId, members) {
  const target = (days || []).find(d => d.id === dayId);
  if (!target) return 0;
  const all = _gtIds(members);
  let n = 0;
  days.forEach(d => {
    if (d === target || d.date !== target.date) return;
    const eff = effectiveIds(d.with, members);
    if (!eff.includes(memberId)) return;
    const rest = eff.filter(x => x !== memberId);
    if (!rest.length) return;                     // 拿掉就沒人了：不動，交給使用者處理
    setWithList(d, rest, all, members);
    (d.items || []).forEach(it => {
      if (!it.with || !it.with.length) return;
      const kept = it.with.filter(x => rest.includes(x));
      setWithList(it, kept, rest, members);
    });
    n++;
  });
  return n;
}

// ── 這天一起行動：同日的卡合併成一張全員卡 ───────────────────────────────
// 活動原本屬於哪張卡，就在活動標上那張卡的名單，合併後才不會變成大家都有
function mergeSameDateCards(days, date, members) {
  const all = _gtIds(members);
  const cards = (days || []).filter(d => d.date === date);
  if (cards.length < 2) return false;
  const first = cards[0];
  const items = [];
  cards.forEach(c => {
    const eff = effectiveIds(c.with, members);
    (c.items || []).forEach(it => {
      if ((!it.with || !it.with.length) && !sameIdSet(eff, all)) it.with = _gtSortByMembers(eff, members);
      items.push(it);
    });
  });
  first.items = items;
  if (!first.theme) first.theme = (cards.find(c => c.theme) || {}).theme || '';
  first.selfDrive = cards.some(c => c.selfDrive);
  delete first.with; delete first.withUnknown; delete first.unsure;
  cards.slice(1).forEach(c => days.splice(days.indexOf(c), 1));
  return true;
}

// ── 這天分頭行動：替「這天沒出現的人」加一張卡；全員卡則拆成第 1 組＋其餘的人 ─────
// newCard：呼叫端建好的空白日卡（有 id）。回傳 true 表示有加卡
function splitDateCards(days, date, groups, members, newCard) {
  const all = _gtIds(members);
  const cards = (days || []).filter(d => d.date === date);
  if (!cards.length) return false;
  const covered = new Set();
  cards.forEach(c => effectiveIds(c.with, members).forEach(id => covered.add(id)));
  let list = all.filter(id => !covered.has(id));
  if (!list.length) {
    if (cards.length !== 1 || !groups.length) return false;
    const c = cards[0], a = groups[0].memberIds;
    if (sameIdSet(a, all)) return false;
    setWithList(c, a, all, members);
    list = all.filter(id => !a.includes(id));
  }
  const last = cards[cards.length - 1];
  Object.assign(newCard, { day: last.day, date: last.date, wd: last.wd });
  setWithList(newCard, list, all, members);
  days.splice(days.indexOf(last) + 1, 0, newCard);
  return true;
}

// ── 刪除成員：從所有名單拿掉；名單因此變空的，留一筆 withUnknown 觸發 A-1 提醒（規則 13）──
function removeMemberFromLists(state, memberId, memberName) {
  const strip = obj => {
    if (!obj.with || !obj.with.includes(memberId)) return;
    obj.with = obj.with.filter(x => x !== memberId);
    if (!obj.with.length) { delete obj.with; obj.withUnknown = [memberName || '（已刪除的成員）']; }
  };
  (state.groups || []).forEach(g => { g.memberIds = g.memberIds.filter(x => x !== memberId); });
  (state.days || []).forEach(d => { strip(d); (d.items || []).forEach(strip); });
  (state.hotels || []).forEach(strip);
}

// 同日的卡 day 編號相同，其餘依日期順序遞增
function renumberDaysByDate(days) {
  let n = 0, prev = null;
  (days || []).forEach(d => { if (d.date !== prev || !d.date) n++; prev = d.date; d.day = n; });
}

if (typeof module !== 'undefined') {
  module.exports = { deepTagColor, groupTagStyle, describeList, setWithList, syncGroupLists, keepMemberOnlyIn, mergeSameDateCards, splitDateCards, removeMemberFromLists, renumberDaysByDate, GROUP_SECTION_TEMPLATE, GROUP_PROMPT_ANCHOR, buildGroupSection, resolveWith, mergeMembers, normalizeImported, computeAlerts, effectiveIds, sameIdSet };
}
