// ═══════════════════════════════════════════════════════════════════
// Trip-app generator — main controller
// ═══════════════════════════════════════════════════════════════════

// ── PARSE_PROMPT (用於複製到任意 AI) ─────────────────────────────────
const PARSE_PROMPT = `你是行程資料整理助手。請把以下行程資訊整理成結構化 JSON。

規則：
- date 格式：M/D（例：4/15）
- wd（星期）：用一二三四五六日，從日期計算
- emoji：為每天主題挑一個合適的 emoji
- acts 內每個活動的 icon：挑合適的 emoji
- map：適合 Google Maps 搜尋的地點關鍵字
- 如有附上圖片（機票、訂房確認截圖等），請一併從圖片中擷取資訊，與文字資料合併整理
- 若資料含班機、列車、演唱會等有明確時間的事件，務必擷取 time（格式 HH:MM）；圖片中的起飛/抵達時間優先於文字
- 若該天有班機（去程或回程），請填 flight 物件：label（去程航班/回程航班）、num（如 BR 198）、from/to（機場 IATA 代碼如 TPE/NRT）、fromCity/toCity（如桃園/成田）、dept（起飛 HH:MM）、arr（抵達 HH:MM）、boarding（登機 HH:MM，可選）；同時也在 acts 內保留對應活動
- 缺漏資訊一律用 null 或空陣列，不要瞎編
- 只回傳 JSON 物件本身，前後不要加任何說明文字、不要用 \`\`\` 包起來

JSON Schema（嚴格遵守）：
{
  "tripName": "旅程名稱含年份",
  "shortTitle": "短名稱4-6字",
  "subtitle": "城市1・城市2・城市3",
  "year": 2026,
  "datePill": "2026年4月15－22日",
  "durationPill": "8天7夜",
  "days": [
    {
      "day": 1, "date": "4/15", "wd": "三",
      "theme": "抵達仙台", "emoji": "✈️",
      "acts": [
        { "icon": "✈️", "name": "桃園飛仙台", "sub": "BR-198", "time": "10:30", "map": "仙台機場" }
      ],
      "hotel": { "name": "仙台國際飯店", "note": "已付", "paid": true, "map": "仙台國際飯店" },
      "flight": { "label": "去程航班", "num": "BR 198", "from": "TPE", "fromCity": "桃園", "to": "SDJ", "toCity": "仙台", "dept": "10:30", "arr": "14:00", "boarding": "10:00" }
    }
  ],
  "hotels": [
    { "nights": ["4/15","4/16"], "name": "飯店名", "loc": "仙台", "note": "費用", "paid": false, "map": "飯店名" }
  ],
  "members": [{ "name": "姓名", "avatar": "🧡" }],
  "checklist": ["護照","信用卡"],
  "notes": [{ "icon": "⚠️", "text": "…" }]
}

---
行程資訊：
`;

// ── People pill helpers ────────────────────────────────────────────
// 欄位儲存純數字（如 "2"）；輸出和預覽時組合成「2人同行」
function formatPeoplePill(n) {
  const s = String(n || '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? `${s}人同行` : s; // 數字 → 補後綴；其他 → 維持（相容舊資料）
}
function extractPeopleNumber(s) {
  const m = String(s || '').match(/^\d+/);
  return m ? m[0] : '';
}

// ── State ──────────────────────────────────────────────────────────
const STATE_KEY = 'trip-gen-state-v2';
const STEPS = ['匯入行程', '補齊資料', '挑選外觀', '產出分享'];
const STEPS_META = [
  { name: '匯入行程' },
  { name: '補齊資料' },
  { name: '挑選外觀' },
  { name: '產出分享' },
];

let state = {
  step: 0,
  path: 'ai',                 // 'ai' | 'manual' | 'load'
  tripText: '',
  jsonPaste: '',
  useFirebase: false,
  members: [],                // [{ id, name, avatar }]；id 只在產生器內部用，匯出設定檔時不帶
  groups: [],                 // 分組旅行：[{ id, name, memberIds, order }]，最多 3 組，只是成員名單的別名
  splitUp: false,             // D1「有分頭」開關；關閉時 groups 保留但不生效（規則 7）
  dismissedAlerts: [],        // 判讀提醒「略過」的 key
  days: [],
  hotels: [],
  parsedExtras: {},           // restaurants/weatherLocs/checklist/presetShopping/notes
  activeTheme: 0,
  fields: {                   // form values
    'f-title': '', 'f-subtitle': '',
    'f-date-pill': '', 'f-duration-pill': '', 'f-people-pill': '',
    'f-end-date': '', 'f-end-time': '',   // 結束日／結束時間 → cfg.meta.endDate/endTime（倒數用）
    'f-self-drive': false,     // 自駕行程 → 產出 App 才顯示停車場搜尋按鈕
    'f-region': '日本',        // 目的地地區 → 決定停車場搜尋用詞（駐車場/停車場/…）
    'f-pin': '', 'f-storage-prefix': '',
    'f-firebase': '',
    'f-theme-color': '#a8362f', 'f-theme-accent': '#c45a4f',
    'f-theme-light': '#e3a89c', 'f-bg-color': '#faf2ec', 'f-bg-pale': '#f3e3d8',
  },
};

// 和の色 — Japanese traditional palette, low chroma, paper-friendly.
// Each row tested for white-text-on-color legibility (used in deployed app's PIN overlay gradient).
// References: shudei / matcha / asagi / sakura / konjō / rikyū from 日本の伝統色 dictionaries.
// name = 易懂中文主名（卡片大字）；wa = 對應的正式日本傳統色名（小字副標）
// 註：原本「朱泥赭/淺蔥青/紺青藍…」非正式和色名（多為和色字根外掛顏色字、
//     且「朱泥」其實是陶土名），使用者反應困惑，故改為易懂主名＋正式和色副標。
const THEMES = [
  // 朱色 shuiro — vermilion terracotta，和 generator 主色同調、預設選項
  { name: '赭紅',     wa: '朱色',   color: '#a8362f', accent: '#c45a4f', light: '#e3a89c', bg: '#faf2ec', pale: '#f3e3d8' },
  // 抹茶色 matcha — muted matcha green
  { name: '抹茶綠',   wa: '抹茶色', color: '#5d7242', accent: '#7d8f5d', light: '#b5c193', bg: '#f3f2e6', pale: '#e2e3c8' },
  // 浅葱色 asagi — Edo 期常見的淺青（藍綠調）
  { name: '湖水綠',   wa: '浅葱色', color: '#2e6e72', accent: '#4f9094', light: '#94b8b9', bg: '#edf3f2', pale: '#d4e1de' },
  // 桜色 sakura — 櫻花粉
  { name: '櫻花粉',   wa: '桜色',   color: '#a6586a', accent: '#c87d8a', light: '#e3b6bb', bg: '#faf0ee', pale: '#f1d8da' },
  // 紺青 konjō — deep ink-navy blue，明治文人色
  { name: '靛藍',     wa: '紺青',   color: '#2c456c', accent: '#4d6791', light: '#92a4c2', bg: '#ecf0f6', pale: '#d4dde9' },
  // 藤色 fuji — muted wisteria purple
  { name: '藤紫',     wa: '藤色',   color: '#6a5897', accent: '#8a7ab2', light: '#b8aed1', bg: '#f0eef6', pale: '#ddd8e8' },
  // 山吹色 yamabuki — warm ochre / kerria yellow
  { name: '琥珀黃',   wa: '山吹色', color: '#b8842a', accent: '#d4a04c', light: '#e8c98a', bg: '#f7f0dd', pale: '#ecdcb6' },
];

// 目的地地區 → 當地「停車場」用詞（解決日本要搜「駐車場」才有資料的痛點）
const REGION_PARKING = {
  '日本': '駐車場', '台灣': '停車場', '韓國': '주차장',
  '香港・中國': '停車場', '歐美其他': 'parking',
};
function parkingTermFor(region) { return REGION_PARKING[region] || 'parking'; }

// 從地點/搜尋字串的文字特徵猜目的地地區（匯入舊檔時 best-effort）
function guessRegion(text) {
  const s = String(text || '');
  if (/[぀-ゟ゠-ヿ]/.test(s) || s.includes('駐車場')) return '日本';
  if (/[가-힣]/.test(s) || s.includes('주차장')) return '韓國';
  return '';
}

// ── Persistence ────────────────────────────────────────────────────
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  setIndicator('saving', '儲存中…');
  refreshMastheadTitle();
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      setIndicator('saved', '已儲存');
      setTimeout(() => setIndicator('', '就緒'), 4000);
      if (typeof maybeShowFirstSaveToast === 'function') maybeShowFirstSaveToast();
    } catch (e) {
      setIndicator('', '儲存失敗');
    }
  }, 400);
}
function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const loaded = JSON.parse(raw);
    state = { ...state, ...loaded, fields: { ...state.fields, ...(loaded.fields || {}) } };
    // 舊草稿/匯入備份可能是舊 day 形狀（acts/flight/hotel）→ 統一遷移成 items 模型
    state.days = migrateDays(state.days);
    state.days.forEach(_orderTimeline);
    ensureGroupState();
    return true;
  } catch (e) { return false; }
}
function setIndicator(cls, txt) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.className = 'save-indicator ' + cls;
  if (cls === 'saved') {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    el.textContent = `✓ ${txt} · ${hh}:${mm}`;
  } else if (cls === 'saving') {
    el.textContent = txt;
  } else {
    el.textContent = txt;
  }
}

// Sync the right-masthead doc title with the current trip name so users always
// know which trip they're editing (especially after switching tabs).
function refreshMastheadTitle() {
  const el = document.getElementById('masthead-doctitle');
  if (!el) return;
  const title = (state.fields['f-title'] || '').trim();
  if (title) {
    el.textContent = title;
    el.classList.remove('empty');
  } else {
    el.textContent = '未命名旅程';
    el.classList.add('empty');
  }
}

// Hydrate DOM from state
function hydrateUI() {
  Object.keys(state.fields).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!state.fields[id];
    else el.value = state.fields[id] || '';
  });
  document.getElementById('trip-text').value = state.tripText || '';
  document.getElementById('json-paste').value = state.jsonPaste || '';
  document.getElementById('f-firebase').value = state.fields['f-firebase'] || '';
  setPath(state.path || 'ai', true);
  setFirebaseMode(state.useFirebase, true);
  onSelfDriveToggle(true);
  updateTripText();
  updateJsonPaste();
  renderSplitSetup();
  goTo(state.step || 0);
}

// 自駕總開關：控制目的地地區欄顯隱（地區用詞只服務停車場搜尋），
// 並重繪 day cards 讓「這天自駕」逐天開關隨之出現／消失
function onSelfDriveToggle(skipSave) {
  const cb = document.getElementById('f-self-drive');
  if (cb) state.fields['f-self-drive'] = cb.checked;
  const regionField = document.getElementById('ff-region');
  if (regionField) regionField.style.display = state.fields['f-self-drive'] ? '' : 'none';
  if (document.getElementById('day-cards')) renderDays();
  if (!skipSave) saveState();
}

// 「這天自駕」逐天開關
function toggleDaySelfDrive(i) {
  if (!state.days[i]) return;
  state.days[i].selfDrive = !state.days[i].selfDrive;
  saveState();
  renderDays();
}

// 逐景點停車場開關（自駕日內，徒步景點可關掉）
function toggleItemPark(i, idx) {
  const it = state.days[i] && state.days[i].items[idx];
  if (!it) return;
  it.park = (it.park === false) ? undefined : false;
  saveState();
  renderDays();
}

// 景點列上的 🅿️ 小開關 HTML：只有「總開關開 + 這天自駕 + 非交通類」才顯示
function parkToggleHtml(i, idx, it) {
  if (!state.fields['f-self-drive']) return '';
  if (!state.days[i] || !state.days[i].selfDrive) return '';
  if (isTransitIcon(it.icon)) return '';
  const on = it.park !== false;
  const tip = on ? '需要查停車場（點一下改為徒步、不查）' : '徒步前往、不查停車場（點一下改回需要停車）';
  return `<button type="button" class="park-toggle${on ? ' on' : ''}" title="${tip}" onclick="toggleItemPark(${i},${idx})">🅿️</button>`;
}

// Snapshot fields → state (called on any input)
function onAnyInput() {
  Object.keys(state.fields).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') state.fields[id] = el.checked;
    else state.fields[id] = el.value;
  });
  // Live validation when on Step 2
  if (state.step === 1 && document.getElementById('missing-summary')) updateMissingSummary();
  saveState();
}

// ── Stepper ────────────────────────────────────────────────────────
// The mountain-band 太陽 arcs from left horizon → noon → right horizon
// as the user advances through the 5 steps. Pure visual flourish.
function updateSunPosition() {
  const sun = document.getElementById('mountain-sun');
  if (!sun) return;
  const step = state.step || 0;
  const total = (typeof STEPS !== 'undefined' && STEPS.length) ? STEPS.length - 1 : 4;
  const progress = Math.max(0, Math.min(1, step / total));    // 0..1
  // Horizontal: 20 → 180 in viewBox(0 0 200 60)
  const cx = 20 + progress * 160;
  // Vertical arc: sin curve, peaks at progress=0.5 (smaller y = higher in SVG)
  const cy = 24 - 12 * Math.sin(progress * Math.PI);
  // Opacity peaks at noon for a「正午」感
  const op = 0.32 + 0.32 * Math.sin(progress * Math.PI);
  // Stroke colour: 黎明的灰墨 → 正午溫暖 → 夕陽朱紅
  let stroke = '#5a5247';
  if (progress <= 0.4)        stroke = '#5a5247';                // dawn ink
  else if (progress < 0.6)    stroke = '#a8362f';                // noon terracotta
  else                         stroke = '#a8362f';                // sunset, same warm tone
  sun.setAttribute('cx', cx.toFixed(1));
  sun.setAttribute('cy', cy.toFixed(1));
  sun.setAttribute('opacity', op.toFixed(2));
  sun.setAttribute('stroke', stroke);
}

function renderStepper() {
  const el = document.getElementById('stepper');
  el.innerHTML = STEPS_META.map((s, i) => {
    const cls = i === state.step ? 'active' : (i < state.step ? 'done' : '');
    const numStr = String(i + 1).padStart(2, '0');
    const item = `<div class="step-item ${cls}" onclick="goTo(${i})">
      <div class="step-circle"><span class="step-circle-num">${numStr}</span></div>
      <div class="step-label">${s.name}</div>
    </div>`;
    const spacer = i < STEPS_META.length - 1 ? '<div class="step-spacer"></div>' : '';
    return item + spacer;
  }).join('');
}

function goTo(step) {
  // Blur active element so native pickers close before panel switch
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  // Force-close any open native color picker. Chrome's picker is a system dialog
  // that survives blur AND DOM replacement — the only reliable kill is to flip
  // the input type away from "color" briefly, which makes the OS dismiss the dialog.
  document.querySelectorAll('input[type="color"]').forEach(el => {
    const v = el.value;
    el.type = 'text';
    // Force layout flush so the type change takes effect before we restore
    void el.offsetHeight;
    el.type = 'color';
    el.value = v;
  });
  // Clamp step in case localStorage has a stale higher index (e.g. saved as
  // 4 before the Firebase step was moved into the advanced section).
  if (step > STEPS.length - 1) step = STEPS.length - 1;
  if (step < 0) step = 0;
  state.step = step;
  document.querySelectorAll('.panel').forEach((p, i) => p.classList.toggle('active', i === step));
  renderStepper();
  updateSunPosition();
  const pgNum = String(step + 1).padStart(2, '0');
  const pgTot = String(STEPS.length).padStart(2, '0');
  document.getElementById('nav-hint').innerHTML =
    `<span class="nav-page-num">P. ${pgNum}</span> &nbsp;／&nbsp; ${pgTot} &nbsp;·&nbsp; ${STEPS_META[step].name}`;
  document.getElementById('btn-prev').style.display = step > 0 ? '' : 'none';
  document.getElementById('btn-next').style.display = step === STEPS.length - 1 ? 'none' : '';
  if (step === 1) renderStep2();
  if (step === 2) renderThemeStep();
  if (step === 3) {
    renderSummary(); renderFbRules();
    // 記住這次工作階段裡使用者上次選的分享方式；第一次進來預設「一行分享連結」
    selectDeliveryMode(_previewMode === 'advanced' ? 'advanced' : 'basic');
    ensureFreshShareUrl();
  }
  // Scroll AFTER render so the newly-laid-out panel starts at the top.
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  saveState();
}

function nextStep() {
  if (state.step === 0 && state.path === 'manual' && !state.days.length) initEmpty();
  // When leaving Step 2, warn if missing required fields (don't block)
  if (state.step === 1) {
    const n = updateMissingSummary();
    if (n > 0 && !confirm(`還有 ${n} 處欄位未填，確定繼續？\n\n（之後仍可回來補。）`)) return;
  }
  if (state.step < STEPS.length - 1) goTo(state.step + 1);
}
function prevStep() { if (state.step > 0) goTo(state.step - 1); }

// ── Path tabs ─────────────────────────────────────────────────────
function setPath(p, silent) {
  state.path = p;
  document.querySelectorAll('.path-tab').forEach(t => t.classList.toggle('active', t.dataset.path === p));
  document.querySelectorAll('.path-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'path-' + p);
  });
  if (!silent) saveState();
}

function switchChecklistSubtab(tab) {
  document.querySelectorAll('.checklist-subtab').forEach(b => b.classList.toggle('active', b.id === 'tab-btn-' + tab));
  document.querySelectorAll('.checklist-panel').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
}

// ── AI flow ────────────────────────────────────────────────────────
function buildPrompt() {
  const text = document.getElementById('trip-text').value.trim();
  let head = PARSE_PROMPT;
  const groups = activeGroups();
  if (groups.length) {
    // 分組段落插在 Schema 之前；沒分組時提示詞不動（規則 7）
    const section = buildGroupSection(groups.map(g => ({ name: g.name, members: g.memberIds.map(memberName) })));
    head = head.replace(GROUP_PROMPT_ANCHOR, () => section + GROUP_PROMPT_ANCHOR);
  }
  return head + (text || '（請使用者把行程貼到這裡）');
}

function updateTripText() {
  state.tripText = document.getElementById('trip-text').value;
  const has = state.tripText.trim().length > 10;
  document.getElementById('copy-prompt-btn').disabled = !has;
  document.getElementById('ai-step-1').classList.toggle('done', has);
  document.getElementById('ai-step-2').classList.toggle('active', has);
  // refresh prompt preview if open
  const pa = document.getElementById('prompt-area');
  if (pa) pa.textContent = buildPrompt();
  saveState();
}

function togglePromptPreview() {
  const wrap = document.getElementById('prompt-preview');
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
  if (!open) document.getElementById('prompt-area').textContent = buildPrompt();
}

function copyPromptToClipboard() {
  const prompt = buildPrompt();
  navigator.clipboard.writeText(prompt).then(() => {
    const btn = document.getElementById('copy-prompt-btn');
    const old = btn.innerHTML;
    btn.innerHTML = '✓ 已複製！現在開啟 AI 並貼上';
    btn.style.background = 'var(--ok)';
    btn.style.borderColor = 'var(--ok)';
    document.getElementById('ai-step-2').classList.add('done');
    document.getElementById('ai-step-3').classList.add('active');
    setTimeout(() => {
      btn.innerHTML = old;
      btn.style.background = '';
      btn.style.borderColor = '';
    }, 2400);
  }).catch(() => {
    alert('複製失敗，請手動選取「預覽 Prompt」內的文字複製');
  });
}

function updateJsonPaste() {
  state.jsonPaste = document.getElementById('json-paste').value;
  saveState();
}

function importAiJson() {
  const raw = document.getElementById('json-paste').value.trim();
  const stat = document.getElementById('ai-import-status');
  if (!raw) {
    stat.innerHTML = '<div class="status-box status-err">請先貼上 AI 回的 JSON</div>';
    return;
  }
  try {
    let cleaned = raw;
    // Strip ```json / ``` fences
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fence) cleaned = fence[1];
    // Find first { ... last }
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
    const data = JSON.parse(cleaned);
    if (state.splitUp && !(data.days && data.days.length)) {
      stat.innerHTML = '<div class="status-box status-err">這份 JSON 裡沒有 days（行程），沒有更新任何東西。請確認 AI 回的是完整的行程 JSON。</div>';
      return;
    }
    applyParsedData(data);
    document.getElementById('ai-step-3').classList.add('done');
    stat.innerHTML = `<div class="status-box status-ok">✓ 匯入成功！${state.days.length} 天行程、${state.members.length} 位成員、${state.hotels.length} 間住宿。點下方「下一步」確認。</div>`;
  } catch (e) {
    stat.innerHTML = `<div class="status-box status-err">JSON 格式錯誤：${e.message}<br><br>常見原因：AI 回了多餘的解釋文字。請只複製 <code>{</code> 到 <code>}</code> 之間的內容。</div>`;
  }
}

function applyParsedData(d) {
  if (d.tripName) state.fields['f-title'] = d.tripName;
  if (d.subtitle) state.fields['f-subtitle'] = d.subtitle;
  if (d.datePill) state.fields['f-date-pill'] = d.datePill;
  if (d.durationPill) state.fields['f-duration-pill'] = d.durationPill;
  if (d.members?.length) state.fields['f-people-pill'] = String(d.members.length);
  const year = d.year || new Date().getFullYear();
  const baseKey = (d.tripName || 'trip').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  state.fields['f-storage-prefix'] = baseKey + year;
  const groups = activeGroups();
  if (d.members?.length) {
    // 有分組時成員已在 D1 建好（組別指向成員 id），用名字對上並保留 id；沒分組維持原行為
    state.members = groups.length ? mergeMembers(state.members, d.members) : [...d.members];
  }
  ensureMemberIds();
  d = normalizeImported(d, groups, state.members);   // with／unsure → 內部格式；沒分組時丟掉
  if (d.days?.length) { state.days = d.days.map(fromLegacyDay); state.days.forEach(_orderTimeline); }
  if (d.hotels?.length) state.hotels = [...d.hotels];
  state.dismissedAlerts = [];
  state.parsedExtras = {
    restaurants: d.restaurants || {},
    weatherLocs: d.weatherLocs || {},
    checklist: d.checklist || [],
    presetShopping: d.presetShopping || [],
    notes: normalizeNotes(d.notes),
  };
  // Re-hydrate inputs
  Object.keys(state.fields).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!state.fields[id];
    else el.value = state.fields[id] || '';
  });
  onSelfDriveToggle(true);
  renderSplitSetup();
  saveState();
}

// AI 可能把 notes 回成字串陣列；行程 App 與編輯器都讀 { icon, text }
function normalizeNotes(notes) {
  return (notes || []).map(n => typeof n === 'string' ? { icon: '⚠️', text: n } : n);
}

// ── 分組旅行（純函式在 group-trip.js；這裡是碰 state 的部分）──────────
let _memberSeq = 0;   // 與 genId 的流水號分開，成員 id 不影響其他 id
function newMemberId() { return 'm' + Date.now().toString(36) + (_memberSeq++).toString(36); }
function ensureMemberIds() {
  state.members.forEach(m => { if (!m.id) m.id = newMemberId(); });
}
function memberName(id) { return (state.members.find(m => m.id === id) || {}).name || ''; }
// 讀入舊資料／匯入後呼叫：成員補 id、組別清掉已不存在的成員
function ensureGroupState() {
  if (!Array.isArray(state.groups)) state.groups = [];
  if (!Array.isArray(state.dismissedAlerts)) state.dismissedAlerts = [];
  ensureMemberIds();
  const ids = new Set(state.members.map(m => m.id));
  state.groups.forEach(g => { g.memberIds = (g.memberIds || []).filter(id => ids.has(id)); });
}
// 生效中的組別：有開「有分頭」、有組名、至少一位成員
function activeGroups() {
  if (!state.splitUp) return [];
  return (state.groups || []).filter(g => (g.name || '').trim() && g.memberIds.length);
}

// ── Timeline item model + legacy adapter ───────────────────────────
// 內部統一模型：一天 = { id, day, date, wd, theme, emoji, items: [TimelineItem] }
// TimelineItem = { id, type:'activity'|'flight'|'lodging', time, icon, title, sub,
//                  ref, location:{query,url,verified}, data:{…型別專屬} }
// 匯出時由 toLegacyDay 拆回 template 既有的 acts/flight/hotel 格式，template 無感。
let _idSeq = 0;
function genId() { return 'it' + Date.now().toString(36) + (_idSeq++).toString(36); }
function isMapUrl(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

function makeLocation(mapStr) {
  const s = String(mapStr || '');
  const url = isMapUrl(s);
  return { query: url ? '' : s, url: url ? s : '', verified: url };
}
// location → 舊的單一 map 字串（連結優先，否則名稱）：編輯器欄位顯示用，保留使用者貼的原樣
function locationToMap(loc) {
  loc = loc || {};
  return (loc.url || loc.query || '');
}
// 匯出用：分享短網址已展開的話輸出完整網址（行程 App 直接讀得到位置與名稱，不必再呼叫伺服器）
function locationForExport(loc) {
  loc = loc || {};
  return (loc.resolved || loc.url || loc.query || '');
}

// ── Google 地圖分享短網址（maps.app.goo.gl）→ 完整網址 ──────────────
// 短網址本身不含位置；瀏覽器讀不到跨網站轉址的目標，交給本站的伺服器小程式代讀
//（netlify/functions/expand-map-link.mjs）。與 template-src.html 的同名邏輯對應。
const MAP_LINK_API = (/(^|\.)claire-cheng\.com$|(^|--)trip-v2\.netlify\.app$/.test(location.hostname)
  ? '' : 'https://trips.claire-cheng.com') + '/.netlify/functions/expand-map-link';
const SHORT_MAP_RE = /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+\/?(?:\?[A-Za-z0-9_=&%.-]*)?$/;
function isShortMapLink(s) { return SHORT_MAP_RE.test(String(s || '').trim()); }
const _linkInflight = {};     // 短網址 → 進行中的 Promise
const _linkFailed = new Set(); // 本次開啟讀取失敗的短網址（重新貼上才再試）
function expandMapLink(short) {
  short = String(short || '').trim();
  if (_linkInflight[short]) return _linkInflight[short];
  const p = fetch(`${MAP_LINK_API}?u=${encodeURIComponent(short)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.url) { _linkFailed.add(short); return null; }
      // /maps/place/ 形式去掉追蹤用查詢參數，位置與名稱都在路徑裡
      return /\/maps\/place\//.test(d.url) ? d.url.split('?')[0] : d.url;
    })
    .catch(() => { _linkFailed.add(short); return null; })
    .finally(() => { delete _linkInflight[short]; });
  _linkInflight[short] = p;
  return p;
}
// Google 地圖完整網址裡的位置（與 template-src.html 的 _extractLatLon 同規則）
function mapUrlLatLon(u) {
  if (!u || !/^https?:\/\//i.test(u)) return null;
  const ok = (la, lo) => (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) ? { lat: la, lon: lo } : null;
  const d3 = u.match(/!3d(-?\d+(?:\.\d+)?)/), d4 = u.match(/!4d(-?\d+(?:\.\d+)?)/);
  if (d3 && d4) { const r = ok(parseFloat(d3[1]), parseFloat(d4[1])); if (r) return r; }
  const at = u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) { const r = ok(parseFloat(at[1]), parseFloat(at[2])); if (r) return r; }
  try {
    const url = new URL(u);
    for (const k of ['q', 'query', 'll', 'center']) {
      const c = (url.searchParams.get(k) || '').match(/^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (c) { const r = ok(parseFloat(c[1]), parseFloat(c[2])); if (r) return r; }
    }
  } catch (e) {}
  return null;
}
function mapPlaceName(u) {
  const m = /\/maps\/place\/([^/?#]+)/.exec(u || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { return ''; }
}
// 連結型地點的狀態：ok 已定位／pending 讀取中／failed 讀不到／noplace 沒有指向單一地點
function locLinkInfo(loc) {
  const url = String((loc && loc.url) || '').trim();
  if (isShortMapLink(url) && !loc.resolved) return { status: _linkFailed.has(url) ? 'failed' : 'pending' };
  const full = (loc && loc.resolved) || url;
  // 搜尋結果／路線連結的 @lat,lon 只是地圖畫面中心，不算指向單一地點（與 template 的 _placeLatLon 同規則）
  const probe = /\/maps\/(search|dir)\//.test(full) ? full.replace(/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?[^/?]*/, '') : full;
  if (!mapUrlLatLon(probe)) return { status: 'noplace' };
  return { status: 'ok', name: mapPlaceName(full) };
}
// 短網址還沒展開 → 送去展開，完成後存回 state 並更新該列狀態（同一條同時只送一次）
function ensureLocResolved(di, idx) {
  const it = state.days[di]?.items?.[idx];
  const url = String(it?.location?.url || '').trim();
  if (!it || !isShortMapLink(url) || it.location.resolved || _linkFailed.has(url)) return;
  expandMapLink(url).then(full => {
    const cur = state.days[di]?.items?.[idx];
    if (!cur || String(cur.location?.url || '').trim() !== url) return;   // 使用者已改成別的內容
    if (full) { cur.location.resolved = full; saveState(); }
    updateMapStatus(di, idx);
  });
}

function newItem(type) {
  const it = {
    id: genId(), type, time: '', icon: '📍', title: '', sub: '', ref: '',
    location: { query: '', url: '', verified: false }, data: {}
  };
  if (type === 'flight') {
    it.icon = '✈️'; it.title = '去程航班';
    it.data = { num: '', from: '', fromCity: '', fromTerminal: '', to: '', toCity: '', toTerminal: '', dept: '', arr: '', boarding: '' };
  } else if (type === 'lodging') {
    it.icon = '🏨'; it.data = { note: '', paid: false };
  }
  return it;
}

// 已是新格式的 item → 補齊缺漏欄位（forward 相容）
function normalizeItem(it) {
  it = it || {};
  const loc = it.location || {};
  const type = it.type || 'activity';
  return {
    id: it.id || genId(),
    type,
    time: it.time || '',
    icon: it.icon || (type === 'flight' ? '✈️' : type === 'lodging' ? '🏨' : '📍'),
    title: it.title || '',
    sub: it.sub || '',
    ref: it.ref || '',
    // park: 自駕日是否要查此景點停車場。undefined = 預設要；false = 徒步、不查
    park: it.park === false ? false : undefined,
    location: { query: loc.query || '', url: loc.url || '', verified: !!loc.verified, ...(loc.resolved ? { resolved: loc.resolved } : {}) },
    data: it.data || {},
    ...groupFields(it)
  };
}

// 分組欄位（同行名單 with、AI 對不到的字串 withUnknown、沒把握 unsure）：有才帶，沒分組的資料形狀不變
function groupFields(src) {
  const o = {};
  if (src && Array.isArray(src.with) && src.with.length) o.with = [...src.with];
  if (src && Array.isArray(src.withUnknown) && src.withUnknown.length) o.withUnknown = [...src.withUnknown];
  if (src && src.unsure === true) o.unsure = true;
  return o;
}

function newDay(n) {
  return { id: genId(), day: n || 1, date: '', wd: '', theme: '', emoji: '📍', selfDrive: false, items: [] };
}

// 交通類活動 icon（搭機/搭車/搭船）— 與 template 的 isTransit 對齊，自駕日也不查停車場
function isTransitIcon(icon) { return /[✈🚄🚅🚃🚆🚇🚈🚝🛫🛬🚢⛴🚤]/u.test(icon || ''); }

// 唯一的匯入收斂點：吃舊格式（acts/flight/hotel）或新格式（items），都轉成統一模型
function fromLegacyDay(d) {
  d = d || {};
  const base = {
    id: d.id || genId(),
    day: d.day || 1, date: d.date || '', wd: d.wd || '',
    theme: d.theme || '', emoji: d.emoji || '📍',
    selfDrive: !!d.selfDrive,      // 這天是否自駕 → 決定本日景點要不要顯示停車場
    parking: d.parking || null,   // 精選停車場清單原樣透傳（template 已支援渲染）
    ...groupFields(d),
    items: []
  };
  if (Array.isArray(d.items)) {            // 已是新格式 → pass-through
    base.items = d.items.map(normalizeItem);
    return base;
  }
  // 舊格式：活動 → 機票 → 住宿（保留原順序，P1 不重排）
  (d.acts || []).forEach(a => {
    base.items.push({
      id: a.id || genId(), type: 'activity', time: a.time || '',
      icon: a.icon || '📍', title: a.name || '', sub: a.sub || '', ref: a.ref || '',
      park: a.park === false ? false : undefined,
      location: makeLocation(a.map), data: {},
      ...groupFields(a)
    });
  });
  if (d.flight) {
    const f = d.flight;
    base.items.push({
      id: genId(), type: 'flight', time: f.dept || '',
      icon: '✈️', title: f.label || '去程航班', sub: '', ref: '',
      location: { query: '', url: '', verified: false },
      data: {
        num: f.num || '', from: f.from || '', fromCity: f.fromCity || '', fromTerminal: f.fromTerminal || '',
        to: f.to || '', toCity: f.toCity || '', toTerminal: f.toTerminal || '',
        dept: f.dept || '', arr: f.arr || '', boarding: f.boarding || ''
      },
      ...groupFields(f)
    });
  }
  if (d.hotel) {
    const h = d.hotel;
    base.items.push({
      id: genId(), type: 'lodging', time: '',
      icon: '🏨', title: h.name || '', sub: '', ref: '',
      park: h.park === false ? false : undefined,
      location: makeLocation(h.map),
      data: { note: h.note || '', paid: !!h.paid },
      ...groupFields(h)
    });
  }
  // 租車：legacy 的 car 物件（含訂位號碼 bookings）折進「對應租車活動」的 ref，
  // 符合「租車就是一個活動、訂位號碼寫在 ref」的心智模型；找不到對應活動則新建一個。
  if (d.car) {
    const c = d.car;
    const bookings = Array.isArray(c.bookings) ? c.bookings.filter(Boolean).join(' / ') : '';
    const carItem = base.items.find(it => it.type === 'activity' &&
      (/[🚗🚙]/u.test(it.icon || '') || /租車|取車|還車|租\s*車/.test(it.title || '')));
    if (carItem) {
      if (!carItem.ref && bookings) carItem.ref = bookings;
      if (!carItem.sub && c.note) carItem.sub = c.note;
    } else if (bookings || c.note || c.label) {
      const at = base.items.findIndex(it => it.type !== 'activity');
      base.items.splice(at === -1 ? base.items.length : at, 0, {
        id: genId(), type: 'activity', time: '',
        icon: '🚗', title: (c.label ? String(c.label).replace(/^[🚗🚙]\s*/u, '') : '') || '租車',
        sub: c.note || '', ref: bookings,
        location: { query: '', url: '', verified: false }, data: {}
      });
    }
  }
  return base;
}

// 匯出收斂點：統一模型 → template 既有格式（location.verified 等編輯器專屬欄位丟棄）
function toLegacyDay(d) {
  d = d || {};
  const items = d.items || [];
  // 航班也進時間軸：icon ✈️，sub 組合航班資訊，time = 起飛時間
  const acts = items.filter(it => it.type === 'activity' || it.type === 'flight').map(it => {
    if (it.type === 'flight') {
      const fd = it.data || {};
      const parts = [];
      if (fd.num) parts.push(fd.num);
      const fromStr = [fd.from, fd.fromCity, fd.fromTerminal ? `T${fd.fromTerminal}` : ''].filter(Boolean).join(' ');
      const toStr   = [fd.to,   fd.toCity,   fd.toTerminal   ? `T${fd.toTerminal}`   : ''].filter(Boolean).join(' ');
      if (fromStr) parts.push(fromStr);
      if (fd.dept) parts.push(fd.dept);
      if (toStr)   parts.push('→ ' + toStr);
      if (fd.arr)  parts.push(fd.arr);
      return {
        id: it.id, icon: '✈️', name: it.title || '班機',
        sub: parts.join(' · '),
        time: fd.dept || it.time || '',
        map: '', ref: it.ref || ''
      };
    }
    return {
      id: it.id, icon: it.icon || '📍', name: it.title || '', sub: it.sub || '',
      time: it.time || '', map: locationForExport(it.location), ref: it.ref || '',
      park: it.park === false ? false : undefined   // 徒步景點不查停車場
    };
  });
  const lItem = items.find(it => it.type === 'lodging');
  const out = {
    day: d.day || 1, date: d.date || '', wd: d.wd || '',
    theme: d.theme || '', emoji: d.emoji || '📍',
    selfDrive: !!d.selfDrive,   // 這天自駕 → template 才在本日景點顯示停車場
    acts,
    flight: null,   // 航班已移入 acts，不再獨立輸出
    hotel: lItem ? {
      name: lItem.title || '', note: lItem.data.note || '',
      paid: !!lItem.data.paid, map: locationForExport(lItem.location),
      park: lItem.park === false ? false : undefined
    } : null,
    parking: d.parking || null,   // 透傳精選停車場清單（legacy 帶進來的）
    car: null                     // 租車已折進活動 ref，不再用獨立 car 物件
  };
  return out;
}

// 載入舊存檔時把 state.days 逐天遷移成新模型（已是新格式則 pass-through）
function migrateDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map(fromLegacyDay);
}

// 編輯期常用的型別存取
function dayActivities(d) { return (d.items || []).filter(it => it.type === 'activity'); }
function dayFlight(d) { return (d.items || []).find(it => it.type === 'flight') || null; }
function dayLodging(d) { return (d.items || []).find(it => it.type === 'lodging') || null; }

// ── Manual / load paths ────────────────────────────────────────────
function startManual() {
  if (!state.days.length) initEmpty();
  goTo(1);
}
function initEmpty() {
  state.days = [newDay(1)]; // initEmpty
}

// ── Unified restore zone: accepts share URL paste OR .html file drop ──
function updateRestoreBtn() {
  const txt = (document.getElementById('restore-input').value || '').trim();
  document.getElementById('restore-btn').disabled = !txt;
}

function onRestoreDragOver(e) {
  e.preventDefault();
  document.getElementById('restore-zone').classList.add('dragover');
}
function onRestoreDragLeave(e) {
  // Only un-highlight when leaving the zone itself (not bubbled child events)
  if (e.target.id === 'restore-zone') {
    document.getElementById('restore-zone').classList.remove('dragover');
  }
}
function onRestoreDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('restore-zone');
  zone.classList.remove('dragover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) { loadHtmlFile(file); return; }
  const text = e.dataTransfer.getData('text');
  if (text) {
    document.getElementById('restore-input').value = text;
    updateRestoreBtn();
    loadFromRestoreInput();
  }
}

function handleFileLoad(e) {
  const file = e.target.files[0];
  if (file) loadHtmlFile(file);
}
async function loadHtmlFile(file) {
  const stat = document.getElementById('restore-status');
  stat.innerHTML = '<div class="status-box status-info">解析 .html 檔中…</div>';
  try {
    const text = await file.text();
    await importHtmlText(text, stat);   // 同時支援 generator 產出（_CFG）與手刻舊格式（const DAYS）
  } catch (e) {
    stat.innerHTML = `<div class="status-box status-err">解析失敗：${e.message}</div>`;
  }
}

function base64urlToBytes(s) {
  // Restore standard base64 padding
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function extractShareHash(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const hashIdx = s.indexOf('#');
  const frag = hashIdx >= 0 ? s.slice(hashIdx + 1) : s;
  const params = new URLSearchParams(frag);
  return params.get('z');
}

// Inverse of buildShareUrl(): extract z= hash → base64url decode →
// gunzip → JSON.parse → reuse importLoadedConfig().
async function loadFromRestoreInput() {
  const stat = document.getElementById('restore-status');
  const raw = (document.getElementById('restore-input').value || '').trim();
  if (!raw) {
    stat.innerHTML = '<div class="status-box status-err">請先貼上分享連結，或拖入 .html 檔。</div>';
    return;
  }
  // Heuristic 1: looks like a share URL / hash fragment
  if (/(^|[#?&])z=[A-Za-z0-9_-]+/.test(raw) || raw.includes('/v/')) {
    stat.innerHTML = '<div class="status-box status-info">解析分享連結中…</div>';
    try {
      const z = extractShareHash(raw);
      if (!z) throw new Error('連結看起來不像分享連結 — 應包含 #z=... 片段。');
      const bytes = base64urlToBytes(z);
      const json = new TextDecoder().decode(await gunzipBytes(bytes));
      const cfg = JSON.parse(json);
      importLoadedConfig(cfg);
      stat.innerHTML = `<div class="status-box status-ok">✓ 還原成功！${state.days.length} 天、${state.members.length} 位成員。可從「步驟 2」開始修改。</div>`;
      setTimeout(() => goTo(1), 800);
    } catch (e) {
      stat.innerHTML = `<div class="status-box status-err">還原失敗：${e.message}</div>`;
    }
    return;
  }
  // Heuristic 2: 整段 HTML 原始碼（generator 產出的 _CFG 或手刻舊 const DAYS）
  if (/<!doctype|<html[\s>]|_CFG\s*=|const\s+DAYS\s*=/i.test(raw)) {
    await importHtmlText(raw, stat);
    return;
  }
  // Heuristic 3: 貼的是一個已部署的網址 → 試著跨網域抓取，失敗則給可行指引
  if (/^https?:\/\/\S+$/i.test(raw)) {
    stat.innerHTML = '<div class="status-box status-info">嘗試抓取網址內容中…</div>';
    let text = null;
    try {
      const res = await fetch(raw, { mode: 'cors' });
      if (res.ok) text = await res.text();
    } catch (e) { text = null; }
    if (text) {
      await importHtmlText(text, stat);
    } else {
      stat.innerHTML = '<div class="status-box status-err">無法直接抓取這個網址（瀏覽器跨網域安全限制）。請改用其中一種：<br>① 打開該網頁 → 右鍵「檢視網頁原始碼」→ 全選複製 → 貼到這裡<br>② 下載該頁的 <code style="font-family:ui-monospace,monospace;">index.html</code> 後拖入上方</div>';
    }
    return;
  }
  stat.innerHTML = '<div class="status-box status-err">無法辨識輸入。請貼上 <code style="font-family:ui-monospace,monospace;">/v/#z=...</code> 分享連結、已部署網址、或整段 HTML 原始碼；如果手上是 <code>.html</code> 檔，請改用上方的「選擇 index.html 檔」或拖到輸入區內。</div>';
}
function bumpSwCacheKey(oldKey, prefix) {
  if (!oldKey) return (prefix || 'trip') + '-v2';
  const m = oldKey.match(/^(.+)-v(\d+)$/);
  if (m) return m[1] + '-v' + (parseInt(m[2]) + 1);
  return oldKey + '-v2';
}

function extractInlinedConfig(text) {
  const markers = [
    /const\s+_CFG\s*=\s*/,
    /window\.__TRIP_CONFIG__\s*=\s*/,
    /const\s+TRIP_CONFIG\s*=\s*/,
  ];
  for (const re of markers) {
    const m = re.exec(text);
    if (!m) continue;
    const start = m.index + m[0].length;
    if (text[start] !== '{') continue;
    let depth = 0, inStr = false, strCh = '', escNext = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escNext) { escNext = false; continue; }
      if (inStr) {
        if (c === '\\') { escNext = true; continue; }
        if (c === strCh) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = text.slice(start, i + 1);
          try { return JSON.parse(jsonStr); }
          catch (e) { throw new Error('找到設定區塊但 JSON 解析失敗：' + e.message); }
        }
      }
    }
  }
  return null;
}

// ── 手刻舊 app 匯入（const DAYS = [...] 那種，沒有 _CFG）─────────────
// 把 JS 物件字面值（裸 key、trailing comma、單引號）正規化成 JSON，不用 eval。
function jsLiteralToJson(src) {
  let out = '', inStr = false, ch = '', esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (esc) {                       // 前一字是反斜線
      if (c === "'") out = out.slice(0, -1) + "'";  // JSON 不接受 \' → 還原成 '
      else out += c;
      esc = false; continue;
    }
    if (inStr) {
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === ch)   { inStr = false; out += '"'; continue; }   // 收尾一律用 "
      if (c === '"')  { out += '\\"'; continue; }                // 字串內的 " 轉義
      out += c; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; ch = c; out += '"'; continue; }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');                              // 去 trailing comma
  out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');  // 補 key 引號
  return out;
}

// 抓 `const VAR = [...]` 或 `{...}` 的平衡括號區段並解析（失敗回 null）
function parseJsVar(text, varName) {
  const re = new RegExp('(?:const|let|var)\\s+' + varName + '\\s*=\\s*');
  const m = re.exec(text); if (!m) return null;
  let i = m.index + m[0].length;
  const open = text[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return null;
  let depth = 0, inStr = false, ch = '', esc = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === '\\') { esc = true; continue; } if (c === ch) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; ch = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(jsLiteralToJson(text.slice(i, j + 1))); }
        catch (e) { return null; }
      }
    }
  }
  return null;
}

function _legacyColor(html, names, fallback) {
  for (const n of names) {
    const m = html.match(new RegExp('--' + n + '\\s*:\\s*(#[0-9a-fA-F]{3,8})'));
    if (m) return m[1];
  }
  return fallback;
}

// 盡力把手刻舊 app 的 HTML 轉成 generator config（DAYS 為核心，其餘 best-effort）
function extractLegacyConfig(html) {
  const days = parseJsVar(html, 'DAYS');
  if (!days || !days.length) return null;       // 沒有 DAYS 就不是這種格式
  const pick = re => { const m = html.match(re); return m ? m[0].trim() : ''; };
  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  return {
    meta: {
      title: titleM ? titleM[1].trim() : '',
      subtitle: '',
      datePill: pick(/\d{4}\s*年\s*\d{1,2}\s*月[\d‐-―\-~－－]{0,6}\s*\d{0,2}\s*日/),
      durationPill: pick(/\d+\s*天\s*\d+\s*夜/),
      peoplePill: pick(/\d+\s*人同行/) || pick(/\d+\s*人/),
      pin: (html.match(/(?:TRIP_)?PIN\w*\s*=\s*["'](\d{3,6})["']/) || [])[1] || '',
      themeColor: _legacyColor(html, ['accent', 'pink', 'main'], '#a8362f'),
      themeAccent: _legacyColor(html, ['pink-2', 'accent-2'], '#c45a4f'),
      themeLight: _legacyColor(html, ['pink-3', 'accent-3'], '#e3a89c'),
      bgColor: _legacyColor(html, ['pink-bg', 'bg'], '#faf2ec'),
      bgPale: _legacyColor(html, ['pink-pale', 'bg-pale'], '#f3e3d8'),
    },
    firebase: {},
    members: parseJsVar(html, 'MEMBERS') || [],
    days,
    hotels: [],
    restaurants: parseJsVar(html, 'RESTAURANTS') || {},
    checklist: parseJsVar(html, 'CHECKLIST') || [],
    presetShopping: parseJsVar(html, 'PRESET_SHOPPING') || [],
    notes: parseJsVar(html, 'NOTES') || [],
  };
}

// 從一段 HTML 文字（貼上或 fetch 來的）解析 config：先試 _CFG，再試 legacy
async function importHtmlText(text, stat) {
  stat.innerHTML = '<div class="status-box status-info">解析內容中…</div>';
  try {
    let cfg = null, legacy = false;
    try { cfg = extractInlinedConfig(text); } catch (e) { cfg = null; }
    if (!cfg) { cfg = extractLegacyConfig(text); legacy = !!cfg; }
    if (!cfg) throw new Error('找不到行程資料（既不是 generator 產出的 _CFG，也不是 const DAYS 舊格式）。');
    importLoadedConfig(cfg);
    let extra = '';
    if (legacy) {
      extra = ' <span style="color:var(--ink-2);font-size:var(--fs-fine);">（舊格式已自動轉入；租車訂位號碼、停車場、主題色、日期、PIN、目的地地區等請在下方再確認）</span>';
    } else if (state._loadedSwCacheKey) {
      extra = `<br><span style="color:var(--ink-2);font-size:var(--fs-fine);">SW cache key 已自動升版為 <code style="font-family:ui-monospace,monospace;background:var(--bg);padding:1px 5px;border-radius:3px;">${state._loadedSwCacheKey}</code>，重新部署後旅伴 PWA 會自動更新。</span>`;
    }
    stat.innerHTML = `<div class="status-box status-ok">✓ 載入成功！${state.days.length} 天、${state.members.length} 位成員。可從「步驟 2」開始修改。${extra}</div>`;
    setTimeout(() => goTo(1), 900);
  } catch (e) {
    stat.innerHTML = `<div class="status-box status-err">解析失敗：${e.message}</div>`;
  }
}

function importLoadedConfig(cfg) {
  const m = cfg.meta || {};
  const oldSwKey = m.swCacheKey || ((m.storagePrefix || 'trip') + '-v1');
  state._loadedSwCacheKey = bumpSwCacheKey(oldSwKey, m.storagePrefix);
  state.fields['f-title'] = m.title || '';
  state.fields['f-subtitle'] = m.subtitle || '';
  state.fields['f-date-pill'] = m.datePill || '';
  state.fields['f-duration-pill'] = m.durationPill || '';
  state.fields['f-people-pill'] = extractPeopleNumber(m.peoplePill);
  state.fields['f-end-date'] = m.endDate || '';
  state.fields['f-end-time'] = m.endTime || '';
  // 自駕：config 有明確值就用；舊檔沒有則預設關閉，交由使用者開
  state.fields['f-self-drive'] = !!m.selfDrive;
  // 目的地地區：config 有就用；否則從行程文字 best-effort 猜（駐車場/假名→日本…），再 fallback 日本
  state.fields['f-region'] = m.region ||
    guessRegion(JSON.stringify(cfg.days || [])) || '日本';
  state.fields['f-pin'] = m.pin || '';
  state.fields['f-storage-prefix'] = m.storagePrefix || '';
  state.fields['f-theme-color'] = m.themeColor || '#a8362f';
  state.fields['f-theme-accent'] = m.themeAccent || '#c45a4f';
  state.fields['f-theme-light'] = m.themeLight || '#e3a89c';
  state.fields['f-bg-color'] = m.bgColor || '#faf2ec';
  state.fields['f-bg-pale'] = m.bgPale || '#f3e3d8';
  const matchIdx = THEMES.findIndex(t =>
    t.color.toLowerCase() === (m.themeColor || '').toLowerCase() &&
    t.accent.toLowerCase() === (m.themeAccent || '').toLowerCase()
  );
  state.activeTheme = matchIdx >= 0 ? matchIdx : -1;
  state.fields['f-firebase'] = cfg.firebase ? JSON.stringify(cfg.firebase, null, 2) : '';
  state.useFirebase = !!(cfg.firebase && cfg.firebase.databaseURL);
  // 現有行程 App 還不認得分組，載入的設定檔沒有 with。使用者先在步驟 1 填過的組別，
  // 用名字對到載入的成員（對不上的成員從組別拿掉）
  const prevGroups = (state.groups || []).map(g => ({ ...g, names: g.memberIds.map(memberName) }));
  state.members = cfg.members || [];
  ensureMemberIds();
  state.groups = prevGroups.map(({ names, ...g }) => ({
    ...g, memberIds: names.map(n => (state.members.find(m => m.name === n) || {}).id).filter(Boolean),
  }));
  state.dismissedAlerts = [];
  state.days = (cfg.days || []).map(fromLegacyDay);
  state.days.forEach(_orderTimeline);
  state.hotels = cfg.hotels || [];
  state.parsedExtras = {
    restaurants: cfg.restaurants || {},
    weatherLocs: cfg.weatherLocs || {},
    checklist: cfg.checklist || [],
    presetShopping: cfg.presetShopping || [],
    notes: cfg.notes || [],
  };
  Object.keys(state.fields).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!state.fields[id];
    else el.value = state.fields[id] || '';
  });
  onSelfDriveToggle(true);
  renderSplitSetup();
  saveState();
}

// ── Step 2: members / days ─────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderStep2() {
  renderMembers();
  renderGroupMembers();
  renderDays();
  renderExtras();
  updateMissingSummary();
}

// ── Extras (presetShopping / checklist / notes) ─────────────────────
// These flow through from AI parse or HTML import into state.parsedExtras
// and were previously un-editable, so users who started from someone else's
// trip ended up with mismatched preset items (e.g. tohoku 萩之月 on a 台東
// trip). Step 1 now exposes them as three plain-list editors.
function ensureExtras() {
  if (!state.parsedExtras) state.parsedExtras = {};
  const e = state.parsedExtras;
  if (!Array.isArray(e.presetShopping)) e.presetShopping = [];
  if (!Array.isArray(e.checklist))      e.checklist = [];
  if (!Array.isArray(e.notes))          e.notes = [];
  // 遷移舊的字串格式 → { name, place } 物件
  e.presetShopping = e.presetShopping.map(item => {
    if (!item || typeof item !== 'object') return { name: String(item || ''), place: '' };
    if ('name' in item) return item;                          // 已是新格式
    if ('text' in item) return { name: item.text, place: '' }; // 中間格式
    return { name: '', place: '' };
  });
}

function renderExtras() {
  ensureExtras();
  renderShoppingEditor();
  renderChecklistEditor();
  renderNotesEditor();
}

function renderShoppingEditor() {
  const el = document.getElementById('shopping-list');
  if (!el) return;
  const items = state.parsedExtras.presetShopping;
  if (!items.length) {
    el.innerHTML = '<div class="muted" style="padding:4px 0;">尚無項目</div>';
    return;
  }
  el.innerHTML = items.map((item, i) =>
    `<div class="list-item-row">
      <div class="shop-fields">
        <input type="text" value="${escHtml(item.name || '')}" placeholder="品名"
          oninput="state.parsedExtras.presetShopping[${i}].name=this.value;saveState()">
        <input type="text" value="${escHtml(item.place || '')}" placeholder="哪裡買"
          class="shop-place-i"
          oninput="state.parsedExtras.presetShopping[${i}].place=this.value;saveState()">
      </div>
      <button class="act-del" onclick="removeShoppingItem(${i})" title="刪除">✕</button>
    </div>`
  ).join('');
}
function addShoppingItem(refocus) {
  ensureExtras();
  const nameEl  = document.getElementById('new-shopping-name');
  const placeEl = document.getElementById('new-shopping-place');
  const name  = (nameEl.value  || '').trim();
  if (!name) { if (refocus !== false) nameEl.focus(); return; }
  const place = (placeEl.value || '').trim();
  state.parsedExtras.presetShopping.push({ name, place });
  nameEl.value = ''; placeEl.value = '';
  if (refocus !== false) nameEl.focus();
  saveState();
  // 重畫延到下一輪 tick：這個函式也會被「新增列失焦」呼叫（見 handleShoppingAddBlur），
  // 若同步重畫 #shopping-list，會把使用者滑鼠正按著的其他項目刪除鈕整個換掉、導致那次
  // 點擊落空。資料（push／saveState）本身仍同步，同一輪內讀取 state 的地方不受影響。
  setTimeout(renderShoppingEditor, 0);
}
// 新增列（購物）失焦時的安全網：焦點若還停在品名／地點兩欄之間就不算離開，
// 真的離開這組欄位、且品名有內容，才視同按下 Enter 自動存入——避免打完字忘記按
// Enter／新增鈕就點別處，內容整段消失。
function handleShoppingAddBlur(e) {
  const wrap = document.getElementById('shopping-add-row');
  if (wrap && wrap.contains(e.relatedTarget)) return;
  const nameEl = document.getElementById('new-shopping-name');
  if ((nameEl.value || '').trim()) addShoppingItem(false);
}
function removeShoppingItem(i) {
  state.parsedExtras.presetShopping.splice(i, 1);
  renderShoppingEditor();
  saveState();
}

function clearChecklist() {
  if (!state.parsedExtras.checklist.length) return;
  if (!confirm('確定清除全部行前清單項目？')) return;
  state.parsedExtras.checklist = [];
  renderChecklistEditor();
  saveState();
}

function renderChecklistEditor() {
  const el = document.getElementById('checklist-list');
  if (!el) return;
  const items = state.parsedExtras.checklist;
  if (!items.length) {
    el.innerHTML = '<div class="muted" style="padding:4px 0;">尚無項目</div>';
    return;
  }
  const banner = `<div class="checklist-source-note">
    📎 這些項目可能由 AI 從你的行程資料整理而來，請確認是否適用，不需要的可以刪除。
  </div>`;
  el.innerHTML = banner + items.map((txt, i) =>
    `<div class="list-item-row">
      <input type="text" value="${escHtml(txt)}" placeholder="（空白項目，可刪除）"
        oninput="state.parsedExtras.checklist[${i}]=this.value;saveState()">
      <button class="act-del" onclick="removeChecklistItem(${i})" title="刪除">✕</button>
    </div>`
  ).join('');
}
function addChecklistItem() {
  ensureExtras();
  const input = document.getElementById('new-checklist-item');
  const v = (input.value || '').trim();
  if (!v) return;
  state.parsedExtras.checklist.push(v);
  input.value = '';
  saveState();
  // 重畫延到下一輪 tick，理由同 addShoppingItem：避免「打完字沒送出、直接點某個
  // 已存項目的刪除鈕」時，同步重畫把使用者正按著的刪除鈕換掉，讓那次點擊落空。
  setTimeout(renderChecklistEditor, 0);
}
function removeChecklistItem(i) {
  state.parsedExtras.checklist.splice(i, 1);
  renderChecklistEditor();
  saveState();
}

function renderNotesEditor() {
  const el = document.getElementById('notes-list');
  if (!el) return;
  const items = state.parsedExtras.notes;
  if (!items.length) {
    el.innerHTML = '<div class="muted" style="padding:4px 0;">尚無項目</div>';
    return;
  }
  el.innerHTML = items.map((n, i) => {
    const text = (n && n.text) || '';
    return `<div class="list-item-row">
      <input type="text" value="${escHtml(text)}" placeholder="（空白項目，可刪除）"
        oninput="state.parsedExtras.notes[${i}].text=this.value;saveState()">
      <button class="act-del" onclick="removeNote(${i})" title="刪除">✕</button>
    </div>`;
  }).join('');
}
function addNote() {
  ensureExtras();
  const textEl = document.getElementById('new-note-text');
  const text = (textEl.value || '').trim();
  if (!text) return;
  state.parsedExtras.notes.push({ icon: '⚠️', text });
  textEl.value = '';
  saveState();
  // 重畫延到下一輪 tick，理由同 addShoppingItem：避免「打完字沒送出、直接點某個
  // 已存項目的刪除鈕」時，同步重畫把使用者正按著的刪除鈕換掉，讓那次點擊落空。
  setTimeout(renderNotesEditor, 0);
}
function removeNote(i) {
  state.parsedExtras.notes.splice(i, 1);
  renderNotesEditor();
  saveState();
}

function renderMembers() {
  if (state.step === 1) updateMissingSummary();
  const el = document.getElementById('member-chips');
  if (!state.members.length) {
    el.innerHTML = '<span class="muted">尚未新增成員</span>';
    return;
  }
  el.innerHTML = state.members.map((m, i) =>
    `<div class="member-chip">
      <input class="chip-name-input" value="${escHtml(m.name || '')}" size="${Math.max(2, (m.name || '').length)}"
        aria-label="成員名字"
        oninput="state.members[${i}].name=this.value;this.size=Math.max(2,this.value.length);saveState()">
      <button class="chip-del" onclick="removeMember(${i})" title="刪除成員">✕</button>
    </div>`
  ).join('');
}
function addMember() {
  const name = document.getElementById('new-name').value.trim();
  if (!name) return;
  state.members.push({ id: newMemberId(), name, avatar: '' });
  document.getElementById('new-name').value = '';
  renderMembers();
  renderGroupMembers();
  saveState();
}
function removeMember(i) {
  const gone = state.members.splice(i, 1)[0];
  if (gone) removeMemberFromLists(state, gone.id, gone.name);   // 從所有同行名單拿掉；沒分組時什麼都不會動
  renderMembers();
  if (groupsGrouped() || _groupEditOpen) { renderGroupMembers(); renderDays(); }
  saveState();
}

// Google Maps 預覽連結：URL 直接用；否則組成搜尋查詢
function mapPreviewUrl(q) {
  const s = String(q || '').trim();
  if (!s) return 'about:blank';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://maps.google.com/?q=' + encodeURIComponent(s);
}

// 「確認定位」按鈕的 hover 提示：清楚說明會用什麼關鍵字搜尋（吃 timeline item）
function mapPreviewTitle(it) {
  const loc = it?.location || {};
  const name = String(it?.title || '').trim();
  if (loc.url) {
    return '將直接開啟你貼上的 Google Maps 連結';
  }
  if (loc.query) {
    return `將以「${loc.query}」於 Google Maps 搜尋；找到正確地點後按「分享 → 複製連結」貼回左方欄位，才會有這個地點的天氣`;
  }
  if (name) {
    return `地點欄位空白，將以活動名稱「${name}」搜尋 — 找到正確地點後按「分享 → 複製連結」貼回左方欄位，才會有這個地點的天氣`;
  }
  return '請先填寫地點名稱或活動名稱';
}

// 📍 欄位輸入：單一字串可能是名稱或連結，存進統一的 location 物件
// 貼上分享短網址 → 自動送去展開，讀出位置與地點名稱
function setItemMap(di, idx, value) {
  const it = state.days[di]?.items?.[idx];
  if (!it) return;
  const url = String(value || '').trim();
  if (isShortMapLink(url)) _linkFailed.delete(url);   // 使用者重新貼上 → 允許重試
  it.location = makeLocation(value);
  saveState();
  updateMapStatus(di, idx);
}

// 地點狀態：連結型→讀出的地點名稱／讀取中／讀不到；名稱型→提示「貼連結才有天氣」；空白→不顯示
// （天氣只用使用者指定的位置，地名文字不查天氣；見 docs/use-cases/map-link-location.md）
const MAP_HOWTO = 'Google 地圖找到地點 → 分享 → 複製連結 → 貼回左邊 📍 欄位。';
function mapInfoHtml(label, text) {
  return ` <span class="map-info-wrap"><button type="button" class="map-info" aria-label="${escHtml(label)}" aria-expanded="false" onclick="toggleMapInfo(event,this)">${escHtml(label)}</button><span class="map-info-pop" role="tooltip">${escHtml(text)}</span></span>`;
}
function mapStatusHtml(di, idx, it) {
  const loc = it.location || {};
  if (loc.url) {
    const info = locLinkInfo(loc);
    if (info.status === 'pending') { setTimeout(() => ensureLocResolved(di, idx), 0); return '<span class="map-badge wait">⏳ 讀取中…</span>'; }
    if (info.status === 'failed')  return '<span class="map-badge warn">⚠️ 讀不到位置</span>' + mapInfoHtml('ⓘ 怎麼辦？', '確認連結沒有貼錯、網路正常後，重新貼上一次。' + MAP_HOWTO);
    if (info.status === 'noplace') return '<span class="map-badge warn">⚠️ 沒有指向單一地點</span>' + mapInfoHtml('ⓘ 怎麼辦？', '這個連結是搜尋結果或路線。請在 Google 地圖點選一個地點，再按「分享 → 複製連結」貼回來。');
    const nm = info.name || '已定位';
    return `<span class="map-badge ok" title="已定位：${escHtml(nm)}（天氣會用這個地點）">✅ ${escHtml(nm)}</span>`;
  }
  if (!loc.query) return '';                 // 空白：不顯示
  return mapInfoHtml('ⓘ 貼連結才有天氣', '只填地名不會查天氣（「查看地圖」仍可用）。貼地圖分享連結才會有這個地點的天氣：' + MAP_HOWTO);
}

// 即時更新某項目的「查看地圖」連結 + 狀態控制項（不重渲染，保留輸入焦點）
function updateMapStatus(di, ai) {
  const it = state.days[di]?.items?.[ai];
  if (!it) return;
  const link = document.getElementById(`map-verify-${di}-${ai}`);
  if (link) {
    link.href = mapPreviewUrl(locationToMap(it.location) || it.title);
    link.title = mapPreviewTitle(it);
  }
  const st = document.getElementById(`map-status-${di}-${ai}`);
  if (st) st.innerHTML = mapStatusHtml(di, ai, it);
}

// 判斷活動是否「應該有時間」——班機、列車、演唱會等（吃 timeline item）
function needsTime(it) {
  if (!it) return false;
  const icon = String(it.icon || '');
  const name = String(it.title || '') + String(it.sub || '');
  if (/[✈🚄🚅🚃🚆🚉🚇🎵🎤🎫🎟]/u.test(icon)) return true;
  if (/(飛|班機|航班|機場|起飛|抵達|新幹線|高鐵|電車|列車|演唱會|開演|開場|演出|表演|入場|登機)/.test(name)) return true;
  return false;
}

function renderDays() {
  const c = document.getElementById('day-cards');
  // ── 保留 scroll 位置 + 哪些 day 是展開的，避免重繪後頁面跳位 ──────
  const savedScrollY = window.scrollY;
  const openIds = new Set([...document.querySelectorAll('.day-card.open')].map(el => el.id));
  const gctx = groupRenderContext();   // 沒分組是 null：下面所有分組片段都不產生（規則 7）
  renderAlertBar(gctx);

  if (!state.days.length) {
    c.innerHTML = '<div style="text-align:center;color:var(--ink-3);padding:18px;font-size:var(--fs-fine);">尚未有行程，點下方「新增一天」開始</div>';
    return;
  }
  const cardHtml = state.days.map((d, i) => {
    // 一天的 items 依 type 渲染：activity + flight 都進時間軸，lodging 獨立在下方
    // 所有 handler 用「真實 items 索引」操作 state.days[i].items[idx]
    let acts = '';
    let hasFlight = false;
    let hasHotel  = false;
    (d.items || []).forEach((it, idx) => {
      if (it.type === 'activity') {
        const mapStr = locationToMap(it.location);
        acts += `<div class="act-edit-row" data-di="${i}" data-ai="${idx}"
            ondragover="actDragOver(event,${i},${idx})"
            ondragleave="actDragLeave(event)"
            ondrop="actDrop(event,${i},${idx})">
        <div class="act-row1">
          <span class="act-drag-handle" draggable="true"
            ondragstart="actDragStart(event,${i},${idx})"
            ondragend="actDragEnd(event)"
            title="拖曳排序">⋮⋮</span>
          <input class="act-icon-i" value="${escHtml(it.icon || '📍')}" oninput="state.days[${i}].items[${idx}].icon=this.value;saveState()">
          <input class="act-name-i" value="${escHtml(it.title)}" placeholder="活動名稱" oninput="state.days[${i}].items[${idx}].title=this.value;saveState();updateMapStatus(${i},${idx})">
          <input class="act-sub-i" value="${escHtml(it.sub || '')}" placeholder="副標題（選填）" oninput="state.days[${i}].items[${idx}].sub=this.value;saveState()">
          <input class="act-time-i${needsTime(it) && !it.time ? ' suggest' : ''}" value="${escHtml(it.time || '')}" placeholder="${needsTime(it) ? '抵達時間' : '🕐 選填'}" inputmode="numeric" title="${needsTime(it) ? '航班、演唱會、Check-in 等有固定時刻的活動建議填寫，用 24 小時制（下午 3 點＝15:00）' : '選填——有固定時刻才需要，用 24 小時制（下午 3 點＝15:00），填了會自動排序'}" oninput="state.days[${i}].items[${idx}].time=this.value;saveState();this.classList.toggle('suggest', needsTime(state.days[${i}].items[${idx}]) && !this.value)" onblur="onTimeBlur(${i})">
          ${parkToggleHtml(i, idx, it)}
          <button class="act-copy" onclick="startCopyItem(${i},${idx})" title="複製到其他天">複製</button>
          <button class="act-del" onclick="removeAct(${i},${idx})" title="刪除">✕</button>
        </div>
        ${gctx ? itemWhoHtml(gctx, d, i, it, idx) : ''}
        <div class="act-row2">
          <span class="map-label">📍</span>
          <input class="act-map-i" value="${escHtml(mapStr)}" placeholder="地圖連結或地名" oninput="setItemMap(${i},${idx},this.value)">
          <a class="map-verify" id="map-verify-${i}-${idx}" href="${mapPreviewUrl(mapStr || it.title)}" target="_blank" rel="noopener" title="${escHtml(mapPreviewTitle(it))}">查看地圖 ↗</a>
          <span class="map-status" id="map-status-${i}-${idx}">${mapStatusHtml(i, idx, it)}</span>
        </div>
        <div class="act-row2">
          <span class="map-label">📋</span>
          <input class="act-map-i" value="${escHtml(it.ref || '')}" placeholder="訂位號碼（選填）" oninput="state.days[${i}].items[${idx}].ref=this.value;saveState()">
        </div>
      </div>`;
      } else if (it.type === 'flight') {
        const fd = it.data || {};
        hasFlight = true;
        acts += `<div class="act-edit-row flight-inline" data-di="${i}" data-ai="${idx}"
            ondragover="actDragOver(event,${i},${idx})"
            ondragleave="actDragLeave(event)"
            ondrop="actDrop(event,${i},${idx})">
          <div class="act-row1">
            <span class="act-drag-handle" draggable="true"
              ondragstart="actDragStart(event,${i},${idx})"
              ondragend="actDragEnd(event)"
              title="拖曳排序">⋮⋮</span>
            <span class="act-icon-i" style="pointer-events:none;user-select:none;">✈️</span>
            <input class="act-name-i" value="${escHtml(it.title || '')}" placeholder="去程航班 / 回程航班" oninput="state.days[${i}].items[${idx}].title=this.value;saveState()">
            <input class="act-num-i" value="${escHtml(fd.num || '')}" placeholder="JX802" oninput="state.days[${i}].items[${idx}].data.num=this.value;saveState()">
            <input class="act-time-i" value="${escHtml(fd.dept || '')}" placeholder="起飛 HH:MM" inputmode="numeric" title="起飛時間（24 小時制），填了會自動排序" oninput="state.days[${i}].items[${idx}].data.dept=this.value;state.days[${i}].items[${idx}].time=this.value;saveState()" onblur="onTimeBlur(${i})">
            <button class="act-copy" onclick="startCopyItem(${i},${idx})" title="複製到其他天">複製</button>
            <button class="act-del" onclick="removeFlight(${i})" title="移除">✕</button>
          </div>
          ${gctx ? itemWhoHtml(gctx, d, i, it, idx) : ''}
          <div class="flight-row2">
            <input value="${escHtml(fd.from || '')}" placeholder="TPE" maxlength="4" style="text-transform:uppercase;" oninput="state.days[${i}].items[${idx}].data.from=this.value.toUpperCase();saveState()">
            <input value="${escHtml(fd.fromCity || '')}" placeholder="桃園" oninput="state.days[${i}].items[${idx}].data.fromCity=this.value;saveState()">
            <span class="flight-arrow">→</span>
            <input value="${escHtml(fd.to || '')}" placeholder="NRT" maxlength="4" style="text-transform:uppercase;" oninput="state.days[${i}].items[${idx}].data.to=this.value.toUpperCase();saveState()">
            <input value="${escHtml(fd.toCity || '')}" placeholder="成田" oninput="state.days[${i}].items[${idx}].data.toCity=this.value;saveState()">
            <input value="${escHtml(fd.arr || '')}" placeholder="降落 HH:MM" oninput="state.days[${i}].items[${idx}].data.arr=this.value;saveState()">
          </div>
          <div class="flight-row3">
            <span class="flight-terminal-label">航廈</span>
            <input value="${escHtml(fd.fromTerminal || '')}" placeholder="起飛航廈（選填）" oninput="state.days[${i}].items[${idx}].data.fromTerminal=this.value;saveState()">
            <span class="flight-arrow">→</span>
            <input value="${escHtml(fd.toTerminal || '')}" placeholder="抵達航廈（選填）" oninput="state.days[${i}].items[${idx}].data.toTerminal=this.value;saveState()">
          </div>
          <div class="act-row2">
            <span class="map-label">📋</span>
            <input class="act-map-i" value="${escHtml(it.ref || '')}" placeholder="訂位號碼（選填）" oninput="state.days[${i}].items[${idx}].ref=this.value;saveState()">
          </div>
        </div>`;
      } else if (it.type === 'lodging') {
        const ld = it.data || {};
        const hMap = locationToMap(it.location);
        hasHotel = true;
        const paidChecked = ld.paid ? 'checked' : '';
        acts += `<div class="act-edit-row hotel-inline" data-di="${i}" data-ai="${idx}"
            ondragover="actDragOver(event,${i},${idx})"
            ondragleave="actDragLeave(event)"
            ondrop="actDrop(event,${i},${idx})">
          <div class="act-row1">
            <span class="act-drag-handle" style="visibility:hidden" aria-hidden="true">⋮⋮</span>
            <span class="act-icon-i" style="pointer-events:none;user-select:none;">🏨</span>
            <input class="act-name-i" value="${escHtml(it.title || '')}" placeholder="飯店名稱" oninput="state.days[${i}].items[${idx}].title=this.value;saveState();updateMapStatus(${i},${idx})">
            <label class="hotel-paid-label">
              <input type="checkbox" ${paidChecked} onchange="state.days[${i}].items[${idx}].data.paid=this.checked;saveState()">
              已付清
            </label>
            ${parkToggleHtml(i, idx, it)}
            <button class="act-copy" onclick="startCopyItem(${i},${idx})" title="複製到其他天">複製</button>
            <button class="act-del" onclick="removeHotel(${i})" title="移除">✕</button>
          </div>
          ${gctx ? itemWhoHtml(gctx, d, i, it, idx) : ''}
          <div class="act-row2">
            <span class="map-label">📍</span>
            <input class="act-map-i" value="${escHtml(hMap)}" placeholder="地圖連結或地名" oninput="setItemMap(${i},${idx},this.value)">
            <a class="map-verify" id="map-verify-${i}-${idx}" href="${mapPreviewUrl(hMap || it.title)}" target="_blank" rel="noopener" title="${escHtml(mapPreviewTitle(it))}">查看地圖 ↗</a>
            <span class="map-status" id="map-status-${i}-${idx}">${mapStatusHtml(i, idx, it)}</span>
          </div>
          <div class="act-row2">
            <span class="map-label">📋</span>
            <input class="act-map-i" value="${escHtml(ld.note || '')}" placeholder="費用備註（選填）" oninput="state.days[${i}].items[${idx}].data.note=this.value;saveState()">
          </div>
        </div>`;
      }
    });
    const selfDriveRow = state.fields['f-self-drive'] ? `
        <label class="day-selfdrive">
          <input type="checkbox" ${d.selfDrive ? 'checked' : ''} onchange="toggleDaySelfDrive(${i})">
          🚗 這天自駕 <span class="day-selfdrive-hint">— 開啟後本日景點會出現「🅿️ 停車」，徒步的可逐一關掉</span>
        </label>` : '';
    const addFlightBtn = hasFlight ? '' : `<button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="addFlight(${i})">＋ 新增機票</button>`;
    const addHotelBtn  = hasHotel  ? '' : `<button class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="addHotel(${i})">＋ 新增住宿</button>`;
    return `<div class="day-card${gctx && gctx.byDay.has(d.id) ? ' g-warned' : ''}" id="day-${i}">
      <div class="day-card-header" onclick="toggleDay(${i})">
        <span class="day-badge">Day ${d.day || i + 1}</span>
        <span class="day-emoji">${d.emoji || '📍'}</span>
        <div style="flex:1;min-width:0;">
          <div class="day-theme ${d.theme ? '' : 'empty'}">${escHtml(d.theme || '填入今日主題…')}</div>
          <div class="day-date-wd">${escHtml(d.date || '無日期')}${d.wd ? ' (' + d.wd + ')' : ''}</div>
          ${gctx ? dayGroupHeadHtml(gctx, d, i) : ''}
        </div>
        <button class="btn-icon-x" onclick="event.stopPropagation();removeDay(${i})" title="刪除這天">✕</button>
        <span class="chevron">▶</span>
      </div>
      ${gctx ? dayGroupBelowHeaderHtml(gctx, d, i) : ''}
      <div class="day-card-body">
        <div class="grid3" style="margin-bottom:12px;">
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:var(--fs-fine);">日期</label>
            <input type="text" value="${escHtml(d.date || '')}" placeholder="4/15" oninput="state.days[${i}].date=this.value;saveState()"${gctx ? ' onchange="onDayDateChange()"' : ''}>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:var(--fs-fine);">星期</label>
            <input type="text" value="${escHtml(d.wd || '')}" placeholder="三" maxlength="1" oninput="state.days[${i}].wd=this.value;saveState()">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:var(--fs-fine);">今日主題 <span style="font-weight:400;color:var(--ink-3);font-family:var(--font-sans);">— 這天的標題</span></label>
            <input type="text" value="${escHtml(d.theme || '')}" placeholder="抵達仙台、青葉城跡" oninput="state.days[${i}].theme=this.value;saveState();renderDayHeader(${i})">
          </div>
        </div>
        ${selfDriveRow}
        <div class="card-label">活動 <span style="font-weight:400;color:var(--ink-3);text-transform:none;letter-spacing:0;">— 📍 欄位貼 Google 地圖的分享連結（地圖上找到地點 → 分享 → 複製連結），才會有這個地點的天氣；只填地名也行，但不查天氣</span></div>
        <div class="act-list">${acts || '<div class="muted" style="padding:6px 0;">尚無活動</div>'}</div>
        <button class="btn btn-secondary btn-block btn-sm" onclick="addAct(${i})">＋ 新增活動</button>
        ${addFlightBtn}
        ${addHotelBtn}
        ${gctx ? dayGroupActionsHtml(gctx, d) : ''}
      </div>
    </div>`;
  });
  c.innerHTML = gctx ? assembleGroupedCards(gctx, cardHtml) : cardHtml.join('');
  // ── 還原 open state + scroll（避免全量重建後頁面跳位）──────────────
  openIds.forEach(id => document.getElementById(id)?.classList.add('open'));
  window.scrollTo({ top: savedScrollY, behavior: 'instant' });
}

function renderDayHeader(i) {
  const card = document.getElementById('day-' + i);
  if (!card) return;
  const themeEl = card.querySelector('.day-theme');
  if (themeEl) {
    themeEl.textContent = state.days[i].theme || '填入今日主題…';
    themeEl.classList.toggle('empty', !state.days[i].theme);
  }
}

function toggleDay(i) { document.getElementById('day-' + i).classList.toggle('open'); }
function removeDay(i) {
  if (!confirm('確定刪除 Day ' + (i + 1) + '？')) return;
  state.days.splice(i, 1);
  if (groupsGrouped()) renumberDaysByDate(state.days);   // 同日的卡 Day 編號相同
  else state.days.forEach((d, j) => d.day = j + 1);
  renderDays();
  saveState();
}
function addDay() {
  state.days.push(newDay(state.days.length + 1));
  renderDays();
  setTimeout(() => document.getElementById('day-' + (state.days.length - 1))?.classList.add('open'), 30);
  saveState();
}
// 新活動接在時間軸最後一列之後（航班可能被排到早上，不能再用「第一個非活動列之前」）
function _activityInsertIndex(d) {
  const items = d.items || [];
  for (let i = items.length - 1; i >= 0; i--) if (_isTimeline(items[i])) return i + 1;
  return 0;
}
function addAct(i) {
  const d = state.days[i];
  const insertIdx = _activityInsertIndex(d);
  d.items.splice(insertIdx, 0, newItem('activity'));
  renderDays();
  setTimeout(() => {
    document.getElementById('day-' + i)?.classList.add('open');
    // 用剛新增項目的實際 index 精準選取，不能抓「最後一個 .act-name-i」——
    // 飯店欄位共用同一個 class，住宿永遠排在 items 最後，抓最後一個會跳到飯店欄
    document.querySelector(`#day-${i} [data-di="${i}"][data-ai="${insertIdx}"] .act-name-i`)?.focus();
  }, 30);
  saveState();
}
// ── Undo Toast ────────────────────────────────────────────────────────
let _undoTimer    = null;   // toast 消失計時器（5 秒）
let _undoFnTimer  = null;   // _undoFn 失效計時器（30 秒）
let _undoFn       = null;

function showUndoToast(label, restoreFn) {
  clearTimeout(_undoTimer); clearTimeout(_undoFnTimer);
  _undoFn = restoreFn;
  const toast = document.getElementById('undo-toast');
  const msg   = document.getElementById('undo-msg');
  if (toast && msg) { msg.textContent = label; toast.classList.add('show'); }
  // Toast 5 秒後隱藏（視覺），但 Ctrl+Z 30 秒內仍有效
  _undoTimer   = setTimeout(() => document.getElementById('undo-toast')?.classList.remove('show'), 5000);
  _undoFnTimer = setTimeout(() => { _undoFn = null; }, 30000);
}
function doUndo() {
  clearTimeout(_undoTimer); clearTimeout(_undoFnTimer);
  if (_undoFn) { _undoFn(); _undoFn = null; }
  document.getElementById('undo-toast')?.classList.remove('show');
}
function dismissUndo() {
  document.getElementById('undo-toast')?.classList.remove('show');
  _undoFn = null;
}

// Ctrl+Z / Cmd+Z（30 秒內有效，不在輸入框時才觸發）
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (!['input','textarea','select'].includes(tag) && _undoFn) {
      doUndo(); e.preventDefault();
    }
  }
});

// ── 複製到其他天 ──────────────────────────────────────────────────────
let _copyPending = null;   // { di, ai }

function startCopyItem(di, ai) {
  _copyPending = { di, ai };
  const d = state.days[di];
  const item = d.items[ai];
  const typeLabel = item.type === 'flight' ? '航班' : item.type === 'lodging' ? '住宿' : '活動';
  const panel = document.getElementById('copy-panel');
  const title = document.getElementById('copy-panel-title');
  const btns  = document.getElementById('copy-day-btns');
  if (!panel || !btns) return;
  title.textContent = `複製「${item.title || typeLabel}」到哪一天？`;
  btns.innerHTML = state.days.map((day, i) =>
    `<button class="copy-day-btn${i === di ? ' copy-day-same' : ''}" onclick="executeCopy(${i})">
      <span class="copy-day-num">Day ${day.day}</span>
      <span class="copy-day-theme">${escHtml(day.theme || '（未填主題）')}</span>
    </button>`
  ).join('');
  panel.classList.add('show');
}
function executeCopy(targetDi) {
  if (!_copyPending) return;
  const { di, ai } = _copyPending;
  const item = JSON.parse(JSON.stringify(state.days[di].items[ai]));
  item.id = genId();
  // 住宿一天一筆：若目標天已有住宿則替換
  if (item.type === 'lodging') {
    const old = state.days[targetDi].items.findIndex(it => it.type === 'lodging');
    if (old !== -1) state.days[targetDi].items.splice(old, 1);
  }
  // 機票一天一筆：若目標天已有機票則替換
  if (item.type === 'flight') {
    const old = state.days[targetDi].items.findIndex(it => it.type === 'flight');
    if (old !== -1) state.days[targetDi].items.splice(old, 1);
  }
  const target = state.days[targetDi];
  if (_isTimeline(item)) {
    target.items.splice(_activityInsertIndex(target), 0, item);
    _orderTimeline(target);
  } else {
    target.items.push(item);
  }
  saveState(); renderDays();
  cancelCopy();
  // 展開目標天讓使用者看到結果
  setTimeout(() => document.getElementById('day-' + targetDi)?.classList.add('open'), 30);
}
function cancelCopy() {
  document.getElementById('copy-panel')?.classList.remove('show');
  _copyPending = null;
}

function removeAct(di, ai) {
  const removed = JSON.parse(JSON.stringify(state.days[di].items[ai]));
  const label = `已刪除「${removed.title || '活動'}」`;
  state.days[di].items.splice(ai, 1);
  renderDays();
  saveState();
  showUndoToast(label, () => {
    state.days[di].items.splice(ai, 0, removed);
    _orderTimeline(state.days[di]);
    renderDays(); saveState();
  });
}
function addHotel(i) {
  const d = state.days[i];
  if (dayLodging(d)) return;          // 一天一筆住宿
  d.items.push(newItem('lodging'));   // 住宿排在最後
  renderDays();
  saveState();
}
function addFlight(i) {
  const d = state.days[i];
  if (dayFlight(d)) return;            // 一天一筆機票
  const lodgeIdx = d.items.findIndex(it => it.type === 'lodging');
  const at = lodgeIdx === -1 ? d.items.length : lodgeIdx;  // 機票排在住宿之前
  d.items.splice(at, 0, newItem('flight'));
  renderDays();
  saveState();
}
function removeHotel(i) {
  const d = state.days[i];
  const idx = d.items.findIndex(it => it.type === 'lodging');
  if (idx === -1) return;
  const removed = JSON.parse(JSON.stringify(d.items[idx]));
  const label = `已移除住宿「${removed.title || '住宿'}」`;
  d.items.splice(idx, 1);
  renderDays();
  saveState();
  showUndoToast(label, () => {
    state.days[i].items.splice(idx, 0, removed);
    _orderTimeline(state.days[i]);
    renderDays(); saveState();
  });
}
function removeFlight(i) {
  const d = state.days[i];
  const idx = d.items.findIndex(it => it.type === 'flight');
  if (idx === -1) return;
  const removed = JSON.parse(JSON.stringify(d.items[idx]));
  const label = `已移除航班「${removed.title || '班機'}」`;
  d.items.splice(idx, 1);
  renderDays();
  saveState();
  showUndoToast(label, () => {
    state.days[i].items.splice(idx, 0, removed);
    _orderTimeline(state.days[i]);
    renderDays(); saveState();
  });
}

// ── Activity drag & time sorting ───────────────────────────────────
let _actDragSrc = null;
function _parseT(s) {
  const m = String(s || '').match(/^\s*(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : -1;
}
// 會出現在 App 時間軸上的列；住宿顯示在住宿卡，不在時間軸上
function _isTimeline(it) { return it.type === 'activity' || it.type === 'flight'; }
// 必須跟 toLegacyDay 匯出給 App 的時間一致（航班優先用起飛時間），兩邊才會排出同樣順序
function _rowTime(it) {
  return it.type === 'flight' ? ((it.data || {}).dept || it.time || '') : (it.time || '');
}
// ↓ _insertByTime／_minimalTimeOrder 與 template-src.html 的同名函式必須逐字相同，產生器畫面才會等於輸出順序
function _insertByTime(list, row, minOf) {
  const m = minOf(row);
  const at = m < 0 ? -1 : list.findIndex(x => minOf(x) > m);
  if (at < 0) list.push(row); else list.splice(at, 0, row);
}
// 只移動時間放錯的列：保留「最多列已照時間排好」的那組不動（同樣多時保留排在前面的），
// 其餘有時間的列插回第一個比它晚的列之前；沒時間的列跟著原本的前後鄰居，不動。
function _minimalTimeOrder(rows, minOf) {
  const pos = [], t = [];
  rows.forEach((r, i) => { const m = minOf(r); if (m >= 0) { pos.push(i); t.push(m); } });
  const best = t.map(() => 1);
  for (let i = t.length - 2; i >= 0; i--)
    for (let k = i + 1; k < t.length; k++) if (t[k] >= t[i] && best[k] + 1 > best[i]) best[i] = best[k] + 1;
  const keep = new Set();
  let need = t.length ? Math.max(...best) : 0, last = -1;
  for (let i = 0; i < t.length && need > 0; i++) {
    if (best[i] === need && (last < 0 || t[i] >= t[last])) { keep.add(pos[i]); last = i; need--; }
  }
  const out = rows.filter((r, i) => minOf(r) < 0 || keep.has(i));
  rows.forEach((r, i) => {
    const m = minOf(r);
    if (m < 0 || keep.has(i)) return;
    let at = out.findIndex(x => minOf(x) > m);
    // 沒有更晚的列：放在最後一個有時間的列之後，不要排到尾端沒時間的列後面
    if (at < 0) { at = out.length; for (let j = out.length - 1; j >= 0; j--) if (minOf(out[j]) >= 0) { at = j + 1; break; } }
    out.splice(at, 0, r);
  });
  return out;
}
// 住宿一律排在當天最後（住宿不在 App 時間軸上）
function _orderTimeline(d) {
  const items = d.items || [];
  const line = _minimalTimeOrder(items.filter(_isTimeline), it => _parseT(_rowTime(it)));
  const next = line.concat(items.filter(it => !_isTimeline(it)));
  const changed = next.some((it, i) => it !== items[i]);
  if (changed) d.items = next;
  return changed;
}
function _violatesTimeOrder(acts) {
  let lastT = -1, lastIdx = -1;
  for (let k = 0; k < acts.length; k++) {
    const t = _parseT(_rowTime(acts[k]));
    if (t < 0) continue;
    if (lastT >= 0 && t < lastT) return { k, lastIdx, t, lastT };
    lastT = t; lastIdx = k;
  }
  return null;
}
function _fmtT(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return h + ':' + m;
}
function actDragStart(ev, di, ai) {
  _actDragSrc = { di, ai };
  ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/plain', di + ':' + ai); } catch (e) {}
  const row = ev.target.closest('.act-edit-row');
  if (row) setTimeout(() => row.classList.add('dragging'), 0);
}
function actDragEnd() {
  document.querySelectorAll('.act-edit-row.dragging,.act-edit-row.drop-above').forEach(el => {
    el.classList.remove('dragging', 'drop-above');
  });
  _actDragSrc = null;
}
function actDragOver(ev, di) {
  if (!_actDragSrc || _actDragSrc.di !== di) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.act-edit-row.drop-above').forEach(el => el.classList.remove('drop-above'));
  ev.currentTarget.classList.add('drop-above');
}
function actDragLeave(ev) {
  if (ev.currentTarget && !ev.currentTarget.contains(ev.relatedTarget)) {
    ev.currentTarget.classList.remove('drop-above');
  }
}
function actDrop(ev, di, targetAi) {
  if (!_actDragSrc || _actDragSrc.di !== di) return;
  ev.preventDefault();
  const srcAi = _actDragSrc.ai;
  if (srcAi === targetAi) { actDragEnd(); return; }
  const items = state.days[di].items;
  // 活動與航班可互相拖曳；住宿沒有拖曳把手（一律固定在當天最後）
  const moved = items.splice(srcAi, 1)[0];
  const insertAt = targetAi > srcAi ? targetAi - 1 : targetAi;
  items.splice(insertAt, 0, moved);
  const acts = items.filter(_isTimeline);
  const v = _violatesTimeOrder(acts);
  if (v) {
    const a = acts[v.lastIdx], b = acts[v.k];
    items.splice(insertAt, 1);
    items.splice(srcAi, 0, moved);
    setTimeout(() => alert(
      `⚠ 此排序與時間衝突\n\n` +
      `「${a.title || '(未命名)'} ${_fmtT(v.lastT)}」不應排在\n` +
      `「${b.title || '(未命名)'} ${_fmtT(v.t)}」之前\n\n` +
      `請先修改其中一項的時間，再調整順序。`
    ), 0);
  } else {
    _orderTimeline(state.days[di]);
    saveState();
  }
  renderDays();
  document.getElementById('day-' + di)?.classList.add('open');
  _actDragSrc = null;
}
function onTimeBlur(di) {
  if (!_orderTimeline(state.days[di])) return;
  saveState();
  renderDays();
  document.getElementById('day-' + di)?.classList.add('open');
}

function updateMissingSummary() {
  const issues = [];
  const invalidFieldIds = [];
  if (!state.fields['f-title']) { issues.push('旅程名稱'); invalidFieldIds.push('ff-title'); }
  if (!state.members.length) issues.push('至少 1 位成員');
  if (!state.days.length) issues.push('每日行程');
  state.days.forEach((d, i) => {
    if (!d.date) issues.push(`Day ${i + 1} 日期`);
    if (!d.theme) issues.push(`Day ${i + 1} 主題`);
  });
  document.querySelectorAll('#panel-1 .field.invalid').forEach(el => el.classList.remove('invalid'));
  invalidFieldIds.forEach(id => document.getElementById(id)?.classList.add('invalid'));
  document.querySelectorAll('.day-card.invalid').forEach(el => el.classList.remove('invalid'));
  state.days.forEach((d, i) => {
    if (!d.date || !d.theme) document.getElementById('day-' + i)?.classList.add('invalid');
  });
  const el = document.getElementById('missing-summary');
  if (!el) return issues.length;
  if (!issues.length) {
    el.classList.remove('show');
    el.innerHTML = '';
  } else {
    const shown = issues.slice(0, 8);
    const rest = issues.length - shown.length;
    const items = shown.map(s => `<span class="item">${s}</span>`).join('');
    const more = rest > 0 ? `<span class="more">⋯ 還有 ${rest} 項</span>` : '';
    el.innerHTML = `
      <div class="alert-banner-head">
        <span class="mark">⚠</span>
        <span class="lede">還有 <span class="count">${issues.length}</span> 處待補</span>
        <span class="sub">Outstanding · 補齊後即可下一步</span>
      </div>
      <div class="alert-banner-list">${items}${more}</div>
    `;
    el.classList.add('show');
  }
  return issues.length;
}

// ── Firebase ───────────────────────────────────────────────────────
// Firebase config now lives in the Step 4 advanced section. The dedicated
// "skip vs enable" toggle was removed — useFirebase is auto-derived from
// whether the textarea has content. setFirebaseMode is kept for backward
// compatibility with importLoadedConfig() and hydrateUI().
function setFirebaseMode(on, silent) {
  state.useFirebase = on;
  if (!silent) saveState();
}

// Auto-derive useFirebase from textarea content so the user doesn't need
// a separate toggle. Empty / whitespace-only = disabled.
function onFirebaseInput() {
  const raw = (document.getElementById('f-firebase').value || '').trim();
  state.useFirebase = raw.length > 0;
  onAnyInput();
}

// 接受 Firebase 主控台直接複製的設定：純 JSON、const firebaseConfig = {...}、
// 或整段程式碼（含 import 等行）都行——優先定位 firebaseConfig = { 再取平衡大括號區段
function parseFirebaseConfig(raw) {
  let s = (raw || '').trim();
  if (!s) return null;
  const kw = s.search(/firebaseConfig\s*=\s*\{/);
  if (kw !== -1) {
    s = s.slice(s.indexOf('{', kw));
  } else {
    s = s.replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*/, '');
    const a = s.indexOf('{');
    if (a === -1) return null;
    s = s.slice(a);
  }
  let depth = 0, end = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  s = s.slice(0, end + 1);
  try { return JSON.parse(s); } catch (e) { }
  try { return JSON.parse(jsLiteralToJson(s)); } catch (e) { }
  return null;
}

// 旅程代碼（storagePrefix）對應的 Realtime Database 規則：只開放這趟旅程的路徑、無期限
function fbRulesFor(pfx) {
  return JSON.stringify({ rules: { [pfx]: { '.read': true, '.write': true } } }, null, 2);
}

function fbPrefix() {
  return (state.fields['f-storage-prefix'] || '').trim() || 'trip2026';
}

function renderFbRules() {
  const el = document.getElementById('fb-rules-code');
  if (el) el.textContent = fbRulesFor(fbPrefix());
}

async function copyFbRules() {
  const btn = document.getElementById('fb-rules-copy');
  try {
    await navigator.clipboard.writeText(fbRulesFor(fbPrefix()));
    btn.textContent = '✓ 已複製';
  } catch (e) {
    btn.textContent = '複製失敗，請手動選取';
  }
  setTimeout(() => { btn.textContent = '📋 複製規則'; }, 2000);
}

async function testFirebase() {
  const raw = document.getElementById('f-firebase').value.trim();
  const btn = document.getElementById('fb-test-btn');
  const st = document.getElementById('fb-status');
  if (!raw) { st.innerHTML = '<div class="status-box status-err">請先貼上 Firebase Config</div>'; return; }
  const cfg = parseFirebaseConfig(raw);
  if (!cfg) { st.innerHTML = '<div class="status-box status-err">看不懂這段設定。請回到 Firebase「註冊應用程式」後出現的畫面，把含 firebaseConfig 的整段程式碼複製、重新貼上</div>'; return; }
  if (!cfg.databaseURL) { st.innerHTML = '<div class="status-box status-err">缺少 databaseURL，請確認已建立 Realtime Database</div>'; return; }
  btn.innerHTML = '<span class="spinner"></span>&nbsp;測試中…';
  try {
    // 測 App 實際使用的旅程代碼路徑——規則沒發布或代碼不一致時會回 401，能在這裡就抓到
    const r = await fetch(cfg.databaseURL.replace(/\/$/, '') + '/' + encodeURIComponent(fbPrefix()) + '.json?shallow=true');
    if (r.ok) {
      st.innerHTML = '<div class="status-box status-ok">✓ Firebase 連線成功，已就緒</div>';
    } else if (r.status === 401 || r.status === 403) {
      st.innerHTML = '<div class="status-box status-err">資料庫拒絕存取。請照步驟 3 到「規則」分頁發布規則，並確認規則裡的代碼是「' + escHtml(fbPrefix()) + '」（和步驟二的旅程代碼相同）</div>';
    } else {
      st.innerHTML = '<div class="status-box status-err">連線失敗 HTTP ' + r.status + '。請確認 Realtime Database 已建立。</div>';
    }
  } catch (e) {
    st.innerHTML = '<div class="status-box status-err">無法連線：' + e.message + '</div>';
  } finally {
    btn.innerHTML = '測試連線';
  }
}

// ── Theme ──────────────────────────────────────────────────────────
function renderThemeStep() {
  document.getElementById('tp-title').textContent = state.fields['f-title'] || '✈️ 我的旅程';
  document.getElementById('tp-sub').textContent = state.fields['f-subtitle'] || '';
  document.getElementById('tp-date').textContent = state.fields['f-date-pill'] || '';
  document.getElementById('tp-dur').textContent = state.fields['f-duration-pill'] || '';
  document.getElementById('tp-ppl').textContent = formatPeoplePill(state.fields['f-people-pill']);
  const tc = document.getElementById('theme-cards');
  tc.innerHTML = THEMES.map((t, i) =>
    `<div class="theme-card${i === state.activeTheme ? ' active' : ''}" onclick="selectTheme(${i})">
      <div class="theme-card-preview" style="background:linear-gradient(135deg,${t.color},${t.accent})"></div>
      <div class="theme-card-label">${t.name}</div>
    </div>`
  ).join('');
  applyTheme();
}

function selectTheme(i) {
  state.activeTheme = i;
  const t = THEMES[i];
  state.fields['f-theme-color'] = t.color;
  state.fields['f-theme-accent'] = t.accent;
  state.fields['f-theme-light'] = t.light;
  state.fields['f-bg-color'] = t.bg;
  state.fields['f-bg-pale'] = t.pale;
  ['f-theme-color', 'f-theme-accent', 'f-theme-light', 'f-bg-color', 'f-bg-pale'].forEach(id => {
    document.getElementById(id).value = state.fields[id];
  });
  document.querySelectorAll('.theme-card').forEach((c, j) => c.classList.toggle('active', j === i));
  applyTheme();
  saveState();
}

function applyTheme() {
  const c = state.fields['f-theme-color'];
  const a = state.fields['f-theme-accent'];
  document.getElementById('tp-header').style.background = `linear-gradient(135deg,${c},${a})`;
}

// ── Step 5: summary / generate ─────────────────────────────────────
function renderSummary() {
  const grid = document.getElementById('summary-grid');
  const title = state.fields['f-title'] || '（未填）';
  const pfx = state.fields['f-storage-prefix'] || '（未填）';
  const pin = state.fields['f-pin'] || '（未設定）';
  const themeName = THEMES[state.activeTheme]?.name?.replace(/^[^ ]+ /, '') || '自訂';
  grid.innerHTML = [
    [title, '旅程名稱'],
    [state.days.length + ' 天', '行程天數'],
    [state.members.length + ' 人', '旅行成員'],
    [pin, 'PIN 碼'],
    [state.useFirebase ? '✓' : '—', 'Firebase 共享'],
    [themeName, '主題色彩'],
    [pfx, '旅程代碼'],
  ].map(([v, k]) => `<div class="sum-item"><div class="sv">${escHtml(v)}</div><div class="sk">${k}</div></div>`).join('');
}

function genPrefix() {
  const title = state.fields['f-title'] || 'trip';
  const yr = new Date().getFullYear();
  const base = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'trip';
  const rand = Math.random().toString(36).slice(2, 5);
  state.fields['f-storage-prefix'] = base + yr + rand;
  document.getElementById('f-storage-prefix').value = state.fields['f-storage-prefix'];
  saveState();
}

function collectConfig() {
  const f = state.fields;
  const title = (f['f-title'] || '').trim();
  const shortTitle = title.replace(/\s*\d{4}$/, '').slice(0, 6) || title.slice(0, 6);
  const firstEmoji = state.days[0]?.emoji || '✈️';
  const heading = firstEmoji + ' ' + title;
  const yearMatch = (f['f-date-pill'] || '').match(/\d{4}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
  const pin = (f['f-pin'] || '').trim() || '0000';
  const pfx = (f['f-storage-prefix'] || '').trim() || 'trip2026';
  let firebase = {};
  if (state.useFirebase) {
    firebase = parseFirebaseConfig(f['f-firebase']) || {};
  }
  return {
    meta: {
      title, shortTitle, heading,
      subtitle: (f['f-subtitle'] || '').trim(),
      datePill: (f['f-date-pill'] || '').trim(),
      durationPill: (f['f-duration-pill'] || '').trim(),
      peoplePill: formatPeoplePill((f['f-people-pill'] || '').trim()),
      // 結束日／結束時間（選填）：倒數以此為準，避免回程日沒排成一天時提早顯示「已結束」
      endDate: (f['f-end-date'] || '').trim(),
      endTime: (f['f-end-time'] || '').trim(),
      year, pin,
      selfDrive: !!f['f-self-drive'],
      region: (f['f-region'] || '日本'),
      parkingTerm: parkingTermFor(f['f-region'] || '日本'),
      themeColor: f['f-theme-color'],
      themeAccent: f['f-theme-accent'],
      themeLight: f['f-theme-light'],
      bgColor: f['f-bg-color'],
      bgPale: f['f-bg-pale'],
      storagePrefix: pfx,
      swCacheKey: state._loadedSwCacheKey || (pfx + '-v1'),
    },
    firebase,
    members: state.members.map(({ id, ...m }) => m),   // 內部 id 不輸出（行程 App 還用名字）
    // 總開關關閉時，匯出一律當作非自駕（逐天 selfDrive 仍保留在 state，重開即恢復）
    days: state.days.map(d => toLegacyDay(f['f-self-drive'] ? d : { ...d, selfDrive: false })),
    hotels: state.hotels.map(({ with: _w, withUnknown, unsure, ...h }) => h),   // 分組欄位這一包先不輸出
    restaurants: state.parsedExtras.restaurants || {},
    weatherLocs: state.parsedExtras.weatherLocs || {},
    checklist: state.parsedExtras.checklist || [],
    presetShopping: state.parsedExtras.presetShopping || [],
    removedPresets: [],
    notes: (state.parsedExtras.notes || []).filter(n => n && (n.text || '').trim()),
  };
}

function decodeTemplate() {
  const bytes = Uint8Array.from(atob(window.TRIP_TMPL_B64), c => c.charCodeAt(0));
  const layer1 = new TextDecoder().decode(bytes);
  if (/[À-÷][-¿]/.test(layer1)) {
    const inner = Uint8Array.from(layer1, c => c.charCodeAt(0));
    return new TextDecoder().decode(inner);
  }
  return layer1;
}

// Token-replace the template with a given config. Shared by the real build
// (buildIndexHtml) and the mock preview (buildPreviewHtml).
function applyTemplateTokens(html, cfg) {
  return html
    .replace(/__TRIP_TITLE__/g, cfg.meta.title)
    .replace(/__SHORT_TITLE__/g, cfg.meta.shortTitle)
    .replace(/__THEME_COLOR__/g, cfg.meta.themeColor)
    .replace(/__THEME_ACCENT__/g, cfg.meta.themeAccent)
    .replace(/__THEME_LIGHT__/g, cfg.meta.themeLight)
    .replace(/__BG_COLOR__/g, cfg.meta.bgColor)
    .replace(/__BG_PALE__/g, cfg.meta.bgPale)
    .replace(/__TRIP_HEADING__/g, cfg.meta.heading)
    .replace(/__TRIP_SUBTITLE__/g, cfg.meta.subtitle)
    .replace(/__DATE_PILL__/g, cfg.meta.datePill)
    .replace(/__DURATION_PILL__/g, cfg.meta.durationPill)
    .replace(/__PEOPLE_PILL__/g, cfg.meta.peoplePill)
    .replace(/__TRIP_PIN__/g, cfg.meta.pin || '0000')
    .replace(/__TRIP_CONFIG__/g, JSON.stringify(cfg));
}

function buildIndexHtml() {
  const cfg = collectConfig();
  return { html: applyTemplateTokens(decodeTemplate(), cfg), cfg };
}

// In-memory mock of the Firebase Realtime DB API the app uses, so the preview
// can demo the advanced (synced) mode WITHOUT a real Firebase project and
// WITHOUT touching the creator's real data. Single tab, resets on reload.
const PREVIEW_MOCK_FB = `<script>
(function(){
  const store = {}; const listeners = [];
  function seg(p){ return p.split('/').filter(Boolean); }
  function getAt(p){ let n = store; for (const s of seg(p)) { if (n == null) return null; n = n[s]; } return n === undefined ? null : n; }
  function setAt(p, v){ const parts = seg(p); let n = store; for (let i=0;i<parts.length-1;i++){ n[parts[i]] = n[parts[i]] || {}; n = n[parts[i]]; } if (v == null) delete n[parts[parts.length-1]]; else n[parts[parts.length-1]] = v; }
  function fire(changed){ listeners.forEach(l => { if (changed.indexOf(l.path) === 0 || l.path.indexOf(changed) === 0) l.cb({ val: () => getAt(l.path) }); }); }
  function ref(p){ return {
    on: (ev, cb) => { listeners.push({path:p, cb}); setTimeout(() => cb({ val: () => getAt(p) }), 0); },
    set: (v) => { setAt(p, v); fire(p); return Promise.resolve(); },
    update: (v) => { setAt(p, Object.assign({}, getAt(p) || {}, v)); fire(p); return Promise.resolve(); },
    remove: () => { setAt(p, null); fire(p); return Promise.resolve(); },
    push: (v) => { const k = 'k' + Math.random().toString(36).slice(2,9); setAt(p + '/' + k, v); fire(p); return { key: k }; },
  }; }
  window.firebase = { initializeApp(){}, database(){ return { ref }; } };
})();
</script>
`;

// Build a preview that never connects to a real Firebase project.
//   syncMode 'minimal'  → firebase stripped → localStorage mode (2 tabs, device-local edits)
//   syncMode 'advanced' → fake config → in-memory mock backend (4 tabs, collab UI live)
function buildPreviewHtml(syncMode) {
  const cfg = collectConfig();
  cfg.firebase = (syncMode === 'advanced')
    ? { apiKey: 'AIza-preview-mock', databaseURL: 'https://preview-mock.firebaseio.com' }
    : {};
  cfg._previewMock = true;
  if (syncMode !== 'advanced') cfg._quickShare = true;
  let html = decodeTemplate()
    // drop the real Firebase CDN tags and inject the in-memory mock instead
    .replace(/  <script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\n/g, '')
    .replace('<script>\n// ─── Trip Config', PREVIEW_MOCK_FB + '<script>\n// ─── Trip Config');
  return applyTemplateTokens(html, cfg);
}

// Generate the app icon SVG: 旅人手帖 brand mark (same as icon.svg) on the
// trip's theme colour. Brand-consistent and never squashes a long title; the
// theme-colour background still distinguishes trips at a glance.
function buildTripIconSvg(cfg) {
  const bg = cfg.meta.themeColor || '#a8362f';
  const fg = cfg.meta.bgPale    || '#fdf6ef';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <rect x="28" y="28" width="456" height="456" rx="10" fill="none" stroke="${fg}" stroke-width="2" opacity="0.3"/>
  <g transform="translate(256 256) scale(8.2)" fill="none" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="-23" y="-28" width="46" height="49" rx="4" stroke-width="1.7"/>
    <circle cx="12" cy="-17" r="4.5" fill="${fg}" opacity="0.85" stroke="none"/>
    <path d="M-20,10 L-6,-6 L2,3 L12,-13 L20,10" stroke-width="1.5"/>
    <line x1="-17" y1="14" x2="17" y2="14" stroke-width="0.9" stroke-dasharray="2,2.5" opacity="0.6"/>
    <path d="M-2.5,21 L-2.5,28.5 L0,26 L2.5,28.5 L2.5,21" stroke-width="1.5"/>
  </g>
  <text x="256" y="476" font-size="22" font-family="'Songti TC',serif" font-style="italic"
        fill="${fg}" opacity="0.6" text-anchor="middle" letter-spacing="5">TRIP JOURNAL</text>
</svg>`;
}

// Maskable 版圖示：Android 自適應圖示會把圖示裁成圓形／圓角，內容須落在中央安全區
// （約半徑 40%）。所以這版把品牌圖記縮小置中、拿掉底部 TRIP JOURNAL 文字（那行字正是
// 之前被裁掉的原因），底色滿版出血。一般（非 maskable）情境仍用上面的完整版。
function buildTripIconMaskableSvg(cfg) {
  const bg = cfg.meta.themeColor || '#a8362f';
  const fg = cfg.meta.bgPale    || '#fdf6ef';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <g transform="translate(256 256) scale(5.4)" fill="none" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <rect x="-23" y="-28" width="46" height="49" rx="4" stroke-width="1.7"/>
    <circle cx="12" cy="-17" r="4.5" fill="${fg}" opacity="0.85" stroke="none"/>
    <path d="M-20,10 L-6,-6 L2,3 L12,-13 L20,10" stroke-width="1.5"/>
    <line x1="-17" y1="14" x2="17" y2="14" stroke-width="0.9" stroke-dasharray="2,2.5" opacity="0.6"/>
    <path d="M-2.5,21 L-2.5,28.5 L0,26 L2.5,28.5 L2.5,21" stroke-width="1.5"/>
  </g>
</svg>`;
}

// Rasterise an SVG string to a PNG (base64, no data-URI prefix) at size×size
// via an offscreen canvas. Home-screen icons on Android & iOS need raster PNG —
// SVG manifest icons are unreliably picked up by Chrome's add-to-home-screen.
function svgToPngBase64(svg, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL('image/png').split(',')[1]);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('icon raster failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

function buildManifest(cfg) {
  return JSON.stringify({
    name: cfg.meta.title,
    short_name: cfg.meta.shortTitle || cfg.meta.title.slice(0, 12),
    start_url: './',
    display: 'standalone',
    background_color: cfg.meta.bgColor,
    theme_color: cfg.meta.themeColor,
    icons: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // 專用 maskable 圖示：內容置中在安全區，Android 圓形遮罩不會裁掉底部文字。
      { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
  }, null, 2);
}

function buildSw(cfg) {
  // cache key 每次下載都帶新的 build 版號：同一旅程重新產出→重新部署後，
  // 旅伴裝置上的 sw.js 一定有 byte 差異（觸發 SW 更新）、舊快取一定被淘汰。
  // 過去只靠 swCacheKey（僅在「還原匯入」時升版），從同瀏覽器草稿直接重產出
  // 會得到相同 key + 相同 sw.js，cache-first 的舊快取永不失效，旅伴被鎖在舊版。
  const cacheKey = `${cfg.meta.swCacheKey}-b${Date.now().toString(36)}`;
  return `// Auto-generated service worker
const CACHE = "${cacheKey}";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // 頁面導覽走網路優先：部署新版後，線上的旅伴重開 App 就拿到新版；離線才退回快取
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});

// 集合鬧鐘：Notification Triggers API 從未正式上線，實務上都走這條 fallback——
// 頁面用 postMessage 把時間丟給 SW，SW 用 setTimeout 排程再 showNotification
let scheduledAlarmTimer = null;
self.addEventListener("message", e => {
  if (e.data.type === "SCHEDULE_ALARM") {
    if (scheduledAlarmTimer) clearTimeout(scheduledAlarmTimer);
    const delay = e.data.timestamp - Date.now();
    if (delay > 0 && delay < 12 * 3600 * 1000) {
      scheduledAlarmTimer = setTimeout(() => {
        self.registration.showNotification("🔔 集合時間到！", {
          body: e.data.message || "現在出發！",
          vibrate: [400, 200, 400, 200, 600],
          requireInteraction: true,
          tag: "meeting-alarm"
        });
      }, delay);
    }
  } else if (e.data.type === "CANCEL_ALARM") {
    if (scheduledAlarmTimer) {
      clearTimeout(scheduledAlarmTimer);
      scheduledAlarmTimer = null;
    }
  }
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // 只挑這個 App 範圍內的分頁，避免誤帶去同網域的其他頁面（首頁／產生器）
      const inScope = list.filter(c => c.url.startsWith(self.registration.scope));
      if (inScope.length) return inScope[0].focus();
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
`;
}

// 預覽模式：'minimal'（一行網址，本機可改不同步）｜'advanced'（部署＋Firebase，協作同步）
let _previewMode = 'minimal';
function selectDeliveryMode(mode) {
  const isBasic = mode === 'basic';
  // toggle mode cards
  document.getElementById('mode-card-basic')?.classList.toggle('active', isBasic);
  document.getElementById('mode-card-advanced')?.classList.toggle('active', !isBasic);
  // show preview card with matching description
  const previewCard = document.getElementById('preview-card');
  const previewDesc = document.getElementById('preview-card-desc');
  if (previewCard) previewCard.style.display = '';
  if (previewDesc) previewDesc.textContent = isBasic
    ? '以下預覽是「一行連結」模式：2 個分頁（行程、清單）。旅伴可看可改，但只存自己手機、不同步。預覽用模擬資料，不連到任何伺服器。'
    : '以下預覽是「進階」模式：4 個分頁（行程、清單、集合、記帳），旅伴可即時同步編輯。預覽用模擬資料、重開歸零，不連到真實 Firebase。';
  // show/hide operation sections
  const sBasic = document.getElementById('section-basic');
  const sAdv   = document.getElementById('section-advanced');
  if (sBasic)  sBasic.style.display  = isBasic ? '' : 'none';
  if (sAdv)    sAdv.style.display    = isBasic ? 'none' : '';
  // set internal preview mode
  _previewMode = isBasic ? 'minimal' : 'advanced';
}

function setPreviewMode(m) {
  _previewMode = (m === 'advanced') ? 'advanced' : 'minimal';
}

function previewApp(mode) {
  const stat = document.getElementById('dl-status');
  if (!state.fields['f-title']) {
    stat.innerHTML = '<div class="status-box status-err">請先在步驟 2 填入旅程名稱</div>';
    return;
  }
  const html = buildPreviewHtml(_previewMode);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const label = _previewMode === 'advanced' ? '進階模擬' : '最低門檻';
  const note = '（' + label + '預覽：模擬資料、單機、重開歸零，不會連到真實 Firebase）';
  if (mode === 'phone') {
    // iPhone 14 Pro 大小，模擬旅伴實際在手機上看到的樣子
    window.open(url, '_blank', 'width=390,height=844');
    stat.innerHTML = '<div class="status-box status-info">已開啟手機大小預覽視窗' + note + '。</div>';
  } else {
    window.open(url, '_blank');
    stat.innerHTML = '<div class="status-box status-info">已在新分頁開啟預覽' + note + '。</div>';
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadZip() {
  const stat = document.getElementById('download-status');
  if (!state.fields['f-title']) {
    stat.innerHTML = '<div class="status-box status-err">請先在步驟 2 填入旅程名稱</div>';
    return;
  }
  if (!window.JSZip) {
    stat.innerHTML = '<div class="status-box status-err">JSZip 未載入，請重新整理頁面</div>';
    return;
  }
  stat.innerHTML = '<div class="status-box status-info"><span class="spinner"></span>&nbsp;打包中…</div>';
  try {
    const { html, cfg } = buildIndexHtml();
    const zip = new JSZip();
    const folderName = (cfg.meta.storagePrefix || 'trip-app');
    const folder = zip.folder(folderName);
    folder.file('index.html', html);
    folder.file('manifest.json', buildManifest(cfg));
    folder.file('sw.js', buildSw(cfg));
    // App icons as PNG — Android/iOS home-screen icons need raster, not SVG.
    const iconSvg     = buildTripIconSvg(cfg);
    const iconMaskSvg = buildTripIconMaskableSvg(cfg);
    folder.file('icon-192.png',          await svgToPngBase64(iconSvg, 192), { base64: true });
    folder.file('icon-512.png',          await svgToPngBase64(iconSvg, 512), { base64: true });
    folder.file('icon-maskable-512.png', await svgToPngBase64(iconMaskSvg, 512), { base64: true });
    folder.file('apple-touch-icon.png',  await svgToPngBase64(iconSvg, 180), { base64: true });
    folder.file('README.txt',
      `${cfg.meta.title}\n` +
      `=================================\n\n` +
      `部署方式：\n` +
      `1. 把整個 ${folderName} 資料夾上傳到 https://netlify.com\n` +
      `   （登入後，到 Projects 頁面，把資料夾拖進最下方的拖放區即可。請拖資料夾，不要拖 .zip）\n` +
      `2. Netlify 會給一個網址，傳給旅伴\n` +
      `3. 旅伴在手機開啟網址 → 加入主畫面就能像 App 使用\n\n` +
      `PIN: ${cfg.meta.pin}\n` +
      `旅程代碼: ${cfg.meta.storagePrefix}\n`
    );
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // 下載檔名用行程名稱（去掉檔名不允許的字元）；內層部署資料夾仍用 storagePrefix。
    const safeTitle = (cfg.meta.title || folderName).replace(/[\/\\:*?"<>|]/g, '').trim() || folderName;
    a.download = safeTitle + '.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    stat.innerHTML = '<div class="status-box status-ok">✓ 下載完成！解壓縮後依下方步驟部署。</div>';
  } catch (e) {
    stat.innerHTML = '<div class="status-box status-err">打包失敗：' + e.message + '</div>';
  }
}

// ── Quick share via URL hash (zero-deploy) ────────────────────────
// Trip config is gzip+base64url encoded into the URL hash. Friends open
// the link → viewer page (legendream.com/v/) decodes and renders.
// No backend, no accounts. Hash never sent to server per HTTP spec.

function shareCfgJson() {
  // 先做步驟二畫面會做的舊格式遷移，免得只是切到步驟二就被判定「行程有修改」
  ensureExtras();
  const cfg = collectConfig();
  // Strip Firebase — quick-share mode is view-only (no multi-person sync).
  // Keeping firebase keys would let viewers write to the trip creator's project.
  cfg.firebase = {};
  cfg._quickShare = true;
  return JSON.stringify(cfg);
}

// 畫面上這條分享連結是用哪一版行程產生的；'' ＝ 還沒產生過
let sharedCfgJson = '';

function shareUrlIsStale() {
  return !!sharedCfgJson && shareCfgJson() !== sharedCfgJson;
}

async function buildShareUrl() {
  if (!state.fields['f-title']) {
    throw new Error('請先在步驟 2 填入旅程名稱');
  }
  const json = shareCfgJson();
  const bytes = new TextEncoder().encode(json);
  const compressed = await gzipBytes(bytes);
  const encoded = bytesToBase64url(compressed);

  // Use site origin (same domain as generator). If running standalone
  // (generator opened from file://), fall back to current origin anyway.
  const base = location.origin + location.pathname.replace(/generator\/?.*$/, '');
  return { url: base + 'v/#z=' + encoded, json };
}

async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateShareUrl({ refreshed = false } = {}) {
  const stat = document.getElementById('share-status');
  const out = document.getElementById('share-url-input');
  stat.innerHTML = '<div class="status-box status-info"><span class="spinner"></span>&nbsp;產生連結中…</div>';
  try {
    const { url, json } = await buildShareUrl();
    out.value = url;
    sharedCfgJson = json;
    const sizeKb = (url.length / 1024).toFixed(1);
    let warn = '';
    if (url.length > 8000) {
      warn = ' <span style="color:var(--warn);">⚠ 連結較長（' + sizeKb + ' KB），LINE 仍可貼但部分 QR 掃描可能困難。</span>';
    }
    const via = '<strong>📱 QR Code</strong>' + (navigator.share ? ' 或 <strong>📤 傳送給旅伴</strong>' : '');
    const lead = refreshed
      ? '🔄 <strong>行程有修改，連結已自動更新成最新版。</strong>之前傳出去的舊連結不會跟著變，請用 ' + via + ' 把新連結重新傳給旅伴。'
      : '✓ 連結已產生。建議直接用 ' + via + ' 分享，不必貼那一長串網址。';
    stat.innerHTML = '<div class="status-box ' + (refreshed ? 'status-warn' : 'status-ok') + '">' + lead +
      '<br><span style="color:var(--ink-2);font-size:var(--fs-fine);">' +
      '連結包含整份行程的所有資料（' + sizeKb + ' KB）所以較長——這是「不經外部伺服器、兼顧隱私安全」的優點。</span>' + warn + '</div>';
  } catch (e) {
    // 產生失敗就收掉舊連結，免得按鈕把舊版傳出去
    out.value = '';
    sharedCfgJson = '';
    stat.innerHTML = '<div class="status-box status-err">' + e.message + '</div>';
  }
}

// 分享按鈕一律拿依目前行程產生的連結；回傳空字串代表產生失敗
async function ensureFreshShareUrl() {
  const input = document.getElementById('share-url-input');
  if (input.value && !shareUrlIsStale()) return input.value;
  await generateShareUrl({ refreshed: !!input.value });
  return input.value;
}

async function copyShareUrl() {
  const input = document.getElementById('share-url-input');
  if (!(await ensureFreshShareUrl())) return;
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('已複製分享連結', '貼到 LINE / 訊息給旅伴即可');
  } catch (e) {
    // Fallback for non-clipboard environments
    input.select();
    document.execCommand('copy');
    showToast('已複製分享連結', '貼到 LINE / 訊息給旅伴即可');
  }
}

async function openShareUrl() {
  const input = document.getElementById('share-url-input');
  if (!(await ensureFreshShareUrl())) return;
  window.open(input.value, '_blank');
}

async function shareNative() {
  const input = document.getElementById('share-url-input');
  if (!(await ensureFreshShareUrl())) return;
  const title = (state.fields['f-title'] || '').trim() || '旅人手帖';
  try {
    await navigator.share({
      title: title,
      text: `來看看「${title}」的行程`,
      url: input.value
    });
  } catch (e) {
    // User cancelled or share failed — no toast needed
    if (e && e.name !== 'AbortError') {
      showToast('分享失敗', '請改用「複製連結」');
    }
  }
}

async function showQrCode() {
  const input = document.getElementById('share-url-input');
  if (!(await ensureFreshShareUrl())) return;
  const url = input.value;
  const modal = document.getElementById('qr-modal');
  const canvas = document.getElementById('qr-canvas');
  const note = document.getElementById('qr-note');
  modal.classList.add('open');
  note.textContent = '產生 QR Code…';
  canvas.style.display = 'none';

  if (typeof qrcode === 'undefined') {
    note.innerHTML = '<span style="color:var(--err);">QR 程式庫載入失敗，請重新整理頁面再試。</span>';
    return;
  }
  try {
    // typeNumber 0 = auto-pick smallest version that fits the data
    // Error correction L for long URLs (more capacity), M otherwise
    const qr = qrcode(0, url.length > 1500 ? 'L' : 'M');
    qr.addData(url);
    qr.make();
    drawQrOnCanvas(qr, canvas, 280);
    canvas.style.display = '';
    note.innerHTML = '用旅伴的手機相機掃描即可開啟。';
  } catch (e) {
    canvas.style.display = 'none';
    note.innerHTML = '<span style="color:var(--err);">連結太長無法產生 QR Code（' +
      (url.length / 1024).toFixed(1) + ' KB）。請改用「複製連結」分享。</span>';
  }
}

function drawQrOnCanvas(qr, canvas, size) {
  const modules = qr.getModuleCount();
  const margin = 2;                                  // quiet zone in cells
  const cellSize = Math.floor(size / (modules + margin * 2));
  const actualSize = cellSize * (modules + margin * 2);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = actualSize * dpr;
  canvas.height = actualSize * dpr;
  canvas.style.width = actualSize + 'px';
  canvas.style.height = actualSize + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#faf6ec';
  ctx.fillRect(0, 0, actualSize, actualSize);
  ctx.fillStyle = '#1c1815';
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
      }
    }
  }
}

function closeQrModal() {
  document.getElementById('qr-modal')?.classList.remove('open');
}

// ── Misc ──────────────────────────────────────────────────────────
function openLoadDialog() {
  closeMenu();
  if (confirm('清空目前所有資料，重新開始？\n（已下載的 .zip 不受影響）')) {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem('trip-gen-storage-toast-shown');
    location.reload();
  }
}

// ── Menu (⋯) ──────────────────────────────────────────────────────
function toggleMenu(e) {
  e?.stopPropagation();
  const pop = document.getElementById('menu-pop');
  pop.classList.toggle('open');
}
function closeMenu() {
  document.getElementById('menu-pop')?.classList.remove('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.menu-wrap')) closeMenu();
  if (!e.target.closest('.map-info-wrap')) closeMapInfo();
});

// ⓘ 就地展開地點說明（點擊觸發，桌機＋手機皆有效；取代原本只能 hover 的 title）
function toggleMapInfo(e, btn) {
  e.stopPropagation();
  const wrap = btn.closest('.map-info-wrap');
  const willOpen = !wrap.classList.contains('open');
  closeMapInfo();
  wrap.classList.toggle('open', willOpen);
  btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
function closeMapInfo() {
  document.querySelectorAll('.map-info-wrap.open').forEach(w => {
    w.classList.remove('open');
    w.querySelector('.map-info')?.setAttribute('aria-expanded', 'false');
  });
}

// ── Toast ─────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(title, body, ms = 4500) {
  const el = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent = body || '';
  // Reset any previous action-toast state
  const actions = document.getElementById('toast-actions');
  if (actions) { actions.style.display = 'none'; actions.innerHTML = ''; }
  el.classList.remove('toast-action');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Resume-editing toast: shown once per page-load when localStorage already
// has meaningful trip data. Lets the user continue or wipe & start fresh.
function showResumeToast(title) {
  const el = document.getElementById('toast');
  document.getElementById('toast-title').textContent = `繼續編輯「${title}」？`;
  document.getElementById('toast-body').textContent = '上次的進度還留在這個瀏覽器（換裝置、換瀏覽器看不到）。可以接著改，或從新的開始。';
  const actions = document.getElementById('toast-actions');
  actions.style.display = 'flex';
  actions.innerHTML =
    '<button class="toast-action-btn" onclick="resumeToastReset()">從新的開始</button>' +
    '<button class="toast-action-btn primary" onclick="dismissResumeToast()">繼續編輯</button>';
  el.classList.add('show', 'toast-action');
  clearTimeout(toastTimer);    // sticky: no auto-dismiss
}
function dismissResumeToast() {
  const el = document.getElementById('toast');
  el.classList.remove('show', 'toast-action');
  const actions = document.getElementById('toast-actions');
  actions.style.display = 'none';
  actions.innerHTML = '';
}
function resumeToastReset() {
  if (!confirm('清空所有資料，從空白開始？\n（已下載的 .zip 不受影響）')) return;
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem('trip-gen-storage-toast-shown');
  location.reload();
}

// ── Storage info dialog ───────────────────────────────────────────
function showStorageInfo() {
  closeMenu();
  alert(
    '關於自動儲存：\n\n' +
    '✓ 你填的所有欄位（含 Firebase Config）都會自動存到「這個瀏覽器」的進度備份。\n\n' +
    '⚠️ 注意限制：\n' +
    '・換裝置、換瀏覽器看不到（同一台電腦的 Chrome 和 Safari 也是分開的）\n' +
    '・無痕模式關掉視窗就消失\n' +
    '・清除瀏覽器資料時會一起被清掉\n\n' +
    '💡 想換裝置繼續？\n' +
    '用「⋯ → 匯出進度」下載一份 JSON，到新裝置點「匯入進度」即可。'
  );
}

// ── Export / Import progress ──────────────────────────────────────
function exportProgress() {
  closeMenu();
  if (typeof onAnyInput === 'function') onAnyInput();
  const data = {
    __type: 'trip-gen-progress',
    __version: 2,
    __exportedAt: new Date().toISOString(),
    state: state,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = (state.fields['f-storage-prefix'] || 'trip-gen') + '-progress-' + stamp + '.json';
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已匯出進度', '檔案：' + name);
}

function triggerImportProgress() {
  closeMenu();
  document.getElementById('import-progress-input').click();
}

function importProgress(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.__type !== 'trip-gen-progress' || !data.state) {
        throw new Error('檔案格式不正確');
      }
      if (!confirm('將覆蓋目前所有資料，確定？')) return;
      localStorage.setItem(STATE_KEY, JSON.stringify(data.state));
      showToast('已匯入進度', '正在重新整理…', 1500);
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      alert('匯入失敗：' + err.message + '\n\n請確認你選的是「⋯ → 匯出進度」下載的 JSON 檔。');
    }
  };
  reader.readAsText(file);
}

// ── First-save hint toast ─────────────────────────────────────────
const TOAST_SHOWN_KEY = 'trip-gen-storage-toast-shown';
function maybeShowFirstSaveToast() {
  if (localStorage.getItem(TOAST_SHOWN_KEY)) return;
  localStorage.setItem(TOAST_SHOWN_KEY, '1');
  showToast(
    '💾 進度已自動儲存到此瀏覽器',
    '換裝置或無痕模式不會同步。需要時用「⋯ → 匯出進度」搬家。',
    6500
  );
}

// ── Init ──────────────────────────────────────────────────────────
function hasMeaningfulState() {
  const title = (state.fields['f-title'] || '').trim();
  if (title) return true;
  if (state.days && state.days.length > 0) {
    // Treat a single empty day from initEmpty() as not meaningful
    if (state.days.length === 1) {
      const d = state.days[0];
      const hasContent = (d.theme || '').trim() || (d.date || '').trim() ||
        (d.items && d.items.length > 0);
      if (!hasContent) return false;
    }
    return true;
  }
  if (state.members && state.members.length > 0) return true;
  return false;
}

function init() {
  const hadState = loadState();
  hydrateUI();
  refreshMastheadTitle();
  updateSunPosition();
  document.querySelectorAll('.field input, .field textarea').forEach(el => {
    if (!el.getAttribute('oninput')) el.addEventListener('input', onAnyInput);
  });
  setIndicator('', '就緒');
  // Reveal the native share button only on devices that support Web Share API
  // (typically iOS Safari / Android Chrome). Desktop browsers fall back to the
  // copy / open-link buttons.
  if (typeof navigator.share === 'function') {
    const nb = document.getElementById('share-native-btn');
    if (nb) nb.style.display = '';
  }
  // If the user re-opens the generator in the same browser and finds prior
  // work still in localStorage, surface a resume prompt so they can either
  // continue or wipe and start fresh. Note: localStorage is per-browser, so
  // this does NOT carry over to other devices — cross-device transfer still
  // requires the manual ⋯ → 匯出/匯入進度 flow.
  if (hadState && state.step === 0 && hasMeaningfulState()) {
    const title = (state.fields['f-title'] || '').trim() || '未命名旅程';
    setTimeout(() => showResumeToast(title), 450);
  }
}

document.addEventListener('DOMContentLoaded', init);
