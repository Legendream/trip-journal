// ═══════════════════════════════════════════════════════════════════
// 分組旅行：產生器畫面（D1 分組設定、步驟 2 各組成員、日卡標籤＋選擇器、判讀提醒）
// 純函式在 group-trip.js；這裡碰 DOM 與 state。規格：docs/design-handoff/group-trip/
// 規則 7：沒分組（groupRenderContext() 回傳 null）時，步驟 2 的 HTML 要跟加入分組功能前一樣。
// ═══════════════════════════════════════════════════════════════════

const G_PERSON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
const G_WARN_SVG = '<svg class="g-wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
const G_OK_SVG = '<svg class="g-wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const G_MAX_GROUPS = 3;

let _whoPicker = null;        // 開著的同行選擇器：{ kind:'day'|'item', di, idx, custom }
let _groupEditOpen = false;   // 步驟 2「各組成員」編輯區是否展開
let _groupSyncCount = 0;      // G-9：最近一次同步更新了幾張卡
let _alertRows = [];          // 目前畫面上的提醒列（按鈕用索引找）

// ── 小工具 ──────────────────────────────────────────────────────────
function memberById(id) { return state.members.find(m => m.id === id); }
function memberAvatar(m) { return m ? (m.avatar || '') : ''; }
// 一串成員的簡短顯示：大家都有頭像就只放頭像，否則放名字（手動建的成員沒有頭像）
function gAvatars(ids) {
  const ms = (ids || []).map(memberById).filter(Boolean);
  return ms.every(m => m.avatar) ? ms.map(m => m.avatar).join('') : ms.map(m => m.name).join('、');
}
function gNames(ids) { return (ids || []).map(memberName).join('、'); }
function groupsGrouped() { return activeGroups().length > 0; }
function gTheme() {
  return { deep: deepTagColor(state.fields['f-theme-color']), pale: state.fields['f-bg-pale'] || '#f3e3d8' };
}
function gYear() {
  const m = (state.fields['f-date-pill'] || '').match(/\d{4}/);
  return m ? parseInt(m[0]) : new Date().getFullYear();
}
function gAlerts(groups) {
  return computeAlerts({ members: state.members, groups, days: state.days, hotels: state.hotels, year: gYear(), dismissed: state.dismissedAlerts });
}
// 在 parent 裡確保有一個 id 的容器（沒分組時不留空元素，畫面才跟以前完全一樣）
function gSlot(id, parent, before) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    if (before) parent.insertBefore(el, before); else parent.appendChild(el);
  }
  return el;
}
function gDropSlot(id) {
  const el = document.getElementById(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function refreshPromptPreview() {
  const pa = document.getElementById('prompt-area');
  if (pa) pa.textContent = buildPrompt();
}
function onGroupsEdited() {
  refreshPromptPreview();
  saveState();
}

// ── 組名標籤（顯示狀態；點了開選擇器）────────────────────────────────
function gTagHtml(ctx, desc, opts) {
  const { onclick, sameLabel, unknown } = opts;
  if (unknown && unknown.length && desc.kind === 'all') {
    // AI 用了設定裡沒有的組名（A-1）：琥珀色標籤顯示原字串
    return `<button class="g-tag g-who-btn g-tag-bad" onclick="${onclick}" aria-label="同行的人：${escHtml(unknown.join('、'))}">${escHtml(unknown.join('、'))} ▾</button>`;
  }
  if (desc.kind === 'group') {
    const st = groupTagStyle(desc.index, ctx.deep, ctx.pale);
    return `<button class="g-tag g-who-btn" style="${st.tag}" onclick="${onclick}" aria-label="同行的人：${escHtml(desc.group.name)}"><span class="g-dot" style="${st.dot}"></span>${escHtml(desc.group.name)} ▾</button>`;
  }
  if (desc.kind === 'members') {
    return `<button class="g-avs g-who-btn" onclick="${onclick}" aria-label="同行：${escHtml(gNames(desc.ids))}">${escHtml(gAvatars(desc.ids))} ▾</button>`;
  }
  return `<button class="g-pbtn g-who-btn" onclick="${onclick}" aria-label="同行的人：${escHtml(sameLabel)}">${G_PERSON_SVG}▾</button>`;
}

function dayWhoHtml(ctx, d, i) {
  const desc = describeList(d.with, ctx.groups, state.members);
  return `<div class="g-who-row">${gTagHtml(ctx, desc, { onclick: `event.stopPropagation();openWho('day',${i})`, sameLabel: '全員', unknown: d.withUnknown })}</div>`;
}
function itemWhoHtml(ctx, d, i, it, idx) {
  const own = it.with && it.with.length ? it.with : null;
  const desc = own ? describeList(own, ctx.groups, state.members) : { kind: 'all' };
  const unknown = !own ? it.withUnknown : null;
  const tag = gTagHtml(ctx, desc, { onclick: `openWho('item',${i},${idx})`, sameLabel: '跟這天一樣', unknown });
  return `<div class="act-row2 g-item-who">${tag}</div>${whoPickerHtml('item', i, idx)}`;
}

// ── 同行選擇器（單選）──────────────────────────────────────────────
function whoTarget(w) {
  const d = state.days[w.di];
  if (!d) return null;
  if (w.kind === 'day') return { obj: d, fallback: state.members.map(m => m.id) };
  const it = d.items[w.idx];
  return it ? { obj: it, fallback: effectiveIds(d.with, state.members) } : null;
}
function whoCurrentIds(w) {
  const t = whoTarget(w);
  if (!t) return [];
  return t.obj.with && t.obj.with.length ? t.obj.with : t.fallback;
}
function whoPickerHtml(kind, di, idx) {
  const w = _whoPicker;
  if (!w || w.kind !== kind || w.di !== di || (kind === 'item' && w.idx !== idx)) return '';
  const t = whoTarget(w);
  if (!t) return '';
  const groups = activeGroups();
  const own = t.obj.with && t.obj.with.length ? t.obj.with : null;
  // 選中哪一項由名單反推；按過「自己選」就維持在自己選
  let sel;
  if (w.custom) sel = 'custom';
  else if (kind === 'item' && !own) sel = 'same';
  else {
    const desc = describeList(own, groups, state.members);
    sel = desc.kind === 'all' ? (kind === 'day' ? 'all' : 'custom') : desc.kind === 'group' ? 'g' + desc.index : 'custom';
  }
  const opt = (key, label, avatars) => {
    const on = sel === key;
    return `<button class="g-opt" role="radio" aria-checked="${on}" onclick="pickWho('${key}')"><span class="g-rdot${on ? ' on' : ''}">${on ? '<span class="g-rin"></span>' : ''}</span><span style="flex:1;${on ? 'font-weight:700;' : ''}">${escHtml(label)}</span>${avatars ? `<span class="g-rav">${escHtml(avatars)}</span>` : ''}</button>`;
  };
  const cur = whoCurrentIds(w);
  const pills = sel === 'custom' ? `<div class="g-pills" style="padding-left:34px;">${state.members.map(m =>
    `<button class="g-pill${cur.includes(m.id) ? ' on' : ''}" aria-pressed="${cur.includes(m.id)}" onclick="toggleWhoMember('${m.id}')">${escHtml(memberAvatar(m))} ${escHtml(m.name)}</button>`).join('')}</div>` : '';
  return `<div class="g-who-picker">
    <div class="g-pick-title">同行的人</div>
    <div role="radiogroup" aria-label="同行的人" style="display:flex;flex-direction:column;">
      ${kind === 'day' ? opt('all', '全員') : opt('same', '跟這天一樣')}
      ${groups.map((g, k) => opt('g' + k, g.name, gAvatars(g.memberIds))).join('')}
      ${opt('custom', '自己選')}
    </div>
    ${pills}
  </div>`;
}
function openWho(kind, di, idx) {
  const same = _whoPicker && _whoPicker.kind === kind && _whoPicker.di === di && (kind === 'day' || _whoPicker.idx === idx);
  _whoPicker = same ? null : { kind, di, idx, custom: false };
  renderDays();
}
function closeWho() {
  if (!_whoPicker) return;
  _whoPicker = null;
  renderDays();
}
function afterWhoChange() {
  renderDays();
  saveState();
}
function pickWho(key) {
  const w = _whoPicker;
  const t = w && whoTarget(w);
  if (!t) return;
  if (key === 'custom') { w.custom = true; renderDays(); return; }
  const groups = activeGroups();
  const ids = key === 'all' || key === 'same' ? t.fallback : groups[Number(key.slice(1))].memberIds;
  setWithList(t.obj, ids, t.fallback, state.members);
  _whoPicker = null;      // 選了組別、全員、跟這天一樣後自動關閉
  afterWhoChange();
}
function toggleWhoMember(id) {
  const w = _whoPicker;
  const t = w && whoTarget(w);
  if (!t) return;
  const cur = whoCurrentIds(w);
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
  if (!next.length) return;      // 至少留一個人
  setWithList(t.obj, next, t.fallback, state.members);
  afterWhoChange();               // 「自己選」維持開啟
}
document.addEventListener('click', e => {
  if (_whoPicker && !(e.target.closest && e.target.closest('.g-who-picker, .g-who-btn'))) closeWho();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWho(); });

// ── 判讀提醒 ────────────────────────────────────────────────────────
// 把演算出的提醒整理成畫面上的「列」：A-2 一人一天一列（兩張卡都顯示）、A-3 一天一列、A-5 一張卡一列
function buildAlertRows(alerts) {
  const rows = [];
  const a2 = new Map(), a3 = new Map(), a5 = new Map();
  alerts.forEach(a => {
    if (a.code === 'A-1') rows.push({ code: 'A-1', keys: [a.key], dismissable: false, text: `找不到「${a.name}」`, dayIds: a.dayId ? [a.dayId] : [] });
    else if (a.code === 'A-2') rows.push({ code: 'A-2', keys: [a.key], dismissable: true, text: `${a.name} 同一天出現兩次`, dayIds: a.dayIds, memberId: a.memberId });
    else if (a.code === 'A-3') {
      const r = a3.get(a.date) || { code: 'A-3', keys: [], dismissable: true, names: [], date: a.date };
      r.keys.push(a.key); r.names.push(a.name); a3.set(a.date, r);
    } else if (a.code === 'A-6') rows.push({ code: 'A-6', keys: [a.key], dismissable: false, text: `日期「${a.date}」看不懂，請改成 月/日（例：11/3）`, dayIds: [a.dayId] });
    else if (a.code === 'A-4') rows.push({ code: 'A-4', keys: [a.key], dismissable: true, text: `${a.groupName} 沒有活動`, dayIds: [a.dayId] });
    else if (a.code === 'A-5') {
      const r = a5.get(a.dayId) || { code: 'A-5', keys: [], dismissable: true, text: 'AI 沒把握，請確認同行的人', dayIds: [a.dayId] };
      r.keys.push(a.key); a5.set(a.dayId, r);
    }
  });
  a3.forEach(r => {
    const cards = state.days.filter(d => d.date === r.date);
    // 錨點：同一天的最後一張卡；那天完全沒有卡就接在日期較早的最後一張卡後面
    let anchor = cards.length ? cards[cards.length - 1] : null;
    if (!anchor) {
      const t = _gtParseDate(r.date, gYear());
      state.days.forEach(d => { const dt = _gtParseDate(d.date, gYear()); if (t && dt && dt <= t) anchor = d; });
    }
    r.text = r.date ? `${r.date} 沒有 ${r.names.join('、')} 的行程` : `沒有 ${r.names.join('、')} 的行程`;
    r.anchorId = anchor ? anchor.id : null;
    r.canSplit = cards.length > 0;
    rows.push(r);
  });
  a5.forEach(r => rows.push(r));
  return rows;
}
function alertRowHtml(rowIdx, row, dayId) {
  let fix = '';
  if (row.code === 'A-2' && dayId) {
    const d = state.days.find(x => x.id === dayId);
    fix = `<button class="g-fixb" onclick="fixAlertRow(${rowIdx},'${dayId}')">只留在${escHtml((d && d.theme) || '這張卡')}</button>`;
  }
  if (row.code === 'A-3' && row.canSplit) fix = `<button class="btn btn-secondary btn-sm" onclick="splitDay('${escHtml(row.date)}')">這天分頭行動</button>`;
  const skip = row.dismissable ? `<button class="g-skip" onclick="dismissAlertRow(${rowIdx})">略過</button>` : '';
  return `<div class="g-warn"><span style="flex:1;">${G_WARN_SVG}${escHtml(row.text)}</span>${fix}${skip}</div>`;
}
function dismissAlertRow(rowIdx) {
  const row = _alertRows[rowIdx];
  if (!row || !row.dismissable) return;
  state.dismissedAlerts = [...new Set([...(state.dismissedAlerts || []), ...row.keys])];
  renderDays();
  saveState();
}
function fixAlertRow(rowIdx, dayId) {
  const row = _alertRows[rowIdx];
  if (!row || row.code !== 'A-2') return;
  keepMemberOnlyIn(state.days, dayId, row.memberId, state.members);
  renderDays();
  saveState();
}

// ── renderDays 用的畫面片段 ──────────────────────────────────────────
// 沒分組回傳 null，renderDays 就完全不產生分組片段
function groupRenderContext() {
  const groups = activeGroups();
  if (!groups.length) return null;
  const t = gTheme();
  const ctx = { groups, deep: t.deep, pale: t.pale };
  _alertRows = buildAlertRows(gAlerts(groups));
  ctx.byDay = new Map();     // dayId → [rowIdx]
  ctx.a3After = new Map();   // dayId → [rowIdx]（接在那張卡後面的 A-3 提示框）
  _alertRows.forEach((r, k) => {
    if (r.code === 'A-3') {
      if (r.anchorId) ctx.a3After.set(r.anchorId, [...(ctx.a3After.get(r.anchorId) || []), k]);
      return;
    }
    (r.dayIds || []).forEach(id => ctx.byDay.set(id, [...(ctx.byDay.get(id) || []), k]));
  });
  return ctx;
}
function dayWarnHtml(ctx, d) {
  const idxs = ctx.byDay.get(d.id);
  return idxs ? idxs.map(k => alertRowHtml(k, _alertRows[k], d.id)).join('') : '';
}
// 日卡內容：標籤列、選擇器、提醒列（插在卡片標題下面）
function dayGroupHeadHtml(ctx, d, i) {
  return dayWhoHtml(ctx, d, i);
}
function dayGroupBelowHeaderHtml(ctx, d, i) {
  return whoPickerHtml('day', i) + dayWarnHtml(ctx, d);
}
// 卡片展開後的「這天分頭行動」：這天只有一張卡才出現
function dayGroupActionsHtml(ctx, d) {
  if (!d.date || state.days.filter(x => x.date === d.date).length !== 1) return '';
  return `<button class="btn btn-secondary btn-sm" style="margin-top:6px;" onclick="splitDay('${escHtml(d.date)}')">這天分頭行動</button>`;
}
// 全部日卡組好之後：同日的卡包成一組，下面接「這天一起行動」；A-3 提示框接在錨點卡後面
function assembleGroupedCards(ctx, cardHtml) {
  let out = '';
  let i = 0;
  while (i < state.days.length) {
    let j = i + 1;
    while (j < state.days.length && state.days[i].date && state.days[j].date === state.days[i].date) j++;
    const chunk = cardHtml.slice(i, j).join('');
    const a3 = state.days.slice(i, j).flatMap(d => ctx.a3After.get(d.id) || []).map(k => alertRowHtml(k, _alertRows[k], null)).join('');
    if (j - i > 1) {
      out += `<div class="g-pair">${chunk}<button class="btn btn-secondary btn-sm g-merge" onclick="mergeDay('${escHtml(state.days[i].date)}')">這天一起行動</button></div>`;
    } else out += chunk;
    if (a3) out += `<div class="g-a3">${a3}</div>`;
    i = j;
  }
  return out;
}
// 「每日行程」卡頂部的 A-0 計數
function renderAlertBar(ctx) {
  const dayCards = document.getElementById('day-cards');
  if (!dayCards || !dayCards.parentNode) return;
  if (!ctx || !_alertRows.length) { gDropSlot('group-alert-bar'); return; }
  const bar = gSlot('group-alert-bar', dayCards.parentNode, dayCards);
  bar.className = 'g-alert-bar';
  bar.innerHTML = `${G_WARN_SVG}${_alertRows.length} 處需要確認`;
}

// ── 這天分頭行動／一起行動 ───────────────────────────────────────────
function splitDay(date) {
  const nd = newDay(1);
  nd.id = genId();
  if (!splitDateCards(state.days, date, activeGroups(), state.members, nd)) return;
  nd.emoji = '📍';
  renderDays();
  saveState();
  const at = state.days.indexOf(nd);
  setTimeout(() => document.getElementById('day-' + at)?.classList.add('open'), 30);
}
function mergeDay(date) {
  const before = JSON.parse(JSON.stringify(state.days));
  if (!mergeSameDateCards(state.days, date, state.members)) return;
  state.days.forEach(_orderTimeline);
  renderDays();
  saveState();
  showUndoToast(`已合併 ${date} 的卡`, () => {
    state.days = before;
    renderDays();
    saveState();
  });
}

// ── 組別：資料操作 ───────────────────────────────────────────────────
function newGroup() {
  return { id: 'g' + Date.now().toString(36) + (_groupSeq++).toString(36), name: '', memberIds: [], order: 0 };
}
function reindexGroups() { state.groups.forEach((g, k) => { g.order = k; }); }
let _groupSeq = 0;
function findOrCreateMember(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  let m = state.members.find(x => x.name === n);
  if (!m) { m = { id: newMemberId(), name: n, avatar: '' }; state.members.push(m); }
  return m;
}
// 改某組的名單；名單完全吻合的卡一起改（G-9）
function setGroupMembers(gi, newIds) {
  const g = state.groups[gi];
  if (!g) return;
  const old = [...g.memberIds];
  g.memberIds = _gtSortByMembers(newIds, state.members);
  _groupSyncCount = state.days.length ? syncGroupLists(state.days, old, g.memberIds, state.members) : 0;
}
function deleteGroup(gi) {
  const g = state.groups[gi];
  if (!g) return;
  const removed = { ...g, memberIds: [...g.memberIds] };
  state.groups.splice(gi, 1);
  reindexGroups();
  _groupSyncCount = 0;
  refreshGroupViews();
  showUndoToast(`已刪除「${removed.name || '未命名'}」`, () => {
    state.groups.splice(gi, 0, removed);
    reindexGroups();
    refreshGroupViews();
  });
}
function addGroup() {
  if (state.groups.length >= G_MAX_GROUPS) return;
  state.groups.push(newGroup());
  reindexGroups();
  _groupSyncCount = 0;
  refreshGroupViews();
}
function setGroupName(gi, v) {
  if (state.groups[gi]) state.groups[gi].name = v;
  updateGroupNameHints();
  onGroupsEdited();
}
// 組名重複或沒填：標紅字提醒（不擋）
function groupNameHint(k) {
  const g = state.groups[k];
  if (!g) return '';
  const name = (g.name || '').trim();
  if (!name) return g.memberIds.length ? '還沒填組名，這組不會告訴 AI' : '';
  return state.groups.some((x, j) => j !== k && (x.name || '').trim() === name) ? '組名和別組重複，AI 和標籤都分不出來' : '';
}
function updateGroupNameHints() {
  document.querySelectorAll('[data-hint]').forEach(el => { el.textContent = groupNameHint(Number(el.getAttribute('data-hint'))); });
}
// 組別或成員變了之後，重畫有用到的地方
function refreshGroupViews() {
  renderSplitSetup();
  renderGroupMembers();
  if (document.getElementById('day-cards')) renderDays();
  renderMembers();
  onGroupsEdited();
}

// ── D1：步驟 1「有人分頭行動嗎？」──────────────────────────────────────
let _splitOffNotice = '';
// 切回「全程一起」時，若行程裡有同一天兩張以上的卡，說明它們會保留、但不再標示誰跟哪張
function splitOffNoticeText() {
  const byDate = new Map();
  state.days.forEach(d => { if (d.date) byDate.set(d.date, (byDate.get(d.date) || 0) + 1); });
  const multi = [...byDate].filter(([, n]) => n > 1);
  if (!multi.length) return '';
  return `你的行程裡有 ${multi.length} 天分頭走（例如 ${multi[0][0]} 有 ${multi[0][1]} 張卡）。切回「全程一起」後這些卡會保留，但不會標示誰跟哪張。想改成大家一起走，請到步驟 2 按「這天一起行動」。`;
}
function setSplitUp(on) {
  _splitOffNotice = on ? '' : splitOffNoticeText();
  state.splitUp = !!on;
  if (on && !state.groups.length) { state.groups.push(newGroup(), newGroup()); reindexGroups(); }
  refreshGroupViews();
}
function addGroupMemberFromInput(gi, inputEl) {
  const m = findOrCreateMember(inputEl.value);
  if (!m) return;
  inputEl.value = '';
  const g = state.groups[gi];
  if (g && !g.memberIds.includes(m.id)) setGroupMembers(gi, [...g.memberIds, m.id]);
  refreshGroupViews();
  const again = document.querySelector(`#split-setup [data-gi="${gi}"] .g-member-input`);
  if (again) again.focus();
}
function removeGroupMember(gi, id) {
  const g = state.groups[gi];
  if (!g) return;
  setGroupMembers(gi, g.memberIds.filter(x => x !== id));
  // 行程還沒匯入、也沒屬於其他組：這個人是為了分組才建的，一起移除
  const inOther = state.groups.some(x => x.memberIds.includes(id));
  if (!inOther && !state.days.length) state.members = state.members.filter(m => m.id !== id);
  refreshGroupViews();
}
// 圓點：第 1 組實心深色、第 2 組白底深框、第 3 組淡底深框
function gDotStyle(k, ctx) {
  const kind = k % 3;
  if (kind === 0) return `background:${ctx.deep}`;
  if (kind === 1) return `background:#fff;box-shadow:0 0 0 2px ${ctx.deep} inset`;
  return `background:${ctx.pale};box-shadow:0 0 0 2px ${ctx.deep} inset`;
}
// 「有人分頭行動嗎？」入口：行程 App 端還沒支援分組，暫時只在網址帶 ?groups=1 時顯示
// （已經選了「有分頭」的草稿照常顯示，免得被鎖在裡面）
let _gFeatureSeen = false;   // 這次開啟頁面期間入口出現過就一直留著，切回「全程一起」才看得到說明、也切得回來
function groupFeatureOn() {
  if (state.splitUp || /[?&]groups=1(&|$)/.test((typeof location !== 'undefined' && location.search) || '')) _gFeatureSeen = true;
  return _gFeatureSeen;
}
function renderSplitSetup() {
  const ta = document.getElementById('trip-text');
  if (!ta || !ta.parentNode) return;
  if (!groupFeatureOn()) { gDropSlot('split-setup'); return; }
  const host = gSlot('split-setup', ta.parentNode, ta.nextSibling);
  const on = !!state.splitUp;
  const t = gTheme();
  const ctx = { deep: t.deep, pale: t.pale };
  let html = `<div class="g-split-q">有人分頭行動嗎？</div>
    <div class="g-toggle" role="radiogroup" aria-label="有人分頭行動嗎？">
      <button class="g-tog${on ? '' : ' on'}" role="radio" aria-checked="${!on}" onclick="setSplitUp(false)">全程一起</button>
      <button class="g-tog${on ? ' on' : ''}" role="radio" aria-checked="${on}" onclick="setSplitUp(true)">有分頭</button>
    </div>${!on && _splitOffNotice ? `<div class="g-hint" style="margin-top:10px;">${escHtml(_splitOffNotice)}</div>` : ''}`;
  if (on) {
    html += `<div class="g-split-groups"><div class="g-split-title">各組成員</div><div class="g-hint">組名照草稿的寫法填，AI 才對得上</div>`;
    html += state.groups.map((g, k) => `<div class="g-group" data-gi="${k}">
        <div class="g-gname">
          <span class="g-dot g-dot-lg" style="${gDotStyle(k, ctx)}"></span>
          <input class="g-inp" aria-label="組名" placeholder="例：福岡組" value="${escHtml(g.name)}" oninput="setGroupName(${k},this.value)">
          <button class="g-x" aria-label="刪除這組" onclick="deleteGroup(${k})">✕</button>
        </div>
        <div class="g-bad" data-hint="${k}">${escHtml(groupNameHint(k))}</div>
        ${g.memberIds.length ? `<div class="g-chips">${g.memberIds.map(id => `<span class="g-chip">${escHtml(memberAvatar(memberById(id)))} ${escHtml(memberName(id))}<button class="g-x" aria-label="移除${escHtml(memberName(id))}" onclick="removeGroupMember(${k},'${id}')">✕</button></span>`).join('')}</div>` : ''}
        <input class="g-inp g-member-input" aria-label="成員" placeholder="代號或暱稱"
          onkeydown="if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();addGroupMemberFromInput(${k},this)}"
          onblur="if(this.value.trim())addGroupMemberFromInput(${k},this)">
      </div>`).join('');
    if (state.groups.length < G_MAX_GROUPS) html += `<button class="btn btn-secondary" style="align-self:flex-start;" onclick="addGroup()">＋ 再加一組</button>`;
    html += `</div>`;
  }
  host.innerHTML = html;
}

// ── 步驟 2：旅行成員卡內的「各組成員」──────────────────────────────────
function toggleGroupEdit() {
  _groupEditOpen = !_groupEditOpen;
  _groupSyncCount = 0;
  renderGroupMembers();
}
function toggleGroupMemberPill(gi, id) {
  const g = state.groups[gi];
  if (!g) return;
  const next = g.memberIds.includes(id) ? g.memberIds.filter(x => x !== id) : [...g.memberIds, id];
  setGroupMembers(gi, next);
  refreshGroupViews();
}
function renderGroupMembers() {
  const addRow = document.querySelector('.add-member-row');
  const grouped = groupsGrouped();
  if (!addRow || (!grouped && !_groupEditOpen)) { gDropSlot('group-members'); return; }
  const host = gSlot('group-members', addRow.parentNode);
  host.className = 'g-members';
  const t = gTheme();
  const ctx = { deep: t.deep, pale: t.pale };
  if (!_groupEditOpen) {
    const groups = activeGroups();
    host.innerHTML = `<div class="g-members-head"><div class="g-members-title">各組成員</div>
        <button class="btn btn-secondary btn-sm" aria-label="編輯各組成員" onclick="toggleGroupEdit()">✎ 編輯</button></div>
      <div class="g-members-sum">${groups.map((g, k) => {
        const st = groupTagStyle(k, ctx.deep, ctx.pale);
        return `<span class="g-grow"><span class="g-tag" style="${st.tag};cursor:default;"><span class="g-dot" style="${st.dot}"></span>${escHtml(g.name)}</span><span>${escHtml(gAvatars(g.memberIds))}</span></span>`;
      }).join('')}</div>`;
    return;
  }
  host.innerHTML = `<div class="g-members-head"><div class="g-members-title">各組成員</div>
      <button class="btn btn-secondary btn-sm" onclick="toggleGroupEdit()">完成</button></div>
    ${state.groups.map((g, k) => `<div class="g-group" data-gi="${k}">
        <div class="g-gname">
          <span class="g-dot g-dot-lg" style="${gDotStyle(k, ctx)}"></span>
          <input class="g-inp" aria-label="組名" placeholder="例：福岡組" value="${escHtml(g.name)}" oninput="setGroupName(${k},this.value)" onchange="renderDays()">
          <button class="g-x" aria-label="刪除這組" onclick="deleteGroup(${k})">✕</button>
        </div>
        <div class="g-bad" data-hint="${k}">${escHtml(groupNameHint(k))}</div>
        <div class="g-chips">${state.members.map(m => `<button class="g-pill${g.memberIds.includes(m.id) ? ' on' : ''}" aria-pressed="${g.memberIds.includes(m.id)}" onclick="toggleGroupMemberPill(${k},'${m.id}')">${escHtml(memberAvatar(m))} ${escHtml(m.name)}</button>`).join('')}</div>
      </div>`).join('')}
    ${_groupSyncCount ? `<div class="g-synced">${G_OK_SVG}已同步更新 ${_groupSyncCount} 張卡</div>` : ''}
    ${state.groups.length < G_MAX_GROUPS ? `<button class="btn btn-secondary" style="align-self:flex-start;" onclick="addGroup()">＋ 再加一組</button>` : ''}`;
}

// 分組行程改日期：同一天的卡 Day 編號要相同，依日期重新編號
function onDayDateChange() {
  renumberDaysByDate(state.days);
  renderDays();
  saveState();
}
