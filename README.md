# 旅人手帖

> 免費製作專屬你的行程網頁。不留個資，完美守護你的隱私。

**Live site**：[trips.claire-cheng.com](https://trips.claire-cheng.com)

---

## 這是什麼

**旅人手帖**是一個旅遊 App 生成器平台，讓任何人不需寫程式，就能把 AI 整理好的行程資料打包成一個可分享的行程網頁。

- 零帳號、零部署、不經伺服器
- 行程資料不上傳任何平台，hash 不送到 server
- 完全免費、開源

---

## 專案結構

```
trip-app/
├── index.html               ← 封面頁（雜誌風入口）
├── manifest.json
├── sw.js
├── netlify.toml             ← publish = "."，main 自動部署
│
├── generator/
│   ├── index.html           ← 生成器 UI（4 步驟）
│   ├── generator-app.js     ← 生成器主邏輯
│   └── generator-template.js← 產出 App 的 base64 HTML template
│
├── v/
│   └── index.html           ← 分享連結檢視器（解碼 hash → 渲染行程）
│
├── trip-app-v2/
│   └── index.html           ← 東北賞櫻之旅示範 App（請勿修改）
│
└── scripts/
    ├── patch-parking-weather-ux.js  ← template patch 腳本（Q2/Q3/Q4）
    ├── parking-weather-ux.patches.txt
    ├── patch-weather-capsule.js
    ├── patch-remove-messages.js
    └── weather-capsule-js.txt
```

---

## 兩種分享方式

### 快速分享連結（推薦）
生成器步驟 4「產生分享連結」→ 行程資料 gzip + base64url 壓進 URL hash → 貼 LINE 給旅伴 → 旅伴點開 `/v/#z=...` → 檢視器解碼渲染。

- 零帳號、零部署
- Hash 不送到 server（HTTP spec 保證），行程資料完全不經過任何伺服器
- 8 天行程約 3 KB，LINE / WhatsApp / 簡訊都可傳

### 下載 + 部署（進階）
下載 `index.html` 上傳到 Netlify / GitHub Pages，取得永久自訂網址，可搭配 Firebase 多人即時同步。

---

## 生成器功能（`/generator/`）

4 步驟精靈，支援三種匯入模式：

| 步驟 | 名稱 | 功能 |
|---|---|---|
| 01 | 匯入行程 | 貼文字 → AI 解析；手動建立；還原舊連結／HTML |
| 02 | 補齊資料 | 逐天編輯活動、機票、住宿；購物清單；行前清單；注意事項 |
| 03 | 挑選外觀 | 7 個和の色主題，即時預覽 |
| 04 | 下載 App | 產生分享連結（QR / 系統分享）或下載 ZIP |

### 重要功能

**統一時間軸模型**：活動、機票、住宿都在同一個 `items[]` 裡。活動與機票依時間排序（只移動時間放錯的列，產生器與 App 規則相同）、可拖曳排序；住宿固定在當天最後；CRUD 復原（Undo Toast）。

**自駕停車場（兩層精細度）**：
- 步驟二「🚗 自駕行程」總開關（預設關）
- 每天可單獨標記「這天自駕」（解決前段大眾運輸、後段自駕的情境）
- 自駕日內每個景點有 🅿️ 小開關（預設開），徒步前往的可逐一關掉
- 停車搜尋用景點實際 pin 的位置（抽連結 `q=` 參數或座標），用當地語言搜尋

**每活動天氣膠囊**：
- Nominatim 地理編碼 + open-meteo API
- 距今 7 天內自動切歷史資料（archive API）；7 天後為預報（forecast API）
- 預報上限約出發 +16 天；超出顯示「⏳ 出發前約兩週才有天氣」佔位說明

**分享連結 UX**：長網址預設收合，主視覺改為 QR Code 與系統分享（Web Share API），行動裝置可直接傳 LINE。

---

## 示範 App（`/trip-app-v2/`）

東北賞櫻之旅 2026（8 天 7 夜，6 人）。**請勿修改，作為對外展示用途。**

| 功能 | 說明 |
|---|---|
| 📅 每日行程 | 展開/收合，含活動天氣膠囊（歷史資料，archive API） |
| 🔔 集合倒數 | Firebase 即時同步 |
| 💰 費用分帳 | 多幣別，自動計算最優還款路徑 |
| 🎒 行前清單 | localStorage，各裝置獨立 |
| 🛍️ 購物清單 | 品名 + 哪裡買兩欄，支援照片 |
| 🔒 PIN 碼保護 | 4 位數，sessionStorage 解鎖 |

---

## 本地開發

```bash
npx serve -l 3737 .
# 開啟 http://localhost:3737
```

各頁面已設定在 `.claude/launch.json`，可在 Claude Code 直接啟動。

### Template 更新流程

`generator-template.js` 內的 HTML 是 base64 編碼。修改後需重新 encode：

```bash
# 使用現有 patch 腳本（推薦）：
node scripts/patch-parking-weather-ux.js

# 或手動（Node.js）：
const newB64 = Buffer.from(html, 'utf8').toString('base64');
# 寫回 generator-template.js 的 window.TRIP_TMPL_B64 = '...'
```

---

## 外部服務

| 服務 | 用途 | 費用 |
|---|---|---|
| [Open-Meteo](https://open-meteo.com) | 天氣預報 + 歷史氣象（forecast / archive API） | 免費，無需 API Key |
| [Nominatim](https://nominatim.org) | 景點地理編碼（景點名稱 → 座標） | 免費，1 req/sec 限制 |
| Firebase Realtime DB | 集合通知、費用分帳即時同步（進階，選填） | 依用量 |
| Anthropic Claude API | 生成器 AI 解析模式（使用者自備 Key） | 依用量 |
| Netlify | 靜態網站部署，main branch 自動部署 | 免費方案 |

---

## Deploy

靜態網站，部署於 Netlify。`main` branch push 後自動部署（`.md` 與 `.claude/` 檔案變動除外，見 `netlify.toml`）。
