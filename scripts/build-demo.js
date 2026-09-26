#!/usr/bin/env node
'use strict';
/**
 * build-demo.js
 * 從 generator/generator-template.js（base64 encoded template）+
 * trip-app-v2/index.html 現有示範資料，重新產出 trip-app-v2/index.html。
 *
 * 這樣 trip-app-v2 就是 template 的衍生物，不會再有手動維護不同步的問題。
 *
 * Run: node scripts/build-demo.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const TMPL_FILE   = path.join(ROOT, 'generator', 'generator-template.js');
const DEMO_FILE   = path.join(ROOT, 'trip-app-v2', 'index.html');
const CONFIG_FILE = path.join(__dirname, 'demo-config.json');

// ── 1. Decode template ────────────────────────────────────────────
const tmplSrc = fs.readFileSync(TMPL_FILE, 'utf8');
const b64Match = tmplSrc.match(/window\.TRIP_TMPL_B64\s*=\s*'([A-Za-z0-9+/=]+)'/);
if (!b64Match) throw new Error('Cannot find window.TRIP_TMPL_B64 in generator-template.js');
const tmpl = Buffer.from(b64Match[1], 'base64').toString('utf8');

// ── 2. Load demo data from demo-config.json ───────────────────────
// demo-config.json is the single source of truth for demo trip data.
// To update demo data, edit demo-config.json and re-run this script.
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('ERROR: scripts/demo-config.json not found.');
  console.error('Create it with the trip data before running this script.');
  process.exit(1);
}
const demoCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const { members: MEMBERS, days: DAYS, hotels: HOTELS,
        restaurants: RESTAURANTS, weatherLocs: WEATHER_LOCS,
        checklist: CHECKLIST, presetShopping: PRESET_SHOPPING,
        notes: NOTES } = demoCfg;

console.log('Demo data loaded from demo-config.json:');
console.log('  DAYS:', DAYS.length);
console.log('  HOTELS:', HOTELS.length);
console.log('  NOTES:', NOTES.length);
console.log('  CHECKLIST:', CHECKLIST.length);
console.log('  PRESET_SHOPPING:', PRESET_SHOPPING.length);
console.log('  MEMBERS:', MEMBERS.length);
console.log('  RESTAURANTS:', Object.keys(RESTAURANTS).length, 'days');
console.log('  WEATHER_LOCS:', Object.keys(WEATHER_LOCS).length, 'locs');

// ── 3. Build cfg (matches collectConfig() output format) ──────────
const DATE_PILL = '2026年4月15－22日';
// 年份跟產生器 collectConfig() 同規則：從日期標籤抓四位數。template 靠 meta.year 把 "4/15"
// 組成完整日期（天氣請求、已過的日卡），缺了天氣會整片 400——抓不到就直接停止建置。
const yearMatch = DATE_PILL.match(/\d{4}/);
if (!yearMatch) {
  console.error('ERROR: datePill 裡找不到四位數年份：' + DATE_PILL);
  console.error('示範頁需要 meta.year，請在日期標籤寫上年份（例如 2026年4月15－22日）。');
  process.exit(1);
}

const cfg = {
  meta: {
    title:         '東北賞櫻之旅 2026',
    shortTitle:    '東北賞櫻',
    heading:       '🌸 東北賞櫻之旅',
    subtitle:      '仙台・平泉・青森・弘前・松島',
    datePill:      DATE_PILL,
    year:          parseInt(yearMatch[0], 10),
    durationPill:  '8天7夜',
    peoplePill:    '6人同行',
    themeColor:    '#c94b72',
    themeAccent:   '#e06a8a',
    themeLight:    '#f5a3ba',
    bgColor:       '#fff5f8',
    bgPale:        '#ffeef3',
    pin:           '0000',
    storagePrefix: 'tohoku2026',
    swCacheKey:    'tohoku2026-v1',
  },
  // 假設定：讓 template 走進階模式（4 個分頁可操作），實際連線由下面注入的
  // 記憶體模擬後端接手，不會連到任何真實 Firebase。
  firebase:       { apiKey: 'AIza-demo-mock', databaseURL: 'https://demo-mock.firebaseio.com' },
  members:        MEMBERS,
  days:           DAYS,
  hotels:         HOTELS,
  restaurants:    RESTAURANTS,
  weatherLocs:    WEATHER_LOCS,
  checklist:      CHECKLIST,
  presetShopping: PRESET_SHOPPING,
  removedPresets: [],
  notes:          NOTES,
};

// ── 4. Apply template tokens ──────────────────────────────────────
const m = cfg.meta;
let html = tmpl
  .replace(/__TRIP_TITLE__/g,     m.title)
  .replace(/__SHORT_TITLE__/g,    m.shortTitle)
  .replace(/__THEME_COLOR__/g,    m.themeColor)
  .replace(/__THEME_ACCENT__/g,   m.themeAccent)
  .replace(/__THEME_LIGHT__/g,    m.themeLight)
  .replace(/__BG_COLOR__/g,       m.bgColor)
  .replace(/__BG_PALE__/g,        m.bgPale)
  .replace(/__TRIP_HEADING__/g,   m.heading)
  .replace(/__TRIP_SUBTITLE__/g,  m.subtitle)
  .replace(/__DATE_PILL__/g,      m.datePill)
  .replace(/__DURATION_PILL__/g,  m.durationPill)
  .replace(/__PEOPLE_PILL__/g,    m.peoplePill)
  .replace(/__TRIP_PIN__/g,       m.pin)
  .split('__TRIP_CONFIG__').join(JSON.stringify(cfg));

// 示範頁沒有走產生器的下載流程，資料夾裡沒有 icon-192.png／apple-touch-icon.png
// （那兩個檔案只在使用者下載 App 的 zip 裡才會產生），template 原本的引用在這裡會
// 404。示範頁不是要給人裝到手機主畫面的正式 App，改用跟 manifest.json 同一顆
// emoji SVG 圖示就好，不必為了示範頁另外導入 Node 端的 SVG→PNG 轉檔。
const DEMO_ICON_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%23c94b72'/%3E%3Ctext y='130' x='96' text-anchor='middle' font-size='110'%3E🌸%3C/text%3E%3C/svg%3E";
html = html
  .replace('href="apple-touch-icon.png"', `href="${DEMO_ICON_SVG}"`)
  .replace('type="image/png" sizes="192x192" href="icon-192.png"', `type="image/svg+xml" href="${DEMO_ICON_SVG}"`);

// 示範頁原本 firebase 留空，集合／記帳分頁會把「Firebase 設定教學」（JSON 規則、
// FIREBASE_CONFIG 程式碼）秀給訪客看。改成跟產生器「進階預覽」同一套記憶體模擬
// 後端：訪客可以真的設集合時間、記帳，重新整理就歸零。模擬後端直接從
// generator-app.js 的 PREVIEW_MOCK_FB 讀出來共用，避免兩份各自維護。
const genAppSrc = fs.readFileSync(path.join(ROOT, 'generator', 'generator-app.js'), 'utf8');
const mockMatch = genAppSrc.match(/const PREVIEW_MOCK_FB = `([\s\S]*?)`;/);
if (!mockMatch) throw new Error('Cannot find PREVIEW_MOCK_FB in generator/generator-app.js');
const FB_CDN_RE = /  <script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\n/g;
const MOCK_ANCHOR = '<script>\n// ─── Trip Config';
if (!FB_CDN_RE.test(html) || !html.includes(MOCK_ANCHOR)) {
  throw new Error('Template 結構變了：找不到 Firebase CDN 標籤或 Trip Config 區塊，無法注入模擬後端');
}
html = html
  .replace(FB_CDN_RE, '')
  .replace(MOCK_ANCHOR, () => mockMatch[1] + MOCK_ANCHOR); // 用函式避免 $ 被當成替換樣式

// ── 5. Write output ───────────────────────────────────────────────
fs.writeFileSync(DEMO_FILE, html, 'utf8');
console.log('\n✓ trip-app-v2/index.html rebuilt from template.');
console.log('  Size:', (html.length / 1024).toFixed(0), 'KB');
