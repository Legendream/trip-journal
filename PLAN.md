# 旅人手帖 — 專案說明 & 交接文件

> 最後更新：2026-06-10

---

## 專案概述

**旅人手帖**是一個**旅遊 App 生成器平台**，讓任何人不需寫程式，就能把 AI 整理好的行程資料打包成一個可分享的 PWA App。

平台由四個部分組成：

| 部分 | 路徑 | 說明 |
|---|---|---|
| 封面頁 | `/index.html` | 雜誌風入口，介紹功能、連到生成器與示範 |
| 生成器 | `/generator/` | 5 步驟表單，產出個人旅遊 App |
| **檢視器** | `/v/` | 零部署分享 — 從 URL hash 解碼後渲染行程（見下方） |
| 示範行程 | `/trip-app-v2/` | 東北賞櫻之旅示範 App（不得修改，供展示用） |

### 兩種分享路線

1. **快速分享連結（推薦給多數使用者）**：在 generator 步驟 5 按「產生分享連結」→ 行程資料 gzip+base64url 壓進 URL hash → 貼 LINE 給旅伴 → 旅伴點開 `/v/#z=...` → 檢視器解碼渲染。零帳號、零部署、不經伺服器（hash 不送到 server）。
2. **下載 + Netlify 部署（進階）**：需要 Firebase 多人即時同步、PWA 加入主畫面、自訂網域的使用者走這條。

**部署**：Netlify，publish 目錄為根目錄（`/`）。

### App 各功能同步範圍

| 功能 | 陽春版（分享連結） | 進階版（Netlify + Firebase） |
|------|:-----------------:|:---------------------------:|
| 🗺️ 行程（活動/機票/住宿編輯） | 本機 | **Firebase 同步** ✓ |
| 📋 注意事項（新增/編輯/刪除） | 本機 | **Firebase 同步** ✓ |
| 📍 集合地點 / 時間 | 不顯示 | **Firebase 同步** ✓ |
| 💰 記帳（支出分帳） | 不顯示 | **Firebase 同步** ✓ |
| 🧳 行前清單（勾選 + 自訂項目） | 本機 | 本機 |
| 🛍️ 購物清單（勾選 + 新增項目） | 本機 | 本機 |

> **注意**：行前清單與購物清單無論哪種模式都只存在使用者自己的裝置，不跨裝置同步。

---

## 檔案結構

```
trip-app/
├── index.html                  ← 封面 / 入口頁（雜誌風設計）
├── manifest.json               ← 封面頁 PWA manifest（目前未使用）
├── sw.js                       ← 封面頁 Service Worker（目前未使用）
├── netlify.toml                ← Netlify 部署設定
├── PLAN.md                     ← 本文件
├── product-positioning.md      ← 產品定位與商業模式文件
│
├── generator/
│   ├── index.html              ← 生成器 UI（5 步驟表單 + 主題預覽 + 分享連結 + QR）
│   ├── generator-app.js        ← 生成器主邏輯（state machine、渲染、匯出、分享連結）
│   └── generator-template.js  ← 生成 App 的 HTML template（base64 編碼）
│
├── v/
│   └── index.html              ← 分享連結檢視器（解碼 hash → 渲染 trip app）
│
└── trip-app-v2/
    ├── index.html              ← 東北賞櫻之旅示範 App（請勿修改）
    ├── manifest.json
    └── sw.js
```

---

## 封面頁（`/index.html`）

- **設計語言**：Editorial 雜誌風，Noto Serif TC，暖紙色（`--paper: #f6f0e3`）、赭紅主色（`--accent: #a8362f`）
- **Masthead（頂部 banner）**：`position: sticky; top: 0; z-index: 30`，48px 羅盤 logo + 「旅人手帖」30px 字
- **尺寸與 generator 完全一致**：`padding: 22px 56px 18px`，`max-width: 1080px`，避免頁面切換時視線偏移
- **連結**：CTA 按鈕 → `generator/`；示範連結 → `trip-app-v2/`

---

## 生成器（`/generator/`）

### 步驟流程

| 步驟 | 名稱 | 功能 |
|---|---|---|
| 0 | 貼上行程 | 貼入純文字或 JSON，或選擇手動建立 |
| 1 | 補齊資料 | 編輯天數、活動、住宿；每個活動有名稱、副標、時間、地圖、訂位號碼 |
| 2 | 多人共用 | 設定 PIN、storagePrefix、Firebase（選填） |
| 3 | 挑選外觀 | 7 個和の色主題，即時預覽套用 |
| 4 | 下載 App | 預覽新分頁、下載 ZIP |

### 重要架構（`generator-app.js`）

**State machine**：所有資料存在 `state` 物件，自動 debounce 存 localStorage（`STATE_KEY = 'trip-gen-state-v2'`）

**主題系統**（`THEMES[]`，7 色）：
- 朱泥赭 `#a8362f`（預設）、抹茶綠、淺蔥青、櫻花混、紺青藍、藤花紫、山吹黃
- `selectTheme(i)` → 更新 `state.fields['f-theme-color']` 等 5 個欄位 → 呼叫 `applyTheme()`
- `applyTheme()` 從 **`state.fields`** 直接讀色值（不從 DOM input 讀，避免首次進入步驟四時顏色不同步）
- 初始值、載入行程的 fallback 值均對齊 THEMES[0]（`#a8362f`）

**活動資料結構**（⚠️ 2026-06-01 已重構為統一 timeline 模型，見文末「統一時間軸模型重構」章節）：
```js
// 內部模型：一天 = { id, day, date, wd, theme, emoji, parking, items: [TimelineItem] }
// TimelineItem = { id, type:'activity'|'flight'|'lodging', time, icon, title, sub,
//                  ref, location:{query,url,verified}, data:{…型別專屬} }
// 匯出時由 toLegacyDay() 拆回舊的 acts/flight/hotel 格式，template 不用改。
```
- 舊的 `{ icon, name, sub, time, map, ref }` 仍是匯出格式（template 吃這個）
- UI：每個活動有兩列輔助資料：📍 地點 / 📋 訂位號碼（選填）

**匯出**：`buildIndexHtml()` → `collectConfig()` 讀 `state.fields` + `state.days` → 替換 template 佔位符 → Blob URL / ZIP

### 步驟四預覽（`#tp-*` 元素）

預覽欄顯示使用者自己的資料，不含示範文字：
- `#tp-title`、`#tp-sub`、`#tp-date`、`#tp-dur`、`#tp-ppl` 初始為空或預設值
- `renderThemeStep()` 在進入步驟四時填入 `state.fields` 的值
- `.tp-pill:empty`、`.tp-sub:empty` → `display: none`（CSS 自動隱藏空 pill）

---

## Template（`generator-template.js`）

**用途**：base64 編碼的完整旅遊 App HTML，由生成器解碼後替換佔位符，產出使用者的旅遊 App。

**佔位符**（由 `buildIndexHtml()` 替換）：

| 佔位符 | 內容 |
|---|---|
| `__THEME_COLOR__` | 主題色（`--pink` CSS variable） |
| `__THEME_ACCENT__` | 強調色 |
| `__THEME_LIGHT__` | 淺色 |
| `__BG_COLOR__` | 背景色 |
| `__BG_PALE__` | 更淺背景色 |
| `__TRIP_TITLE__` | 旅程名稱 |
| `__SHORT_TITLE__` | 短名稱（6字） |
| `__TRIP_PIN__` | PIN 碼 |
| `__TRIP_CONFIG__` | 完整 JSON config（含 days、hotels、members 等） |

**已修正的 template 問題（2026-05-16）**：

1. **`.header` gradient 改用 CSS variable**：原為硬編碼 `#c94b72`，換主題完全無效。現改為 `linear-gradient(145deg, var(--pink) 0%, var(--pink-2) 55%, var(--pink-3) 100%)`
2. **活動卡片新增 ref 渲染**：加入 `.act-ref { font-size:11px; color:var(--text-3) }` 與 `${a.ref ? '<div class="act-ref">📋 ${a.ref}</div>' : ""}` 渲染邏輯
3. **購物清單與示範資料隔離**：原 `const PRESET_SHOPPING = [萩之月、ずんだ餅…]` 為東北賞櫻之旅的硬編碼資料。現改為 `const PRESET_SHOPPING = _CFG_PRESET_SHOPPING || []`，讀取用戶自己 config 中的 `presetShopping`

**修改 template 的方式**（2026-07-03 起，取代舊的一次性 patch 腳本流程）：

1. 直接編輯 `generator/template-src.html`（source of truth，完整可讀 HTML）
2. `node scripts/build-template.js` — 驗證佔位符齊全、inline script 語法、base64 roundtrip 後寫回 `generator-template.js`
3. 兩個檔案**一起 commit**（`--check` 模式可驗證兩邊是否 drift）

> 舊的 `scripts/patch-*.js` 一次性腳本已封存至 `scripts/archive/`（含各批修改的歷史說明），不要再執行。
> 文件後段各批次記錄裡提到的「base64 patch／re-encode 流程」皆為當時的歷史做法。

---

## 示範行程（`/trip-app-v2/`）

- **東北賞櫻之旅 2026**（8天7夜，6人）
- 這是功能完整的進階版 App，有天氣、費用分帳、集合通知、購物清單等
- **請勿修改**：作為對外示範用途，與 generator 完全獨立
- generator-template.js 中的 template 是較簡版的 App，**不是從 trip-app-v2 衍生的**

---

## 主題設計系統

封面、生成器、生成的 App 共用一套設計語言：

```css
--paper:    #f6f0e3;   /* 暖紙色底 */
--ink:      #1a1208;   /* 主文字 */
--accent:   #a8362f;   /* 朱泥赭（generator 預設主題） */
--font:     'Noto Serif TC', serif;
```

Masthead（兩頁共用，尺寸完全一致）：
- `padding: 22px 56px 18px`
- 羅盤 48px，標題 30px Noto Serif TC
- `position: sticky; top: 0; z-index: 30`
- Stepper（生成器）：`position: sticky; top: 111px; z-index: 20`（貼齊 masthead 下方）

---

## 檢視器（`/v/`）— 快速分享連結

### 運作原理

1. **產生**（generator 步驟 5「產生分享連結」按鈕）：
   - `collectConfig()` 拿到完整 cfg（行程、住宿、成員、主題色…）
   - 強制 `cfg.firebase = {}`（檢視模式不啟用即時同步，避免旅伴寫到你的 Firebase）
   - JSON.stringify → UTF-8 bytes → `CompressionStream('gzip')` 壓縮 → base64url 編碼
   - 組成 `${origin}/v/#z=${encoded}`

2. **檢視**（旅伴打開 URL）：
   - `/v/index.html` 載入 `../generator/generator-template.js` 取得 `TRIP_TMPL_B64`
   - 讀 `location.hash`，base64url 解碼 → `DecompressionStream('gzip')` 解壓 → JSON.parse
   - 用 `buildHtml(cfg)` 套用佔位符（同 generator 的 `buildIndexHtml` 邏輯）
   - **關鍵：DOM 替換而非 `document.write`**
     - `document.write` 之後 inline scripts 不會執行
     - 改用 `DOMParser` 解析 → `document.body.innerHTML = ...` → 逐一替換每個 `<script>`（DOMParser 產生的 script tags 是惰性的，必須 `createElement('script')` 重新插入才會跑）
     - external scripts 用 `await onload`，inline scripts 同步執行
   - **SW 剝離**：把 `navigator.serviceWorker.register` 整個字串替換成 `({register:()=>Promise.resolve()}).register`，這樣不會註冊 SW（避免 viewer URL 被永久 cache），但保留所有平衡的括號/箭頭函式不會壞掉。Manifest link 用 regex 移除。

### QR Code

- 用 `qrcode-generator@1.4.4`（CDN 載入，~6KB）— 提供全域 `qrcode()` 函式
- ❌ 別用 `qrcode@1.5.3`（soldair/node-qrcode）— browser build 不暴露全域，會 fail
- 自己畫在 canvas 上，調整 devicePixelRatio 確保銳利

### 容量

- 8 天 6 人約 5KB JSON → gzip 後 ~2KB → base64url ~2.7KB → URL ~3000 字
- LINE / WhatsApp / 簡訊都吃得下
- QR Code 自動選 EC level（>1500 字用 L，否則 M）
- 真的太長時 QR 會 throw，UI 會切回「請改用複製連結」

### 為什麼符合「不存使用者資料」原則

- Hash 在 URL `#` 之後，**HTTP spec 規定永不送到伺服器**
- 你的 server logs / Netlify analytics 完全看不到 trip 資料
- 旅伴的瀏覽器自己解碼、自己渲染，你也不會被計費

---

## 待處理 / 已知問題

- [ ] **生成的 App 主題色**：`trip-app-v2/index.html`（示範 App）的 `.header` gradient 仍為硬編碼粉紅，因為示範 App 不走 template 替換流程，所以不影響生成器功能，但若要改示範 App 顏色需手動修改
- [ ] **generator-template.js 重建流程**：目前沒有自動化腳本，若要從原始 HTML 重新生成 template 需手動替換佔位符後 base64 encode
- [ ] **`generator/index.html` 中的 AI 解析功能**（步驟一「貼上行程」→「AI 整理」）：對話記錄顯示這功能已存在，但尚未驗證端到端是否正常
- [ ] **（B）步驟四「兩方案對照卡」UI**（2026-06-26 與使用者確認，排在兩種模式行為地基之後做）：把步驟四開頭改成可點選的兩欄圖文對照——「最低門檻（一行網址／可改但只存本機／不同步／資料不經伺服器）」vs「進階（Netlify+Firebase／旅伴一起改即時同步：行程·注意事項·集合·記帳／本機：購物·打包）」，選了再展開對應的「產生分享連結」或「Firebase 設定＋下載部署」。同時修正現有衝突文案：分享連結卡 [generator/index.html:1846](generator/index.html) 寫的「純檢視，不會被改動」要改成「可改但不同步」；進階區同步清單 [generator/index.html:1884](generator/index.html) 漏了「注意事項」要補。依賴：最低門檻的本機編輯行為（地基第 1–2 批）要先做完，文案才能誠實。詳見記憶 project_trip_app_two_mode_spec。

---

## UX 改善計畫（2026-05-17）

> 依據 ui-ux-pro-max 檢視結果整理。P0 = 使用者會卡住，P1 = 明顯困惑，P2 = 細節打磨。

### P0 — 高優先：影響「使用者完成任務」的問題

#### ✅ 1. 步驟一支援貼入分享連結（PR #4）+ 統一還原區（2026-05-18）

**問題**：「修改舊 App」路徑只接受 `.html` 檔案上傳。但使用快速分享連結（`/v/#z=...`）的使用者，根本沒有 `.html` 檔，所以行程出了問題就無從修改。

**解法（PR #4）**：在 Step 0 新增「貼入分享連結」子卡片，解碼 hash → 取出 config JSON → 填回 `state.days` / `state.fields` → 跳到 Step 1。

**進一步改善（2026-05-18）**：將 URL 貼入與 .html 拖放合併為單一「修改既有行程」還原區（`.restore-zone`），自動辨識輸入格式。新增 localStorage resume toast：使用者重訪時若本機有未完成的草稿，即提示「是否繼續上次進度」（明確說明僅限同裝置同瀏覽器）。

**實作位置**：`generator/index.html`（`.restore-zone` UI、`#toast-actions`）、`generator/generator-app.js`（`loadFromRestoreInput`、`showResumeToast`、`hasMeaningfulState`）

---

#### ✅ 2. 封面頁「封面號 No.01」改為有意義 tagline（PR #4）

**問題**：封面右上角有「封面號 No.01」，使用者不知道這是什麼，誤以為是功能說明。

**解法**：改為「Free · Open Source / 零部署 · 即刻分享」。

**實作位置**：`index.html` masthead-right 區塊

---

### P1 — 中優先：影響「使用者信心與理解」的問題

#### ✅ 3. Firebase 移入進階區塊，主流程縮為 4 步（PR #5）

**問題**：95% 的使用者不需要 Firebase。Firebase 設定放在主流程 Step 3，等於讓多數使用者看到一個「不知道要不要填」的步驟，心生卻步。

**解法**：主流程從 5 步縮為 4 步（移掉 Firebase step），Firebase 設定移至 Step 2（補齊資料）的「進階設定 ▼」摺疊區塊。

**實作位置**：`generator/index.html`、`generator/generator-app.js`（`STEPS`、`STEPS_META`、`goTo`、`setFirebaseMode`、`onFirebaseInput`）

---

#### ✅ 4. Stepper 選填標示（隨 P1-3 自動解決）

**問題**：5 個步驟看起來都是必填，但 Firebase 實際上是選填。

**解法**：隨 P1-3 移除 Firebase 主流程步驟後，Stepper 4 步全部為必填，問題自然解決。

---

#### ✅ 5. AI 整理子步驟進度顯示（2026-05-18）

**問題**：Step 0「用 AI 整理」三步驟的圓點過小（13px 純色），使用者難以一眼看出目前進度。

**解法**：將圓點放大為 26px badge，預設顯示步驟號（1/2/3），active 變朱泥赭、done 變綠色 ✓。同時補上 `importAiJson()` 成功後將 step 3 標為 done。

**實作位置**：`generator/index.html`（`.ai-step::before` CSS、`data-step` 屬性）、`generator/generator-app.js`（`importAiJson` 完成時加 `done` class）

---

### P2 — 低優先：細節打磨

#### ✅ 6. 用語統一：「暫存」→「進度備份」（2026-05-18）

**問題**：「暫存」對非技術使用者不夠直觀。

**解法**：替換 ⋯ 選單中的「暫存進度 / 關於暫存 / 暫存儲存在哪？」與 `showStorageInfo()` 對話框中的「『這個瀏覽器』的暫存區」為「進度備份」。

**實作位置**：`generator/index.html`（⋯ 選單 section 標題、按鈕文字）、`generator/generator-app.js`（`showStorageInfo` 對話框）

---

#### ✅ 7. 分享按鈕加入 Web Share API + 桌機「↗ 開啟連結」（2026-05-18）

**問題（行動裝置）**：點「複製連結」後要手動切換到 LINE 貼上，多一道摩擦。
**問題（桌機）**：複製後得自己開新分頁貼上預覽連結。

**解法**：
- 行動裝置（偵測 `navigator.share`）：顯示「📤 傳送給旅伴」按鈕，呼叫系統分享選單（LINE / 訊息 / AirDrop 任選）
- 桌機：新增「↗ 開啟連結」按鈕，`window.open(url, '_blank')` 直接在新分頁開啟
- 既有「📋 複製連結」與「📱 QR Code」維持不變

**實作位置**：`generator/index.html`（`#share-actions` 三顆按鈕）、`generator/generator-app.js`（`shareNative`、`openShareUrl`，`init` 中偵測 `navigator.share` 切換按鈕顯示）

---

### Template & viewer 改善（2026-05-18）

#### ✅ A. 生成的 App 倒數狀態固定顯示「已結束」

**問題**：`updateCountdown()` 內 `start`/`end` 硬編碼為 `new Date(2026, 3, 15)` / `new Date(2026, 3, 22)`（東北賞櫻原始日期），所以任何今日大於 2026-04-22 的使用者，無論行程實際日期為何（含未填寫），右上角恆顯示「已結束 / 回味中 🫶」。

**解法**：改從 `_CFG.days[0].date` + `_CFG.days[末].date` 搭配 `_CFG.meta.year` 解析。無法解析（如使用者尚未填日期）時整個徽章 `display:none`，不顯示誤導文字。

**實作位置**：`generator/generator-template.js`（base64 解碼後改 `updateCountdown` → 重 encode）

---

#### ✅ B. 未設定 Firebase 時 集合 / 留言 / 記帳 tab 顯示設定亂碼

**問題**：URL 分享模式下使用者不會設定 Firebase，但生成的 App 仍會在這三個 tab 上呈現 Firebase 設定指引（含 JSON config 程式碼區塊、`databaseURL`、`firebaseConfig` 等技術字串），對基礎使用者像亂碼。

**解法**：在 template 中新增 `FB_ENABLED` 常數（測試 `FIREBASE_CONFIG.apiKey` 是否真實存在），於 init 時呼叫 `applyFirebaseAvailability()`，若未啟用則把 `nav-meeting` / `nav-messages` / `nav-expenses` 三個 nav 按鈕與對應 tab panels 整個 `display:none`，並跳過初始 render。下載 + 部署模式且有設 Firebase 的進階使用者仍會看到完整功能。

**實作位置**：`generator/generator-template.js`

---

#### ✅ C. 生成的 App 標題列改用品牌 SVG 圖標

**問題**：trip-app header 標題前方是 emoji（`✈️`），與封面頁、favicon 的品牌羅盤＋山形設計脫節。

**解法**：template 中以 inline SVG（羅盤＋山形 mark，`22×28px`）取代 `__TRIP_HEADING__` 佔位符，另新增 `__TRIP_TITLE__` span，`.trip-title` 改為 flex layout。

**實作位置**：`generator/generator-template.js`（base64 patch）

---

#### ✅ D. 動態 favicon 改為品牌風格

**問題**：`/v/` 分享連結的動態 favicon（per-trip SVG）仍使用舊設計。

**解法**：`v/index.html` 的 `generateIconSvg()` 完整重寫：主題色背景、品牌羅盤＋山形圖標置中（scale 1.9）、行程名稱置中、年份字樣。

**實作位置**：`v/index.html`（`generateIconSvg` 函式）

---

#### ✅ E. v/icon.svg 同步至新品牌設計

**問題**：`v/icon.svg` 是舊版紅底文字設計，與根目錄新品牌 `icon.svg`（羅盤圖形）不一致。

**解法**：以根目錄 `/icon.svg`（羅盤風格 SVG）覆寫 `v/icon.svg`。

**實作位置**：`v/icon.svg`

---

#### ✅ F. 伴手禮 / 行前清單 / 注意事項 編輯面板

**問題**：`state.parsedExtras`（`presetShopping`、`checklist`、`notes`）由 AI 解析或 HTML 匯入時已存在，但 generator UI 沒有編輯入口，使用者無法在步驟一補充或修改。

**解法**：Step 1（補齊資料）新增三張卡片：
- 伴手禮/購物清單（`presetShopping`）：品項名 + 門市 + 價格欄，可新增/刪除
- 行前清單（`checklist`）：逐項勾選項目（`{ icon, text }`），可新增/刪除
- 注意事項（`notes`）：預設 ⚠️ 圖標 + 文字，不開放 emoji 自選

**實作位置**：`generator/index.html`（三張卡片 HTML）、`generator/generator-app.js`（`renderExtras`、`renderShoppingEditor`、`renderChecklistEditor`、`renderNotesEditor`、`addShoppingItem`、`addChecklistItem`、`addNote` 等）

---

### Template 重 encode 流程

修改 template 用一次性 Node 腳本：

```js
// 1. 讀 generator/generator-template.js，從 window.TRIP_TMPL_B64 取出 base64
// 2. Buffer.from(b64, 'base64').toString('utf8') → 完整 HTML
// 3. 對 HTML 做字串 replace（注意 OLD_STRING 必須與檔內完全一致）
// 4. Buffer.from(html, 'utf8').toString('base64') → 寫回 TRIP_TMPL_B64
```

驗證：node 解析 inline script（把 `__TRIP_CONFIG__` 替換為 `{}`、`"__TRIP_PIN__"` 替換為 `"0000"`）確認語法正確。

---

## 封面頁改版（2026-05-26）— PR #8

> branch: `feat/landing-page-redesign` · PR: https://github.com/Legendream/trip-app/pull/8

### 視覺
- **配色**：從米白（`#f6f0e3`）+ 朱紅 accent（`#a8362f`）改為**利休鼠**（`#eae8e2`）+ 朱色 accent（`#d4522a`）
  - 跳脫「米白 + 朱紅」這個近年台灣 indie brand 標配，採用日本傳統色「利休鼠」帶冷灰調的石灰質感
  - accent 從鮮紅改為偏橘的朱色，跟灰調背景形成暖冷對比，視覺重心更明顯
- **三欄痛點區塊**：移除上方的 `cover-story-num` kicker 標籤，三個標題（`.cover-story-headline`）改用朱色，視覺重心聚焦
- **Editor's Note**：移除 drop cap（每段第一字放大變色）效果，閱讀更順暢

### 文案
- **Hero 副標**：從「製作專屬於你和旅伴的旅遊行程頁」改為「免費製作專屬你的行程網頁。不留個資，完美守護你的隱私。」
- **三欄痛點**：替換為「一鍵導航 / PIN 碼保護 / 零資料留存」
- **Editor's Note**：標題改為「為什麼你需要旅人手帖？」，內容全新撰寫（從第一人稱痛點切入）
- **「我們解決什麼 / 我們不提供什麼」**：改名為「我們幫你搞定 / 我們不碰這些」，清單移除技術名詞（Firebase、閘門等），改用一般使用者能懂的描述
- **下一期預告**：改為東北賞櫻 8 天 7 夜手帖預告
- **版權頁授權**：改為「開源釋出 · 自由轉載（個人與非營利完全免費）」

### 可讀性（無障礙）
- 次要文字顏色加深：`--ink-2` 從 `#5e5c54` → `#3a3830`，符合 WCAG AA 對比度
- 痛點描述字級：13px → 15px（手機 16px）
- **取消中文斜體**（`.cover-story-sub` 移除 `font-style: italic`），中文斜體本來就難讀
- 取消 `editor-note-body p::first-letter` drop cap 樣式

### 移除的元素
- Hero 上方的「封　面　·　Cover Story」kicker label
- 三欄區塊的 num 標籤（「Story · One」等）
- Editor's Note 每段第一字的 drop cap 效果

### 過程中嘗試過、最後沒採用的方向
- 深森林綠底色（太重）
- 深酒紅底色（太厚重）
- 青磁色底色（「氣色不好臉色發青」）
- 復古時刻表深色 UI（太工業，示意圖已捨棄）
- 文青風短副標（怕使用者看不懂）

---

## Generator 流程改善（2026-05-26）— PR #8

> 接續首頁改版同一支 PR，根據實際走「建立行程」流程時的痛點逐項修正。所有改動限於 `generator/index.html` 與 `generator/generator-app.js`。

### Step 1（匯入行程）

- **步驟名稱**：`貼上行程` → `匯入行程`，覆蓋三條路徑（AI、手動、還原）而非單一動作；stepper 與底部頁碼同步更新（`STEPS` / `STEPS_META`）
- **移除 chapter-mark**：原本「第　一　章　·　貼上行程」與 stepper 重複，且書本章節語境太重，已連 CSS 一併移除
- **移除 drop-cap**：`.drop-cap::first-letter` 在中文沒有大小寫差異的脈絡下無視覺意義，且打斷掃讀節奏
- **圖片限制提示**：textarea hint 補上「圖片（機票截圖等）不會帶入——到步驟 2 開啟 AI 後，再把圖片貼過去即可」

### Step 2（補齊資料）— 多項

**PARSE_PROMPT 強化**（影響 AI 抽取行為）：
- 新增規則：圖片（機票/訂房截圖）一併擷取
- 新增規則：班機/列車/演唱會等明確時間事件必須帶 `time`，圖片時間優先
- Schema 新增 `flight` 物件：`{ label, num, from, fromCity, to, toCity, dept, arr, boarding }`，對應 trip-app-v2 既有的 `dtc-flight` 渲染

**人數欄位（`f-people-pill`）改為 input + 視覺後綴**：
- 原 placeholder「6人同行」誤導使用者以為要照格式打完整文字
- 改為純數字 input + 旁邊固定灰色「人同行」標籤（`.input-suffix-wrap` / `.input-suffix`）
- State 只存數字（如 `"2"`），輸出時用 `formatPeoplePill()` 組合成 `2人同行`
- 新增 `extractPeopleNumber()` 處理舊資料相容（`"6人同行"` → `"6"`），在 `importLoadedConfig` 自動轉換

**班機/演唱會缺時間時的視覺提醒**：
- 新增 `needsTime(act)` helper：以 icon（✈️🚄🚃🎵🎤 等）與關鍵字（飛、班機、演唱會 等）判斷
- `renderDays()` 的 `act-time-i` input 若 needsTime 且為空，加 `.missing` class（紅框 + 淡粉底）+ placeholder 改為「需填時間」
- input 即時 toggle，不重渲染避免搶焦點

**新增「✈️ 機票」獨立區塊**：
- Day card 加入與「🏨 住宿」對稱的機票區塊：row1（標籤 + 航班編號）、row2（IATA + 城市 + 起飛時間 → IATA + 城市 + 抵達時間）
- IATA 欄位即時轉大寫；窄螢幕收起箭頭、改三欄堆疊
- 無機票時顯示「＋ 新增機票」按鈕，與 `addHotel` 模式一致
- `addFlight()` / `removeFlight()` 已實作

**PIN 欄位修正**：
- 原本只有 `pattern="[0-9]*"`（送出時驗證），桌機可打字母進去 → 加上 `oninput` 即時 regex 過濾
- hint 從「建議用出發日（如 0415）方便記」改為「**4 位數字**，旅伴打開 App 時要輸入。建議用出發日（如 0415）方便記」
- 移除 inline style（`letter-spacing:4px;font-size:18px;font-weight:700`），字體與旁邊「旅程代碼」欄位統一

### 過程中討論但未採用
- 加 contenteditable 讓圖片可貼入 generator（無實質效果，prompt 仍是文字）
- 前端 OCR（Tesseract.js）整合（中日韓語混排品質不穩，bundle 太大）
- Vision AI API 整合（需後端，破壞「零部署、不留資料」設計）
- → 改採 PROMPT 端「請 AI 同時讀圖」的方式，零架構代價，三大 AI 工具皆支援

---

## 開發環境

**本地預覽**（需 serve，否則外部 JS 無法載入）：
```bash
npx serve -l 3737 .
# 開啟 http://localhost:3737
```

`.claude/launch.json` 已設定，在 Claude Code 中可直接啟動。

**Remote**：`git@github.com:Legendream/trip-app.git`（main branch）

---

## 統一時間軸模型重構（2026-06-01）— branch `feat/ux-improvements-and-demo-mode`（PR #9）

> 起因：使用者常規劃自駕行程、希望 generator「永久好用」。原本每加一種項目（活動／機票／住宿）就要在 render／template／AI parse／normalizeDay 四處各補特例，越來越像「拼裝機器」。本次把編輯模型統一成 CRUD 化的 timeline 集合。

### 核心：統一 timeline 模型 + adapter 邊界
- 一天 = `{ id, day, date, wd, theme, emoji, parking, items: [TimelineItem] }`。`items` 取代舊的 `acts / flight / hotel`。
- `TimelineItem = { id, type('activity'|'flight'|'lodging'), time, icon, title, sub, ref, location:{query,url,verified}, data{…} }`。
- **adapter 是唯一格式邊界**（`generator-app.js`）：
  - `fromLegacyDay()`（取代 `normalizeDay`）= 所有匯入收斂點，把舊格式或新格式都轉成統一模型。
  - `toLegacyDay()` = `collectConfig()` 匯出時拆回舊的 `acts/flight/hotel`，**所以 `generator-template.js` 與 `/v/` 不用改**。
  - `location.verified` 為編輯器專屬，存 localStorage、匯出時丟棄。
- `loadState()` 偵測舊形狀自動遷移（不換 STATE_KEY，舊草稿不丟）。
- 編輯操作統一：`addItem/removeItem`（保留 `addAct/addFlight/addHotel/removeAct/removeFlight/removeHotel` 薄包裝）；`actDrop/onTimeBlur` 走 items。

### 還原區支援匯入「手刻舊格式 app」
- 舊的手刻行程（資料存 `const DAYS=[...]`，無 `_CFG`）以前無法匯入。
- 新增 `jsLiteralToJson` / `parseJsVar`（JS 物件字面值→JSON，**不用 eval**）+ `extractLegacyConfig`（抽 DAYS/MEMBERS/NOTES/CHECKLIST/PRESET_SHOPPING/RESTAURANTS + meta）。
- `importHtmlText` 統一三條還原路徑（貼連結／貼原始碼／**選檔或拖放上傳**），先試 `_CFG` 再 fallback legacy。
- 還原區新增「貼已部署網址」分支：同源可 fetch、跨網域被 CORS 擋時給可行指引。

### 地點確認狀態（CRUD 可見化）
- 📍 欄位：連結型顯示唯讀綠標「🔗 連結定位」；名稱型用勾選框「定位無誤」（未確認旁附 ⓘ 引導）。`setItemMap/updateMapStatus/toggleLocVerified`。
- 住宿區塊補上 📍 地點欄（lodging item 本就帶 location，原本沒露出）。

### 租車 + 停車場
- **租車**：legacy importer 把 `car.bookings` 折進對應租車活動的 `ref`（找不到則新建活動）；不做特殊型別。
- **停車場**：每個活動／住宿旁「🅿️ 停車」即時搜尋鈕（template），開 Google Maps 搜「{當地用詞} {景點}」。
- **目的地地區**（基本資訊新欄位 `f-region`）→ `meta.parkingTerm`（日本=駐車場、台灣=停車場、韓國=주차장、其他=parking），解決「日本要搜駐車場」痛點；匯入舊檔會 best-effort 自動偵測地區。`REGION_PARKING/parkingTermFor/guessRegion`。
- legacy 的 `day.parking` 精選清單透傳保留（template 本就支援渲染）。

### CRUD 一致性補齊
- 住宿補上 ✕ 刪除（`removeHotel`，與機票對稱）。
- 成員名字改為可編輯 input（原本靜態 span，只能刪掉重加）。

### UX 細節
- 地圖圖示 generator 與成品統一為 📍（原 🗺）。
- 時間欄位 placeholder 改「🕐 選填」（灰色），區塊說明補上「24 小時制（下午 3 點=15:00）、填了自動排序」——避免排序解析器（只認 24hr HH:MM）誤判。
- 分享卡片加「連結壽命綁在平台網域」風險說明（依 UX Writing 原則）。

### Template re-encode 流程（base64）
動 `generator-template.js` 時用一次性 node 腳本：decode base64 → 字串 replace → `Buffer.from(html,'utf8').toString('base64')` 寫回 → **assertion 驗證**（替換唯一性、往返一致、inline script `new Function` 語法檢查）→ 預覽產出 App 確認無 console error。`/v/` 吃同一份 template 自動生效。

### 已知待辦
- [x] **成品天氣預報**（PR #10，branch `feat/weather-capsule-in-template`）：每活動天氣膠囊，Nominatim 地理編碼（中日韓全支援）＋ open-meteo archive/forecast 自動切換（7 天為切點）。patch 腳本見 `scripts/patch-weather-capsule.js`。
- [ ] **旅途中即時編輯行程（Firebase 同步）**：讓主揪在手機開啟產出 App 時，能直接修改行程（活動／機票／住宿），改完即時同步給所有旅伴。
  - **現狀**：行程資料（`DAYS`）是產出時 baked-in 的靜態常數，Firebase 只同步「集合通知／費用分帳／購物照片」，行程本身無法即時改——要改只能回 generator 重新產出、重新分享連結（手機體驗差）。
  - **建議架構**：App 載入時先讀 baked-in `DAYS`（靜態備份），若 Firebase 已連線再讀 `/days` 節點，有資料則覆蓋；編輯時 `.set()` 寫回 `/days`，旅伴 listener 觸發 re-render。
  - **需實作**：①行程 tab 的 inline 編輯 UI（活動名稱／時間可點擊改）②Firebase `/days` 讀寫邏輯 ③權限設計（建議：能輸入 PIN 者即可編輯，因 PIN 本就分享給旅伴）。
  - **規模**：獨立功能，建議另開 PR。僅對有設定 Firebase 的進階使用者生效（URL 分享模式不啟用即時同步）。
- [x] **移除留言板**：messages tab、nav button、CSS、函式、Firebase listener 整組移除。patch 腳本見 `scripts/patch-remove-messages.js`。
- [ ] **購物照片改本機儲存**：購物照片目前仍有 `_shopRef().update({ photos })` 同步到 Firebase（1 處殘留）。使用者原意是「照片只存自己裝置、不與旅伴共用」，需移除 Firebase sync、改為純 localStorage。
- [x] **機票/住宿移入時間軸 + 可拖曳排序**：`toLegacyDay()` 把 flight 折進 `acts`（icon ✈️，sub 組合航班資訊），消除「飛機活動 vs 獨立機票卡」重複；住宿也移進 act-list；三種 type 皆可互相拖曳。機票加航廈欄位（`fromTerminal`/`toTerminal`）。
- [x] **CRUD 復原機制**：刪除活動／機票／住宿後顯示 Undo Toast（5 秒視覺、Ctrl/Cmd+Z 30 秒內有效）；每張卡加「複製到其他天」（bottom sheet 選目標天，住宿／機票一天一筆會自動替換）。
- [x] **伴手禮清單兩欄化**：`presetShopping` 從字串陣列改為 `{ name, place }` 物件（品名必填／哪裡買選填），左右兩欄排版，系統統一加 🎁，移除「使用者自填 emoji」。`ensureExtras()` 自動遷移舊格式。
- [x] **手機操作提示 + 手機預覽**：Step 1 加「建議電腦操作」hint（僅 `≤600px` 顯示）；Step 4 新增「📱 預覽 App（手機）」按鈕（開 390×844 視窗模擬旅伴實際畫面）。

---

## 天氣 / 停車場 / 分享 UX 修正（2026-06-02）— branch `fix/weather-parking-share-ux`

> 使用者實測回報 5 個問題，逐項修正。天氣相關問題均以實打 open-meteo API 驗證根因。

### Q5 — 示範站天氣 0–0 度（`trip-app-v2/index.html`，僅動天氣）
- **根因**：示範站（東北賞櫻）天氣全用 forecast API，但行程已成過去；forecast API 對過去日期回 `null`，`Math.round(null)===0` → 「0–0°」。膠囊「歷史資料」標籤只是依日期貼的，資料源沒真的切歷史。
- **修法**：`fetchWeatherData` / `fetchHourlyWeather` 改 `archive-api.open-meteo.com/v1/archive`；降雨欄位 `precipitation_probability(_max)` → `precipitation(_sum)`（archive 無機率，回毫米）；顯示單位 `雨…%` → `雨…mm`；「帶傘」門檻改 mm（≥10 帶傘／≥1 備傘）；header 寫死示範字串一併改 mm。

### Q4 — 出發 >16 天的行程沒天氣（template，`scripts/patch-parking-weather-ux.js`）
- **根因**：open-meteo forecast 只到出發當日 +約 16 天（實測 allowed range 上限 = 今天 +15 天），更遠回 400，程式 `if(!r.ok) return` 靜默跳過 → 無膠囊也無說明。（使用者記得的「7 天」其實是 archive/forecast 切換點，非預報上限。）
- **修法**：`getWeatherCapsule` 重排，日期計算提前；`dateMidnight > 今天+16天` 回灰色佔位膠囊「⏳ 出發前約兩週才有天氣」，**每天只標一次**（掛在當天第一個活動，靠新增的 `actIdx` 參數）。新增 `.weather-capsule.pending` CSS。同步改 `scripts/weather-capsule-js.txt`。

### Q3 — 用當地語言搜停車場有時找不到（template）
- **根因**：停車搜尋字串 = `駐車場 + (map 是純文字就用它，是連結就用繁中景點名)`，混語在當地地圖搜不到。
- **修法**：新增 `parkQuery(a)`，連結優先抽 `q=`/`query=` 參數，其次抽路徑座標（`@lat,lon` 或 `!3d…!4d…`），都沒有才退回名稱 → 用使用者實際 pin 的位置。驗證：goo.gl `@34.889,135.807` 連結→搜「駐車場 34.889,135.807」（純座標，不靠語言）。

### Q2 — 停車場功能發現性 + 相關性（`generator/index.html`、`generator-app.js`、template）
**兩層精細度**（解決「前幾天搭大眾運輸、第 3 天才開車」＋「某景點徒步過去」兩種情境）：
- **總開關**：步驟二「🚗 自駕行程」（`f-self-drive`，預設關），控制功能存在 + 顯示地區欄（地區只服務停車場用詞）。
- **天層級**：總開關開啟後，每張 day card 出現「這天自駕」開關（`day.selfDrive`）→ 第 3 天起打開即可。
- **景點層級**：自駕日內每個非交通景點/住宿有 🅿️ 小開關（預設開），徒步的可逐一關掉（`item.park=false`）。交通類（`isTransitIcon()`）一律不顯示。
- 資料模型：`TimelineItem` 加 `park`（undefined=要／false=徒步不要）、day 加 `selfDrive`，皆走 `fromLegacyDay`/`toLegacyDay` adapter，仍是統一 timeline 模型的延伸。
- template 渲染條件改為**逐天**：活動 `d.selfDrive && !isTransit(a.icon) && a.park !== false`；住宿 `d.selfDrive && d.hotel.park !== false`（不再依賴 `meta.selfDrive`）。
- 新增函式：`toggleDaySelfDrive` / `toggleItemPark` / `parkToggleHtml` / `isTransitIcon`（generator）。
- **相容性**：舊分享連結無 `day.selfDrive` → 視為關閉、不顯示停車按鈕（編輯後重新產出即恢復）。

### Q1 — 分享連結太長（`generator/index.html`、`generator-app.js`）
- **取捨**：行程全壓在 URL hash 裡，真正縮短一定要存伺服器，牴觸「零資料留存」核心賣點 → **保留長連結、改善分享體驗**（不引入第三方短網址、不建後端）。
- 產生連結後長網址**預設收合**，新增「▾ 顯示連結文字」展開鈕；主視覺改為 📱 QR Code（primary）／📤 傳送給旅伴／↗ 開啟連結；status 改提示「用 QR / 系統分享，不必貼長網址」並說明長度是隱私的代價。

---

## 易用性測試回饋修正（2026-06-06）— branch `fix/generator-usability-feedback`（PR #13）

> 實際做易用性測試收到的回饋，逐項修正。全部限於 `generator/index.html` 與 `generator/generator-app.js`，template／`/v/` 不受影響。分三批 commit。

### 第一批 — 四項操作困惑

**①② 全域 placeholder 淡化（共同根因）**
- **根因**：全檔只有 `.act-time-i::placeholder` 設過顏色，其餘 input 吃瀏覽器預設——而 input 文字色是很深的 `--ink (#1c1815)`，預設 placeholder 看起來幾乎像填好的值。使用者因此（②）以為人數欄 placeholder「2」是預設值、沒發現還沒填，也（④）把購物／注意事項的範例 placeholder（「萩之月」等）當成已填內容。
- **修法**：新增全域 `input::placeholder, textarea::placeholder { color: var(--ink-4); font-weight:400; font-style:italic; opacity:1 }`。一條規則同時解掉 ② 與 ④。

**③ 機票截圖給 AI 的說明，發現性 + 理解性都不足**
- **根因**：說明拆成兩段灰色次要文字埋在 hint 裡；步驟一以「圖片**不會帶入**」否定句開場，使用者還沒有心智模型先看到否定只會困惑；真正動作說明在步驟二又是灰字。
- **修法**：步驟一去除否定開場、改前瞻語氣；步驟二把截圖說明從灰字提升為 AI 按鈕正下方的醒目 📸 callout（`.ai-screenshot-note`，朱紅左框），改用具體因果語言「把截圖拖進同一個對話，AI 自動讀出航班／時間／訂位代號」。

**④（同 ②，見上）**

**⑤ 「定位」ⓘ 被誤認為可點進去**
- **根因**：`<span class="map-info" tabindex="0">ⓘ</span>` 配 `:focus` 變色，釋放了強烈「可互動」訊號，但實際只有 `title` 工具提示、點下去沒反應；手機上 `title` 更完全不顯示。
- **修法**：順著它已釋放的可點訊號，改為真正可點的按鈕「ⓘ 怎麼修正？」，點擊就地展開深色說明氣泡（`.map-info-wrap` / `.map-info-pop`，桌機＋手機皆有效），點外面自動收起。新增 `toggleMapInfo` / `closeMapInfo`，掛進既有 document click 監聽。

### 第二批 — 依 UX Writing 原則精簡步驟說明、與提示文字做視覺區隔
- **根因**：步驟說明用 `.hint`（灰斜體），跟欄位提示、以及剛調淡的 placeholder 同色同樣式，使用者下意識當「可略過」掃過；且文字太長。
- **建立可學習的視覺層級**：
  - **灰斜體**（`.hint` ＋ placeholder）＝可略過的提示／範例
  - **深色非斜體**（`.panel-desc` / `.card-desc` / 新增 `.ai-step-desc`）＝該讀的操作說明
  - 重要限制改用框起來的 `.inline-caveat` 小框（如步驟一「只吃文字，截圖留到下一步」），與正文、提示都不同
- AI 流程三個步驟說明改用 `.ai-step-desc`，不再混進 hint。
- 步驟一～四所有 `panel-desc`／`card-desc` 依 UX Writing 原則精簡：前置動作、一句一意、刪冗詞（如步驟一面板說明兩句縮為一句、步驟四點出「多數人用分享連結就夠了」並把部署細節留給進階區）。

### 第三批 — 步驟三色彩改用易懂主名＋正式和色副標
- **根因（已上網查證）**：原本「朱泥赭／淺蔥青／紺青藍／山吹黃」等**並非正式日本傳統色名**——多為真和色字根（浅葱／紺青／藤／山吹／桜／抹茶）外掛一個漢語顏色類別字，官方一律是「○○色」結尾，組出的詞辭典查不到；且「朱泥」其實是**陶土名**，正紅和色應為「朱色」。故使用者困惑。
- **修法**：`THEMES` 每筆改為「易懂中文主名（卡片大字）＋ `wa` 正式和色名（小字斜體副標 `.theme-card-wa`）」：赭紅/朱色、抹茶綠/抹茶色、湖水綠/浅葱色、櫻花粉/桜色、靛藍/紺青、藤紫/藤色、琥珀黃/山吹色。
- **相容性**：主題仍以**色值**比對（`matchIdx` 比 color/accent，非名稱），舊分享連結與草稿不受影響。
- **查證來源**：colordic.org 和色大辞典、I-IRO 色彩アトラス、irocore 伝統色のいろは。

---

### 第四批 — 步驟四 Firebase 設定指引對齊最新版主控台（2026-06-10）

**根因**：指引寫於舊版 Firebase Console，「左側『建構』→ Realtime Database」的「建構」分類已不存在（易用性測試中使用者回報實際分類是「資料儲存空間」，官方 zh-TW 文件寫「資料庫和儲存空間」，疑為文件翻譯滯後）；且舊指引一步塞多個動作、沒有寫出預期結果，使用者無法照著完成設定。

**修法（`generator/index.html` 步驟四進階區，4 個 guide-step → 5 個）**：
- 步驟 2 改為「左側選單點開『資料儲存空間』→ Realtime Database」，並加防改版 fallback：「找不到時，用畫面上方的搜尋列搜 Realtime Database」（分類名稱 Google 常改，搜尋列是穩定路徑）。
- 步驟 1 補新版建立流程的 Gemini 詢問（與 Google Analytics 一樣用「若問…都選不啟用」的條件句，介面變動也不誤導）。
- **不再教使用者選「測試模式」**（使用者回報其 30 天期限：到期規則自動鎖死，旅途中同步會無聲失效）。改為：步驟 2 選「以鎖定模式啟動」（預設），新增步驟 3「到『規則』分頁發布專屬規則」——規則只開放旅程代碼（storagePrefix）那一個路徑、無期限，與 template 內建說明（`tohoku2026` 範例）同一模式。規則 JSON 由 `renderFbRules()` 動態帶入使用者實際的旅程代碼（進步驟四時與 `renderSummary` 一起跑），附「📋 複製規則」鈕（`copyFbRules()`，新增 `.guide-code` 樣式）。
- 原步驟 3/4（註冊應用程式、貼 config）順移為 4/5；註冊應用程式的入口依使用者實測截圖校正為新版路徑「左側選單『設定』（⚙）→ 子選單『一般』」（新版主控台已無『專案總覽旁齒輪 → 專案設定』）；最後一步寫出預期結果「看到『✓ Firebase 連線成功』就完成」。
- 每步依 UX Writing 原則重排：位置 → 動作 → 預期結果，一句一意。
- Netlify 部署步驟 3 同步校正（**注意：2026-06-10 第六批再次修正，本批當時引述的英文標籤有誤**）。

**配套（`generator-app.js`）**：
- `parseFirebaseConfig()` 改為先定位 `firebaseConfig = {` 再取平衡大括號區段——使用者把主控台整段程式碼（含 `import` 行）全選複製也能解析，說明因此可以簡化成「整段複製、貼上」；解析失敗訊息改為引導回註冊應用程式畫面重貼。
- `testFirebase()` 改打 `{databaseURL}/{旅程代碼}.json`（App 實際讀寫的路徑），不再打根路徑：原本把 401 視為成功（「DB 存在即可」），改規則制後 401 代表「規則沒發布／代碼不一致」，現在會明確報錯並指回步驟 3，把設定錯誤擋在產出之前。
- 已預覽驗證：三種貼上形式皆可解析；垃圾輸入、缺 `databaseURL`、401（規則未發布）、200 四種路徑各顯示正確訊息；規則區塊正確帶入旅程代碼；零 console error。

---

### 第五批 — 步驟四頁面精簡（2026-06-10）

> 原則：系統會自動做的事不寫進說明；頁面順序要跟指示的順序一致；與其他區塊重複的資訊刪掉。

- **刪除「📲 提醒旅伴加到主畫面」整塊**（含 iPhone/Android 操作清單）：旅伴在手機開啟分享連結時，`v/index.html` 的 `maybeShowAddToHomeHint()` 會自動顯示一次性提示橫幅（iOS/Android 各有對應指示、可關閉）——在對的裝置、對的時機提醒對的人，主揪不需要轉述。
- **預覽卡片移到分享卡片之前**：panel-desc 寫「先預覽確認，再選分享方式」，但原本「預覽產出的 App」卡片排在分享卡片後面，頁面順序與指示矛盾。
- **「怎麼運作」註記瘦身**：刪「網址本身就是檔案」比喻與「內容包含住宿、活動全部」贅句，保留三個重點：不經伺服器、PIN 照常生效、行程變動時重產連結覆蓋。
- **「連結的壽命」註記瘦身**：刪與分享卡片 desc 重複的「不用自己部署、點開就能看」、刪括號裡的技術補充（資料還壓在網址裡），長度約減半，結論與出路（下載＋部署）不變。
- **進階區兩處「加到主畫面」改為「離線也能開」**：分享連結模式的旅伴本來就能加主畫面（viewer 會提醒），進階「下載＋部署」路線真正的差異是含 `sw.js` 的完整 PWA 可離線使用；原文案拿共有的功能當賣點會誤導。
- 已預覽驗證：卡片順序正確、產生分享連結全流程正常（空狀態防呆＋成功產生 549 字連結）、零 console error。

---

### 第六批 — Netlify 部署步驟對齊實際介面（2026-06-10）

> **誠實補記**：第四批宣稱「校正為實際英文標籤」，但當時並未實際查看 Netlify 介面，所寫的「Drag and drop your site output folder here」「Sites」皆為臆測，與現況不符。本批依使用者實際截圖更正。

- **「Sites」→「Projects」**：Netlify 已將左側選單的「Sites」改名為「Projects」。
- **拖放區實際文字**更正為「Drag and drop your folder here」（截圖另顯示可用旁邊的「choose a folder」選取）。
- **明確標注「請拖資料夾、不要拖 .zip」**：`downloadZip()` 產出的 zip 內是 `{storagePrefix}/` 資料夾**包著** index.html/manifest.json/sw.js（`generator-app.js:2092`）。Netlify Drop 雖接受 zip，但直接拖 zip 會讓 index.html 落在子目錄、網站根目錄空掉而打不開；必須先解壓、拖「資料夾」（Netlify 以資料夾內容為網站根）。「先解壓」這點原本就對，只是 Netlify 標籤名稱需更新。
- zip 內附的 `README.txt` 部署說明同步更正（同樣「Sites」→「Projects」、補「不要拖 .zip」）。
- **新增改網址名步驟**（使用者實測回報：Netlify 預設隨機子網域難記、旅伴易誤認垃圾連結）。部署清單從 4 步擴為 5 步，於「拿到網址」與「傳給旅伴」之間插入改名步驟：路徑「Project → Project configuration → General → Project details → Manage project name」，並標注三個關鍵限制（僅小寫英數字／連字號、全球唯一、**改名後舊網址失效故須在分享前改**）。查證來源：Netlify Docs automatic-deploy-subdomains。
- **新增「之後要改內容？」更新指引**（使用者實測情境：成功部署後才發現上錯行程，原說明只教首次部署、沒講如何更新既有網站）。在部署卡片加朱紅左框 info-note：①回生成器改對（同瀏覽器草稿仍在／否則用本機 `index.html` 走步驟一還原）重新下載→②Netlify 進原網站「Deploys」分頁、捲到底部拖放區拖新資料夾→同網址更新、旅伴連結不失效。附 Firebase 注意（**初版措辭有坑，已修正**）：旅程代碼（storagePrefix）驅動 template 所有 Firebase 路徑（`_PFX + "/meeting"` 等），而第四批的 scoped 規則只開放「該代碼」一個路徑——故換代碼會讓既有規則失效、旅伴無聲連不上。說明改為三層：設定維持填著即可（不用重建專案／重貼 config）→ 旅程代碼建議保持不變（同步接續）→ 真要換代碼，須回「規則」分頁同步改代碼並重新發布。安全網：`testFirebase()` 已打實際代碼路徑，漏改規則會回 401 並提示確認代碼。查證來源：Netlify Docs create-deploys（既有 Drop 網站於 Deploys 頁底拖放更新、URL 不變）。
- 已預覽驗證：步驟 3/4 文字正確渲染、清單編號 1–5 連續、更新指引卡渲染正常、零 console error。

---

### 第七批 — 步驟四整體 UX Writing 重寫 + 依 F.I.T. 流程化（2026-06-15）

> **情境（使用者實測）**：進階模式已部署過（自建 Firebase + 自訂網址）的使用者，發現上錯行程要重新上傳內容。卡點不是單一文案，而是整個步驟四的資訊結構——首次設定與「之後要改內容」混在一起、5 步驟把獨立子任務攤平、且把「換代碼」與「config 欄位空白」兩件不相干的事綁在一起講。
>
> 先做過一版「已設定過 Firebase？回訪三分支」（見 git 歷史），但實測仍困惑，遂依使用者要求整段重做：依 **F.I.T.（可置換／獨立／可交付）** 重切流程、全步驟四文案 UX Writing 重寫。**只動 `generator/index.html`（+ `generator-app.js:2113` 一句提示）。**

- **查證到的根因（程式碼）**：「Firebase Config 欄位是否空白」不是使用者能判斷的狀態，而是取決於**還原來源**（`generator-app.js:964` 只在來源帶 `cfg.firebase` 時還原）：同瀏覽器草稿／本機下載的 `index.html` 會帶 config；分享連結（`:2131` 清空）、重貼全新內容（`extractLegacyConfig` 寫死 `firebase:{}`，`:905`）則不帶。**故「重新部署發現欄位空白」是常見情況、且與換代碼無關**——是兩件獨立的事，舊文案綁在一起才造成混淆。
- **修法**：
  - **首次 Firebase 設定：5 步 → 3 個有產出的子任務（T 可交付）**：①建一個資料庫（→ 拿到 databaseURL）②把資料庫只開放給這趟旅程（→ 規則已發布）③把資料庫接到生成器（→「✓ 連線成功」）。每步以粗體「這步要拿到什麼」開場、結尾加綠色 `.guide-result`「✓ 完成：…」回饋。保留搜尋列 fallback、整段貼上自動擷取、鎖定模式不選測試模式等正確內容。
  - **「之後要改內容？網址不用換」升為獨立卡片（I 獨立）**：從「部署到網路」卡片抽出，成為 panel-3 末端自有 card，分「用分享連結的你」「自己部署的你」兩條路徑（F 可置換）。Firebase 只剩一條訊息：**旅程代碼維持原組、規則不用動**；唯一要回 Firebase 的情況＝「重新下載前看一眼 Config 欄位空不空」（用可自我驗證的說法，不用「草稿」術語），空白才從「設定 ⚙ → 一般 → 您的應用程式 → SDK 設定和配置 → 設定」複製 `firebaseConfig` 貼回。
  - **完全移除「換旅程代碼」操作指引**（使用者決策）：換代碼是混淆主因、且只在「想清掉舊同步資料」時才需要；改為一律引導「代碼保持不變」，真要換的進階使用者靠 `testFirebase()` 的 401 自行摸索（邏輯不變、不教學）。
  - **firebase-setup 卡頂訊號指引**改為「這三步是第一次設定才要做；只是改內容重新部署 → 看本區塊最後的『之後要改內容？』」，把回訪者導去獨立維護卡片。
  - **其餘步驟四文案** UX Writing 收斂（panel-desc、分享連結兩個 info-note 等：一句一意、動作前置、刪重複）；部署清單（第六批已對齊實際 Netlify）維持不動避免回歸。全頁「解壓」→「解壓縮」（含 `generator-app.js:2113`）。
- **不採用**：不嵌入 Firebase／Netlify 截圖（介面改版會腐化，本專案已修過兩次）；不動 importer／template／`/v/`／`parseFirebaseConfig`／`testFirebase` 邏輯。
- **新增 CSS**：`.guide-result`（綠色 `var(--ok)`、與灰提示區隔）。
- 已預覽驗證（手機尺寸）：Firebase 3 子任務 + 綠色✓回饋、獨立維護卡片兩路徑、規則區塊仍動態帶旅程代碼、全頁無「換代碼」字樣、無殘留「解壓」、`parseFirebaseConfig` 對含 `import` 整段貼上仍正確、零 console error。

---

### 第八批 — 全站字體階層系統（2026-06-15）

> **回饋**：即使用電腦操作，字還是太小看不清楚；小字標籤（如步驟四「用分享連結的你」原 10px + 大寫字距）小到看不出意思。**範圍：生成器 + 封面頁**（`generator/index.html`、`generator/generator-app.js` 內聯字串、`index.html`）。

- **基準**：使用者指定不得小於 `.card-desc`（原 14.5px）→ **功能性閱讀文字一律 ≥ 15px**。
- **建立 5 級 type scale（CSS token，生成器與封面共用同組名）**，尺寸差承載結構層次：

  | 層級 | token | 桌機/手機 | 角色 |
  |---|---|---|---|
  | H1 | `--fs-h1` | 38 / 28 | 步驟大標 panel-title |
  | H2 | `--fs-h2` | 23 / 21 | 卡片標題 card-title |
  | H3 | `--fs-h3` | 17 / 16 | 區段小標／欄位標籤 card-label・field label |
  | Body | `--fs-body` | 16 / 15.5 | 正文／清單／按鈕／提示框 |
  | Fine | `--fs-fine` | 15 / 15 | 輔助／結果／註記／code／badge（最小級） |

  顯示層（封面 hero 92/56、masthead 30）已遠大於基準，維持不 token 化。**手機在既有 `@media(max-width:600px)` 內重新定義 token**，一處改全站生效。
- **`.card-label` 修正**：10px→17px(H3)，移除 `text-transform:uppercase` 與 `.26em` 字距——直接解掉「小到看不懂」的元凶。
- **正文/輔助靠顏色與樣式分層**（沿用 ink-2／灰斜體／綠色慣例），不全靠尺寸，故 Body/Fine 僅差 1px 仍有層次。
- **豁免（裝飾，非閱讀內容）**：封面 `.ssf-*` 迷你手機示意圖、步驟三 `.tp-*` 主題預覽（皆為縮小的 App 截圖插畫，放大會毀掉示意）、masthead 編輯室微標（kicker/edition）、編輯風 eyebrow/mark 字距標（hero-chapter-mark、editor-note-mark、cta-prelude…）、fleuron 花飾。
- **實作**：兩檔 `:root` 加 token；CSS 類別與 HTML/JS 內聯 `font-size` 改 `var(--fs-*)`；計數圈 `.guide-num`/`.dnum` 連圈放大（22→26px）；密集行程編輯器（742–1030）以 perl 批次收斂到 Fine。
- **已驗證**：`getComputedStyle` 全頁掃描——生成器步驟 0–4 與封面所有可見文字皆 ≥15px，唯一 <15 者為上述豁免的示意圖/編輯 chrome；桌機 H1–Fine 級距分明、「用分享連結的你」已 17px；手機 375px stepper 四步不溢出（351=351）、step-en 隱藏；零 console error。

---

## 行程協作編輯（旅伴同步）（2026-06-06）— branch `fix/generator-usability-feedback`（PR #13）

> **背景**：進階模式（使用者自建 Firebase）原本可共享的功能只有「集合時間」與「記帳分帳」兩條同步路徑；行程（`DAYS`）是生成時寫死的靜態設定，旅伴無法協作增刪。本次補上行程的新增／刪除同步，成為第三條協作功能。實作於 `generator/generator-template.js`（base64 patch，腳本 `scripts/patch-itinerary-collab.js`）。

### 資料模型 — overlay 疊在靜態 `DAYS` 之上（不改既有匯出格式）
- `ITIN_PATH = _PFX + "/itinerary"`
- `/itinerary/added/<pushKey>` = `{ day, icon, name, sub, time, map, by, timestamp }`：旅伴新增的景點
- `/itinerary/hidden/<presetId>` = `true`：被移除的預設景點，`presetId = \`${day}_${presetIndex}\``（`DAYS` 為靜態設定、執行期不重排，index 穩定）

### 渲染合併（`renderItinerary`）
- 每天 = 「未被 hidden 的預設景點」＋「該天的 added 景點」，依 `time` 字串（無時間者排最後）穩定排序，所以新增的景點會自動插入正確時間位置。
- added 景點顯示綠色「旅伴新增・<署名>」徽章（`.act-added-badge`）；署名取自既有 `localStorage["meetingName"]`（與集合署名共用）。
- 每筆景點在進階模式（`_canEdit = FB_ENABLED && firebaseReady`）顯示「🗑 刪除」鈕：預設景點 → 寫 `/hidden`；added 景點 → 從 `/added` remove。day 標頭「N 個景點」改用合併後數量。
- 每天行程下方加「➕ 新增景點」鈕，開 `#itin-overlay`（沿用 `.exp-overlay` 樣式），表單欄位：哪一天／圖示（`ITIN_ICONS` 15 顆）／名稱／時間／備註／地圖搜尋字。

### 即時同步效能處理
- 新增 `renderItinerary({cardsOnly:true})`：Firebase 監聽觸發時只換 `#day-cards-wrap` 內容，**不重抓天氣、不重捲到今天**（避免遠端他人編輯時自己畫面跳動／重複打 open-meteo）。完整 render 才跑 `loadWeatherStrip()` + `scrollToTodayCard()`。

### 安全
- added 景點的使用者輸入（name／sub／by）以新增的 `_esc()` HTML escape 後再插入（防同步內容造成 stored-XSS）；預設設定為信任來源維持原樣。

### 相容性
- 基本模式（未設 Firebase）：`_canEdit` 為 false，行程維持唯讀、無新增／刪除鈕，與原行為一致。
- 已驗證（mock Firebase 本機測試）：新增依時間排序、刪除預設／新增皆即時同步、計數即時更新、hidden 在完整重繪後持續、基本模式無編輯鈕，全程零 console error。

---

## 行程 CRUD 補完 + 活動列版面重排（2026-06-15）— branch `fix/generator-usability-feedback`（PR #14）

> **背景**：易用性回饋指出四個問題 —（1）進階模式（自建 Firebase）只能新增／刪除行程，**無法編輯**既有（預設）或自己在網頁新增的景點；（2）每列大大的紅色「🗑 刪除」鈕佔空間，功能鍵與時間全擠在右半邊、左下大片留白；（3）天氣資訊沒有明確預留位置；（4）沒有注意事項時顯示「undefined」。用 CRUD 檢視，行程缺的是 **Update**。實作於 `generator/generator-template.js`（base64 patch，腳本 `scripts/patch-itinerary-crud-ui.js`）＋ `generator/generator-app.js`（notes 匯出過濾）。

### ① 補上 Update — 第三層 overlay `edited`
- 沿用 added／hidden 的 overlay 思路新增 `/itinerary/edited/<presetId>` = `{ icon, name, sub, time, map }`，render 時以 `Object.assign(base, itinEdited[pid])` 疊在靜態 `DAYS` 上（`presetId = \`${day}_${index}\``，與 hidden 同鍵）。
- 新增景點編輯走 `/added/<key>.update()`（保留原 `by`／`timestamp`，沿用同一 push key，非刪除重建）。
- 新增／編輯**共用同一張表單**（`#itin-overlay`）：`itinEditTarget` 區分模式（null=新增｜`{kind:"added",key}`｜`{kind:"preset",pid}`），`itinFormSeed` 帶入既有值，標題與送出鈕文案隨模式切換（「📍 加入行程」/「💾 儲存修改」）。**編輯模式隱藏「哪一天」選單**（原地修改，避免動到 edited 的 day 索引鍵）。
- 被編輯過的預設景點顯示琥珀色「已修改」徽章（`.act-edited-badge`）。
- 安全：edited 的預設景點與 added 一樣，name／sub 經 `_esc()` escape 後再插入（`_userVal = _added || a._edited`）。

### ② 活動列版面重排（`.act-item`）+ ⋯ overflow 選單
- 改為兩區：上排「標題＋時間」同行（time-tag 移到標題右側）；下排 `.act-actions` 動作列。地圖維持唯一行內主要按鈕；**編輯／刪除（破壞性、低頻）收進 `⋯` overflow 選單**（`.act-menu`，刪除為紅字並與編輯分隔線隔開），對齊 UI/UX `overflow-menu`／`destructive-emphasis`／`primary-action`。
- `itinMenuKey` 記錄展開中的景點 id；toggle 走 `renderItinerary({cardsOnly:true})`；點選單以外處由一次性 document click handler 收起。

### ③ 天氣固定槽位
- 動作列左側 `.act-wx-slot`（`min-height:26px`）固定保留天氣膠囊空間，非同步載入回來原地替換、不位移（CLS）。維持「每天首個景點才顯示」邏輯。

### ④ 注意事項防呆 + 空狀態留白
- template `renderPacking`：先過濾出 `text` 非空的有效項；**無有效項則整段（含標題）不顯示**，留白讓使用者自行決定是否新增；`icon` 缺漏退回「⚠️」。
- `generator-app.js` `collectConfig`：匯出時 `notes` 過濾掉空 `text` 物件，從源頭不產生壞資料。

### 後續修正 — ⋯ 選單兩個 bug（`scripts/patch-itinerary-menu-fix.js`）
- **編輯點不到**：選單原本向上展開（`bottom:44px`），在每天「第一個景點」會被 `.day-body { overflow:hidden }` 切掉上緣（編輯被裁掉）。改為**向下展開**（`top:44px`），永遠落在展開的 day-body 內。
- **點別處關不掉**：原本監聽 `click` 且只要點在 `.act-actions` 內就不關——`click` 在部分觸控裝置點非互動元素不會觸發。改監聽 `pointerdown`（任何點按都收得到），且只有點在 `.act-menu` 或 `.act-menu-btn` 上才保持開啟，其餘一律關閉。

### 天氣整併 — 移除頂部橫幅，只留逐點膠囊（`scripts/patch-weather-banner-remove.js`）
- **背景**：原本有兩套天氣並存——①頂部橫幅 `loadWeatherStrip()`（讀手動設定的 `WEATHER_LOCS`，可多區但需生成時設定）②逐點膠囊 `getWeatherCapsule()`／`loadWeatherCapsules()`（自動 geocode 每個景點的經緯度，免設定）。兩套來源不一致、易混淆。
- **決策**：只留**逐點膠囊**（無需設定、自動顯示當天每個景點所在地的天氣；一天跨兩區會各點各自顯示）。移除頂部橫幅。
- 移除內容：橫幅 CSS（`.weather-strip*`／`.weather-day-card`／`.wdc-*`／`.weather-shimmer`／`.weather-dots`）、`renderItinerary` 內橫幅渲染與 `loadWeatherStrip()` 呼叫、已成死碼的 `loadWeatherStrip` 函式（template 縮小約 9.7KB）。保留：`loadWeatherCapsules`、`getWeatherCapsule`、`.weather-capsule*` CSS、`wmoIcon`。`scrollToTodayCard` 對 `.weather-strip-wrap` 已有 null fallback、不受影響。`WEATHER_LOCS` const 保留（generator 仍輸出、無害）。

### 注意事項升為獨立子分頁（`scripts/patch-notes-subtab.js`）
- **背景**：「清單」分頁原本只有 🎒 打包／🛍️ 購物 兩個互斥子分頁，而 ⚠️ 注意事項被塞在「打包」分頁下半部，看起來像打包的子項。但注意事項內容是全程提醒（電壓、入境、租車、用餐…），與打包無關——層級錯置造成困惑。
- **改法**：注意事項升為**第三個平行子分頁**（打包／購物／注意事項）。打包分頁回歸只放「行前清單」。`checklistSubTab` 由二值改三值（packing｜shopping｜notes），新增 `renderNotes()`，注意事項區塊從 `renderPacking()` 移出。
- **空狀態**：注意事項子分頁**僅在有有效 notes 時才出現**（承接留白原則）；若使用者正停在 notes 分頁而 notes 被清空，自動退回打包。三分頁仍在導覽上限內、`.checklist-tab-btn { flex:1 }` 自動均分。

### 驗證（mock Firebase 本機測試，`scripts/build-itin-test.js`）
- Update：預設景點改名／改時間 → `edited` overlay 寫入、卡片即時重繪、重新排序、出現「已修改」徽章；新增景點編輯 → 同一 key、保留 timestamp。
- ⋯ 選單：第一個景點的「編輯」完整可見、向下展開；點選單外任一處（含非互動文字）即關閉、點選單本身保持開啟。
- 天氣：頂部橫幅移除、逐點膠囊保留（async geocode 後逐列顯示各景點當地天氣），全程零 console error。
- 注意事項分頁：清單分頁出現三個平行子分頁（打包／購物／注意事項）、打包不再含注意事項、注意事項分頁顯示 7 筆；清空 notes 後第三分頁消失並退回打包，零 console error。
- 版面：標題＋時間同行、天氣膠囊在動作列左側固定槽位、地圖為主、⋯ 選單開出編輯／刪除。
- 注意事項：7 筆正常顯示｜清空 → 整段隱藏｜含空白／缺 icon 的壞項 → 只留有效項，三種情境皆無「undefined」。
- 全程零 console error。**尚未 commit**（等使用者指示）。

---

## 機票／住宿可編輯 + 刪除復原 + 最近刪除區（2026-06-25）— branch `fix/generator-usability-feedback`

> **觸發**：使用者部署後回報「機票、住宿、行程都不能編輯」「每個景點點開都跑出同一筆」。查因＝①機票/住宿原本純展示、無編輯 UI；②使用者 Ado 行程的「機票」其實是 ✈️ 圖示的「景點」（故可編輯）；③真正住宿卡片(🏨)無編輯功能；④編輯表單有「殘留 seed」bug。Firebase 規則使用者已確認 read/write 皆 true。三支 patch 皆走 base64 re-encode，`scripts/build-itin-test.js` 注入 mock Firebase 本機驗證。**尚未 commit**。

### ① 機票／住宿就地可編輯（`scripts/patch-flight-hotel-edit-undo.js`）
- 比照景點 `edited`/`hidden` overlay 模型，新增四個 Firebase 覆寫節點（皆掛 `ITIN_PATH` 下）：
  - `flightEdited/<day>` = `{label,num,from,fromCity,dept,to,toCity,arr}`（全欄位快照）、`flightHidden/<day>` = true
  - `hotelEdited/<day>` = `{name,note,paid,map}`、`hotelHidden/<day>` = true
- 每日卡片就地 ✏️編輯／🗑刪除；無資料的日子顯示「➕ 新增機票／住宿」虛線鈕。重用 `exp-overlay` 表單殼，新增 `flight-overlay` / `hotel-overlay` 兩個彈窗。
- 渲染採 `Object.assign({}, d.flight||{}, flightEdited[day]||{})`（overlay 全覆寫），住宿付款狀態以「現場付／已付清」雙鈕切換。

### ② 刪除 → 軟刪除 + 底部復原提示條（同上 patch）
- **移除原本的 `confirm()` 攔截**（對長輩易「習慣性按確定」），改為刪除後底部跳出 7 秒 undo toast「↩︎ 復原」。
- 景點 preset 用 `hidden` 旗標（復原＝移除旗標）；added 先快取資料再 `remove`（復原＝重新 push）。

### ③ 常駐「🗑 最近刪除」復原區（`scripts/patch-recent-deleted-area.js`）
- 所有刪除統一寫一筆到 `ITIN_PATH/trash/<pushKey>` = `{kind,day,label,deletedAt,data?,pid?,hadPreset?}`。
- 提示條與復原區**共用 `_doRestore()`**：提示條用刪除當下的 entry 物件還原（不依賴監聽延遲）、復原區用 `itinTrash[key]` 還原；任一入口復原後都刪掉該 trash 筆（兩入口不重複）。
- 行程頁尾 `#itin-trash-wrap` 收合區（預設關），列出每筆刪除項（icon／label／Day／多久前）+「↩︎ 復原」；超過 30 天的 trash 筆於監聽時自動清除。

### ④ 修「每個景點點開都長一樣」bug（`scripts/patch-form-stale-seed-fix.js`）
- **根因**：`_itinFormVals()`／`_flightFormVals()`／`_hotelFormVals()` 在 render 開頭優先讀畫面既有 `<input>`，但 `hideXForm()` 只移除 overlay `.visible`、沒清空表單 body → 重開時讀到上一筆殘留值蓋掉正確 seed。
- **修法**：三個 `hideXForm()` 關閉時 `form-body.innerHTML = ""`（送出／✕／點背景都會經過 hide），重開即正確用 seed；同一次編輯內換圖示／切付款的重渲染不經 hide，仍保留已輸入內容。
- ⚠️ **此 bug 在「使用者已部署的舊版」也存在**——若曾在表單顯示錯資料時按過「儲存修改」，會把該景點 overwrite 成錯內容（存進 `edited/<pid>`），需提醒使用者重新部署前檢查現行 App。

### 驗證（mock Firebase 本機）
- 遍歷全 8 天 **26 個景點**逐一開編輯 → 各自顯示自己資料、0 錯亂；亂序跳著編輯（含重開同筆）0 殘留。
- 機票（去/回程）、住宿（7 天）每筆編輯內容正確；**存檔只寫回該筆**，相鄰項與其他天不受影響。
- 同次編輯打字到一半換圖示／切付款 → 已輸入文字保留。
- 刪除景點/機票/住宿 → trash 列出 → 提示條或復原區任一復原都正確移回並從 trash 移除。全程零 console error。

### ⚠️ 重要：兩種版本的編輯能力不同
- **進階版**（自部署 + 自建 Firebase）：以上編輯／刪除／復原功能**才有作用**（需 `_canEdit = FB_ENABLED && firebaseReady`）。
- **陽春版**（`/v/#z=...` 零部署連結）：產生連結時 `cfg.firebase = {}`，**唯讀**，沒有任何編輯。本批功能對陽春連結不適用。

---

## 下載 App 圖示 + 檔名（2026-06-25）— branch `fix/generator-usability-feedback`

> **觸發**：使用者反映加到手機主畫面的 App 圖示「字體壓縮有點醜」。原本 `buildTripIconSvg`（`generator-app.js`）把標題文字塞進方塊，長標題（如 Ado shortTitle「2026年東」）會被壓扁。決策：**改用品牌 logo + 主題色底**（使用者選；保留用顏色區分行程）。**改動只在 `generator-app.js` + `v/index.html`，非 base64 模板，不需 re-encode。**

- **圖示**（`buildTripIconSvg`）：改為渲染「旅人手帖」品牌山景 mark（取自 `icon.svg`：框架＋太陽＋山脈＋虛線路徑＋書籤尾），描邊用淺色 `bgPale`、底為行程 `themeColor`，底部保留 "TRIP JOURNAL" 字樣。不再放任何標題文字 → 永不壓字、品牌一致、靠主題色區分行程。已用四種主題色渲染驗收，乾淨清晰。
- **`/v/` 陽春版**（`generateIconSvg`，`v/index.html`）：同步改成**完全一樣**的圖示，讓「下載部署版」與「`#z=` 連結版」主畫面圖示一致（原本 /v/ 也是塞 trip name 文字、同樣壓字）。/v/ 的 `<head>` 本來就有 `apple-touch-icon` 且會 swap 成動態圖示，iOS 沿用此圖示。
- **下載檔名**（`downloadZip`）：`.zip` 檔名由 `storagePrefix`（如 `2026ado2026`）改為**行程名稱**（`cfg.meta.title`，過濾 `/ \ : * ? " < > |` 等檔名禁用字元）；**內層部署資料夾仍維持 storagePrefix**（URL-safe，部署用）。

### PNG 圖示（真正修好主畫面圖示，2026-06-25 追加）
> **使用者在 Android 實機看到的仍是醜圖**（淺底深字「202/6東京」+ 角落 Chrome 標記）＝**Chrome 加到主畫面忽略了 SVG manifest 圖示、改用標題文字自動生成 fallback**。根因：圖示是 SVG。**修法：給 manifest 真正的 PNG 圖示**（由品牌圖渲染），Android 與 iOS 皆然（iOS 的 apple-touch-icon 也只吃 PNG）。
- **光柵化**（`generator-app.js` `svgToPngBase64`、`v/index.html` `svgToPngDataUrl`）：把 `buildTripIconSvg`/`generateIconSvg` 的 SVG 透過離屏 canvas `drawImage` → `toDataURL('image/png')`。品牌 mark 是純 path（無外部字型相依）→ canvas 不會 taint，輸出合法 PNG（瀏覽器實測 `iVBORw0K…`、192px 約 8.9KB base64、渲染正確）。
- **部署版**（`downloadZip` + `buildManifest`）：manifest `icons` 改指 `./icon-192.png`（any）+ `./icon-512.png`（any maskable）；下載 zip 內附 `icon-192.png` / `icon-512.png` / `apple-touch-icon.png`（180）三張由品牌圖渲染的 PNG；`buildSw` 的 `ASSETS` 一併加入三張圖離線快取；template `<head>` 加 `apple-touch-icon` + PNG favicon（`scripts/patch-app-icon-png.js`，base64 re-encode）。
- **`/v/` 陽春版**（`installPwaManifest` 改 async）：manifest `icons` 與 `apple-touch-icon`/favicon 全改用 `svgToPngDataUrl` 產生的 PNG data-URL（單頁無檔案系統，只能內嵌 data-URL）；失敗時 fallback 回 SVG data-URL。
- ⚠️ 這些是新模板/新 generator 行為，使用者需**重新生成 + 重新部署**才會生效（舊部署仍是 SVG 圖示）。

---

## 託管架構釐清：陽春版是「零知識」的（2026-06-25 討論）

> **修正先前的錯誤分析**。曾說「放在你網域上＝你看得到資料」——那只適用於「把每個使用者的 HTML 檔上傳到你主機」的託管。**陽春版不是那樣運作**，無此問題。

- **機制**（`generator-app.js` `buildShareUrl()` + `v/index.html`）：步驟四把整份 config gzip + base64url 編碼塞進**網址 hash 片段**（`legendream.com/v/#z=...`）。`/v/` 是對所有人相同的**單一靜態 viewer**，讀 `location.hash` 在**瀏覽者瀏覽器內**解碼渲染。
- **關鍵**：HTTP 規範下 `#` 後的片段**不會送到伺服器**（程式註解明載 "Hash never sent to server per HTTP spec"）。
- **因此同時滿足賣家三個目標**：
  - **零資料持有**：資料只在連結裡，從不送達伺服器、不存任何檔案／DB。
  - **零資源 / 不會滿**：主機上永遠只有同一個 ~16KB 靜態頁，無逐人檔案、無 DB、無 Firebase，不論幾個行程。
  - **零操作**：使用者自助走到步驟四即生連結。
- **限制**：①連結＝資料本身（只編碼未加密），拿到連結即可看，提醒勿公開貼網路；②陽春版唯讀（Firebase 被剝離）；③行程大→連結長（程式已有 QR 難掃警告）。
- **結論**：陽春版本來就是伺服器端零知識，**不需要**「知情同意 / 我看得到」那條路。真正會「持有/看到資料」的情境只有「把使用者 HTML 檔上傳到你主機」那種託管，目前產品沒有走那條。

---

## 清理死碼與留言殘留（2026-06-06）— branch `fix/generator-usability-feedback`（PR #13）

> **明確決策**：購物清單／自訂清單**刻意只存本機（localStorage），不與旅伴同步**。先前留有半成品的 Firebase 同步死碼與舊「留言／群組訊息」殘留文案，為避免日後混淆一併清除。腳本 `scripts/patch-remove-shopping-deadcode.js`（template 走 base64 re-encode）。

---

## Next to Do

### 更新 tokyo2026ado 示範行程並完整測試生成器

**目標**：以真實旅遊資料跑完生成器全流程，確認 PR #13 的所有修改在實際使用情境下正常運作。

**工作項目**：

1. **準備 tokyo2026ado 行程資料**：更新示範用行程內容（景點／機票／住宿／日期），確認 AI 解析結果正確帶入生成器各欄位。

2. **完整測試生成器流程**：
   - 步驟一：AI 解析行程文字（含截圖帶入機票資訊）
   - 步驟二：確認行程日期、景點、機票、住宿欄位正確顯示
   - 步驟三：選色彩主題（確認易懂主名＋和色副標渲染正確）
   - 步驟四：
     - **分享連結路線**：產生 `/v/#z=...` 連結，手機開啟確認渲染正常
     - **進階路線**（有 Firebase）：依新版 5 步驟 Firebase 指引設定、驗證 `testFirebase()` 打實際路徑、確認規則動態帶入 storagePrefix、下載 zip → 解壓 → Netlify Drop

3. **確認協作功能（進階模式）**：旅伴新增景點、刪除景點即時同步；`_canEdit` 為 false 時無編輯按鈕。

4. **回歸確認**：購物清單 localStorage 持久化、天氣膠囊正常渲染（日期在未來走 forecast、過去走 archive）、零 console error。

---

### template（`generator/generator-template.js`）
- 刪除死碼 `const SHOP_PATH = _PFX + "/shopping";`（無人使用的常數）。
- 刪除死碼 `function _shopRef(key){…}`（全檔僅定義、從未被呼叫）。
- 修過時註解 `// Hide collab-only tabs (meeting / messages / expenses)` → 拿掉已不存在的 `messages`。
- 購物／自訂清單的本機邏輯（`SHOPPING_KEY` / `CUSTOM_CHECK_KEY` / `_shopSave` / localStorage 讀寫）完整保留，行為不變。

### generator UI（`generator/index.html`）
- 行銷文案兩處「群組訊息」更新：旅行成員卡片說明改為「用於費用分攤、分帳結算」；多人即時同步卡片改為「**行程協作編輯**、集合倒數、費用分帳」（反映本批新增的行程協作功能，取代已移除的留言功能）。

### 留言功能本體
- app 內的留言 tab／nav／函式先前已由 `scripts/patch-remove-messages.js` 移除，本次只清殘留參照。

### 驗證
- 全專案（template 解碼／generator/index.html／generator-app.js／`v/`）grep 確認 `SHOP_PATH`、`_shopRef`、`MSG_PATH`、`留言`、`群組訊息`、`*-messages` 皆**零殘留**。
- 預覽實測：購物清單新增（8→9）／刪除（9→8）走 localStorage 持久化、清單分頁正常渲染、`_shopRef`/`SHOP_PATH` 已不存在、零 console error。

---

## SW 舊版快取修正 + 新增景點圖示對齊行程（2026-07-03）— branch `fix/sw-stale-cache-and-itin-icons`

> **觸發**：使用者回報進階模式部署站（ado2026ao.netlify.app）清單三分頁（打包／購物／注意事項）「不穩定出現」、注意事項有時藏在打包第二層；且 App 內「新增景點」的圖示跟行程既有圖示長得不一樣。

### ① 根因：SW cache key 不升版 + cache-first 永不回源（裝置被鎖在舊版 App）
- **查證**：線上部署檔與 repo 最新 template **同版**（diff 僅差佔位符）——「三分頁永遠顯示」修正其實已部署。但線上 `sw.js` 的 cache key 仍是 `2026ado2026-v1`。
- **鏈條**：`swCacheKey` 只在「還原匯入」路徑升版（`importLoadedConfig` → `bumpSwCacheKey`）；從**同瀏覽器草稿**直接重產出 → key 不變 → `sw.js` byte 相同 → 舊裝置 SW 永不更新；且 fetch handler 是 cache-first 永不回源 → 舊手機**永遠**拿到快取裡的舊版 index.html（注意事項還在打包第二層的那版）。新裝置無快取看到新版 → 「有時穩有時不穩」。
- **修法（三層防護）**：
  1. `buildSw()`（generator-app.js）：cache key 每次下載附 build 版號（`{swCacheKey}-b{timestamp36}`）→ 每次重新部署必觸發 SW 更新、`activate` 必淘汰舊快取。
  2. `buildSw()`：頁面導覽（`e.request.mode === "navigate"`）改 **network-first**（離線才 fallback 快取），其餘資產維持 cache-first → 線上旅伴重開 App 就拿到新版，離線可用性不變。
  3. template（`scripts/patch-sw-update-and-itin-icons.js`，base64 patch）：SW 註冊處加 `controllerchange` 一次性 `location.reload()`（僅在「已有 controller 被新 SW 接管」時重載，首次安裝不重載）→ 部署新版時開著的頁面自動更新。`/v/` 檢視器只 stub 掉 `register`，此段在 `/v/` 不註冊 SW、事件永不觸發，無副作用。
- **⚠️ 使用者操作**：合併後需回 generator 重新產出、重新部署一次。已卡舊版的手機**第一次打開仍是舊版**（舊頁面沒有 reload listener），背景換上新 SW；**第二次打開起永遠新版**。此後每次部署，開著的頁面會自動 reload。

### ② 新增景點圖示改為「行程既有圖示優先」的動態清單
- **根因**：行程既有 icon 是 AI／使用者在 generator 自由選的任意 emoji；App 內「新增景點」表單是寫死的 15 顆通用 emoji（`ITIN_ICONS`），兩者無交集邏輯 → 新增的景點看起來跟既有行程不一致。
- **修法**（同支 patch 腳本）：`ITIN_ICONS` 改 IIFE——`DAYS[].acts[].icon` 去重排前（含折進 acts 的機票 ✈️／住宿 🏨），再補 15 顆通用預設，上限 24 顆。

### 驗證
- patch 腳本 assertion 全過（唯一匹配、base64 roundtrip、inline script 語法）。
- mock Firebase 測試頁（`scripts/build-itin-test.js`）：三分頁恆在；新增景點表單 24 顆圖示、行程 17 顆自用圖示排前；零 console error。
- `buildSw` 產出 sw.js 語法檢查通過、CACHE key 帶 build 版號、navigate 分支存在。
- generator 頁面載入正常、零 console error。

---

## Template 原始檔化（2026-07-03）— branch `chore/template-source-build`

> **動機（維護性）**：template 一直只以 base64 形式存在，每次修改都要寫一支「解碼 → 字串替換 → 重編碼」的一次性 patch 腳本，累積 20+ 支後成為最大腐敗源——改動不可讀（diff 只有一行 base64）、腳本不可重跑、歷史散落在各腳本檔頭。

- **`generator/template-src.html`**：template 解碼後 commit 成 source of truth（完整可讀 HTML，diff 有意義）。
- **`scripts/build-template.js`**：唯一建置入口。驗證（13 個佔位符齊全、`navigator.serviceWorker.register` 字串存在＝`/v/` SW 剝離點、inline script `new Function` 語法、base64 roundtrip）→ 寫回 `generator-template.js`。`--check` 模式只比對不寫檔（防兩邊 drift）。
- **`scripts/archive/`**：全部 `patch-*.js` 與 patch 支援 txt 封存（附 README 說明勿再執行）；`build-demo.js`、`build-itin-test.js`、`demo-config.json` 保留原地。
- **runtime 合約不變**：`generator-template.js` 仍輸出 `window.TRIP_TMPL_B64`，generator 與 `/v/` 完全不用改。

### 驗證
- 解碼 → rebuild → `generator-template.js` base64 本體不變（僅檔頭註解更新為 AUTO-GENERATED 警語）。
- `--check` 通過；對 template-src.html 加一行再 `--check` → 正確以 exit 1 報 DRIFT，還原後再通過。

### ⚠️ 補記：stacked PR 的 base 沒有自動 retarget（PR #22）
PR #21（本節內容）是疊在 PR #20 分支上開的（base = `fix/sw-stale-cache-and-itin-icons`）。**PR #20 先合併進 main 後，GitHub 沒有自動把 #21 的 base 改成 main**（只有來源分支被刪除才會自動 retarget，但 #20 合併時分支還留著、#21 還開著）。結果 #21 顯示「MERGED」，但實際上只合併進了 `fix/sw-stale-cache-and-itin-icons` 分支本身——這個分支早在 #21 合併前就已經進了 main（即 #20 的內容），**#21 的內容從未真正落地到 main**，直到開 PR #22 補上。**教訓：疊 PR 時，base PR 一旦合併，要立刻確認上層 PR 的 base 是否已 retarget 成 main，不要只看「MERGED」字樣。**

---

## 天氣功能「感覺消失了」修正（2026-07-03）— branch `fix/weather-geocode-cache`

> **觸發**：使用者回報 ado2026ao.netlify.app 的天氣預報功能不見了。

### 查證過程
- 比對線上部署檔與 repo：**當時線上還沒部署 PR #20/#21 的任何內容**（`sw.js` 仍是舊版 `2026ado2026-v1`），排除「新程式碼壞了天氣」。
- 把線上真實的 `_CFG`（Ado 東京行程）抽出，用 `generator/generator-template.js`＋真實 config 在本機重建同一份 App，接上真正的 Nominatim／open-meteo API 實測整條 pipeline：**天氣功能本身沒壞**——14 個地點全部正確算出天氣膠囊、零 console error。
- 真正的根因是**體感**問題，不是功能壞掉：
  1. `loadWeatherCapsules()` 對整趟行程「所有不重複地點」做**循序** geocode（Nominatim 政策限 1 req/秒），這趟行程 14 個地點 ≈ 需要 15–20 秒才跑完，且**跑完前一律不渲染任何天氣膠囊**（`getWeatherCapsule` 查無資料時回傳空字串，整個 `.act-wx-slot` 連 DOM 節點都不出現）——使用者若沒等滿 20 秒就切走或重整，會覺得「天氣功能不存在」。
  2. `_GEO_CACHE`／`_WX_CACHE` 只存在記憶體、**不跨 session 保存**——每次重新打開 App（含旅途中常見的「切到 Google Map 導航、切回來」「重新整理」）都要重跑一次完整 15–20 秒的 geocode 隊列，體感更像「常常不見」。
  3. （次要、非本次主因但一併記錄）Nominatim 的 CDN 快取偶發不附帶 CORS 標頭：對同一組真實地點字串用 curl 測試，六個常見地標（品川神社、日產體育場等）出現 `x-cache: MISS, HIT` 卻**沒有** `access-control-allow-origin`，代表命中舊快取節點時瀏覽器會擋下該次 fetch（有 try/catch，會靜默失敗、不會噴錯誤到主流程）。真實瀏覽器測試同一批查詢仍全部成功，判斷是 Nominatim CDN 節點間的暫態不一致，不受我們控制，但下面的快取修正剛好也降低了觸發機率（快取到的地點不用再打 Nominatim）。

### 修法（`generator/template-src.html`，三處）
1. **地點座標永久存 localStorage**（`_GEO_CACHE_KEY = `${storagePrefix}_geoCache_v1``）：地名對應的經緯度不會變，只快取「查到」的結果（查不到／失敗不快取，避免把暫時性 Nominatim 失敗永久記成黑名單）。**同一裝置第二次以後打開 App，跳過整條 geocode 隊列**，只剩天氣 API（快、並行、CORS 正常）。
2. **`_wxLoading` 載入中旗標**：流程跑完前，`getWeatherCapsule` 對「有地點但還沒查到資料」的景點回傳灰色「⏳」載入膠囊，而非空字串——使用者能立即看到「天氣正在載入」而不是誤以為功能不存在；流程跑完（`_wxLoading=false`）後才照實際結果顯示有/無天氣。
3. 新增 CSS `.weather-capsule.loading`（灰底灰字，與既有 `.pending`／正常膠囊視覺區隔）。

### 驗證（本機重建 App + 真實 API，`preview_*` 工具）
- 清空 localStorage 首次載入：立即出現 18 顆「⏳」載入膠囊（而非空白）；~22 秒後全部替換為 14 顆真實天氣膠囊，零 console error。
- 重新整理（模擬旅途中常見的重開）：**~3 秒內**14 顆天氣膠囊全部到位（geocode 快取命中，只剩天氣 API），相較首次的 20+ 秒大幅縮短。
- `localStorage` 確認寫入 `{storagePrefix}_geoCache_v1`。

### ⚠️ 使用者操作
與 SW 修正相同：需回 generator 重新產出、重新部署一次才會生效。

## 景點精確定位 — 第一批（2026-07-09）— branch `feat/attraction-geo-location`（PR #25，已 merged 進 main `c752124`）

> **背景**：手機上新增景點時，天氣是拿「地名文字」丟 Nominatim 重查座標（原 `limit=1` 取第一筆）→ **同名地點會抓錯位置的天氣**，且使用者無回饋、只覺得「不準」。手機「分享」給的 `maps.app.goo.gl` 短連結不含座標、前端無法跟隨轉址（CORS），所以「解析分享連結」在手機主場景不可行。分兩批做，本批＝A（GPS）+ D（信心提示）+ 落地資料模型乙，另暖身補上產生器的結束日期/時間欄位。第二批（E 地圖選點 Leaflet）之後再做。

### 資料模型乙：活動獨立 `geo` 座標欄位（`generator/template-src.html`）
- 活動新增獨立 `geo`（字串 `"lat,lon"`），`map` 仍存可讀名字/連結；**天氣解析優先用 `geo`**，地圖按鈕仍用名字/連結。
- 新增 `_normGeo(geo)`：把座標字串正規化成 `"lat,lon"`、驗證經緯度範圍，非法回 `null`。
- `_extractGeoQuery(mapStr, actName, geo)` 加第三參數，**geo 優先** → 其次解析 map 連結 pin 座標 → 再退回名字。call sites 全部帶入 geo：`_weatherQueriesByDate`（含 hotel）、`refreshWeatherForAdded`、`getWeatherCapsule`、渲染。
- Firebase 同步：`submitItinAct` 三條寫入路徑（added push / added update / preset edited set）都寫 `geo`（`_normGeo(v.geo) || ""`）；`_findItinItem` 回傳帶 `geo`；`showItinForm`/`startEditItin`/`_itinFormVals` 都帶 `geo`（geo 非手打欄位，以 `itinFormSeed.geo` 為準）。

### A｜GPS 標定「📍 用我目前的位置」
- 新增景點表單「精確定位（選填）」區塊：`useMyLocation()` 用 `navigator.geolocation.getCurrentPosition`（`enableHighAccuracy`）抓座標寫進 `itinFormSeed.geo`，權限被拒有友善提示。
- 標定後顯示綠色座標卡片（`.geo-pinned`）＋「清除」鈕（`clearMyLocation()`）＋**「🗺 在地圖上確認這個位置」連結**（`mapUrl(geo)` 開 Google 地圖精準落 pin，讓使用者核對落點是不是他要的地方）。
- 按鈕文案幾經斟酌定為「📍 用我目前的位置」（原「📍 我在這裡」太隱晦），說明白話化：「人正站在這個景點時按一下：用手機定位把『目前所在位置』設成這個景點的天氣座標」。

### D｜地名信心提示 ⚠️
- `_geocodeOne` 的 Nominatim 查詢改 `limit=5`（多取幾筆才判斷得出精不精確）。
- 新增 `_judgeGeoPrecise(results)`：三種「不精確」訊號任一成立即回 `false` — ① `boundingbox` 跨度 > 0.18°（約 >20km，回的是整個行政區/城市）；② `type`/`class` 屬粗略行政或地名層級（`COARSE` set / `class === 'boundary'`）；③ 同名歧義（第二筆離第一筆很遠且重要性相近）。
- 不精確時（`precise === false`）在天氣膠囊掛 `⚠️`（帶 title 說明，提示改用 GPS/地圖選點）；使用者標定的精確座標（GPS/pin/地圖選點）一律 `precise: true`、不掛。
- `_GEO_CACHE_KEY` 升版 `_geoCache_v1` → `_geoCache_v2`（快取值多存 `precise` 旗標；升版讓既有使用者重跑一次 geocode 補上信心資訊，地名對經緯度不變、之後仍永久快取）。
- 新增 CSS `.weather-warn`、`.geo-pinned`/`.geo-gps-btn`/`.geo-clear-btn`/`.geo-verify-link`/`.hint`。

### 暖身：產生器「結束日期／結束時間」欄位（`generator/index.html` + `generator/generator-app.js`）
- 背景：PR #24 已讓 template 的 `updateCountdown` 支援 `meta.endDate`/`meta.endTime`（有填就以此為倒數結束界線，避免回程日沒排成一天時提早顯示「已結束」），但產生器沒有填這兩格的 UI、只能手改 config JSON。
- 「基本資訊」新增兩格：**結束日期（選填，text，格式 `M/D` 如 `4/22`）**、**結束時間（選填，`type=time`，`HH:MM`）**。`state.fields` 加 `f-end-date`/`f-end-time`（沿用通用 field 同步機制），`collectConfig` 寫入 `cfg.meta.endDate`/`endTime`，`importLoadedConfig` 反向回填（還原匯入可保留）。

### 驗證（mock Firebase 本機，`scripts/build-itin-test.js` + `preview_*`）
- `node scripts/build-template.js` 重建 `generator-template.js`、`--check` 通過（含 inline script 語法檢查）。
- App 端：`_normGeo`/`_extractGeoQuery` geo 優先、`_judgeGeoPrecise` 各情境（粗略城市/大 bbox/精細 POI/同名歧義）判定正確；GPS 標定→submit（geo 正規化寫入、與 map 並存）→編輯保留 geo→清除 全流程；⚠️ 只在 `precise===false` 出現、精確座標不出現；手機視窗截圖確認 UI。
- 產生器端：兩格填入 → `collectConfig` 帶出 `meta.endDate/endTime`、`importLoadedConfig` 回填皆正確；桌面截圖確認欄位。

### 之後 / 相關
- **第二批（待做）**：E 地圖選點（Leaflet 動態載入），接上 D 的 ⚠️ 校正閉環。geo 欄位與 `.geo-pinned` UI 已備好，選點器只要把座標寫進 `itinFormSeed.geo` 再 `renderItinFormBody()` 即可（與 GPS 同一條路）。
- 另有一個既有 bug（`getWeatherCapsule` 逐時分支退回 `dayData.daily` 時用 `w.temp`，但 daily 物件只有 `max`/`min` 沒有 `temp` → 顯示 `undefined°`；逐時通常填滿、少觸發，日期範圍邊緣會）由**獨立 session 從 main 別開分支修、走另一支 PR**，與本批無關。
