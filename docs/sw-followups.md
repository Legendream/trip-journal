# Service Worker 順帶發現（待另開 PR 處理）

2026-09-14 修正示範頁 SW（分支 `fix/demo-sw-network-first`：回訪者從主畫面開啟會一直拿到舊頁面）時查到的四件事（第 4 點來自該 PR 的獨立驗收）。它們與該 PR 目的不同，約定另開 PR 處理。以下標「推論」的部分尚未實測。

## 1. 根目錄 `/sw.js`：舊的註冊可能還留在造訪過的瀏覽器

**現況**
- 根目錄 `sw.js` 的快取名稱是 `tohoku2026-v6`，會預先快取 `./index.html`、`./manifest.json`。所有請求一律快取優先，快取也永遠不會更新。這個檔最後修改於 `b85f2e5`（2026-04-14）。
- 根目錄 `index.html` 在 `6182cb0`（2026-04-14）加入 `navigator.serviceWorker.register("sw.js")`，到 `42e8ebd`（2026-05-05，首頁改為導引頁）才移除。目前 repo 裡沒有任何頁面註冊它（`git grep serviceWorker` 可查）。

**影響（推論）**
- 2026-04-14～05-05 間造訪過首頁的瀏覽器，可能仍留著這個 SW，它管的範圍是整個網站 `/`。
- 這些瀏覽器打開 `/index.html` 會拿到當時的舊頁面（東北賞櫻行程 App）；首頁讀取 `/manifest.json` 時，也會拿到舊版。
- 直接打開 `/` 不受影響，因為這個網址沒有被預先快取。
- 若該瀏覽器之後開過示範頁，示範頁的 SW 啟用時會刪掉同網域的其他快取，之後就不再受影響。

**待確認**
- 那段期間站台用的是否就是 trips.claire-cheng.com。這決定實際上有沒有人受影響。

**修法方向**
- 把根目錄 `sw.js` 換成「自我註銷」版本：啟用時刪掉自己的快取，並執行 `registration.unregister()`。
- 不需要任何頁面重新註冊。瀏覽器在網站範圍內換頁時會檢查 `sw.js`，發現內容變了就會換上新版。

## 2. 使用者 App 的 SW 沒有鬧鐘訊息與點通知的處理

**現況**
- `generator/generator-app.js` 的 `buildSw()` 產出的 SW 只處理 install／activate／fetch，沒有處理 `message`（`SCHEDULE_ALARM`／`CANCEL_ALARM`）和 `notificationclick`。
- git 歷史中從來沒有過（`git log -S SCHEDULE_ALARM -- generator/generator-app.js` 查無結果）。示範頁手寫的 `trip-app-v2/sw.js` 則兩者都有。
- template 的 `scheduleAlarmNotif()`（`generator/template-src.html`）會先試 `TimestampTrigger`，不支援時才用 `postMessage({ type: "SCHEDULE_ALARM", ... })` 請 SW 排程。
- Chrome 官方文件寫明 Notification Triggers API 已停止開發、從未正式推出：<https://developer.chrome.com/docs/web-platform/notification-triggers>。所以實際上都會走 postMessage 這條路。

**影響（推論）**
- 部署後的使用者 App，頁面關閉後，背景的集合鬧鐘不會跳出通知。
- 頁面開著時的頁內鬧鐘應不受影響。

**待確認**
- 實測部署版 App 設定集合時間後的實際行為。
- SW 裡用 `setTimeout` 排程：SW 閒置時若被瀏覽器終止，排程是否仍可靠。這決定修法是「補上處理程式」就好，還是要換做法。

**修法方向**
- 在 `buildSw()` 的產出內容補上跟示範頁相同的 `message`／`notificationclick` 處理。
- 行程建立者要重新下載、重新部署才會生效。

## 3. 示範頁引用的圖示是 404

**現況**
- `trip-app-v2/index.html` 由 template 產生，裡面引用 `icon-192.png`、`apple-touch-icon.png`。
- `trip-app-v2/` 目錄裡只有 `index.html`、`manifest.json`、`sw.js`、`tweaks-panel.jsx`，正式站這兩個圖示都回 404（2026-09-14 用 curl 確認）。
- 示範頁的 `manifest.json` 用的仍是舊的 data: SVG 圖示。

**修法方向**
- 讓 `scripts/build-demo.js` 一併產出這些 PNG 圖示（比照產生器下載的 zip），或調整示範頁的引用。
- 可以順便刪掉 `tweaks-panel.jsx`：現在的示範頁已經沒有引用它，`fix/demo-sw-network-first` 會把它移出 SW 的預先快取清單。

## 4. 示範頁點通知時，可能把同網域的其他分頁帶到前景

**現況**
- `trip-app-v2/sw.js` 的 `notificationclick` 用 `clients.matchAll({ type: "window", includeUncontrolled: true })` 取得視窗清單，然後把排在第一個的帶到前景。
- 這份清單包含同網域、但不在示範頁範圍內的分頁。2026-09-14 獨立驗收用 headless Chrome 實測，新舊版 SW 都一樣：
  - 首頁、產生器、示範頁都開著時，清單是 `/`、`/generator/`、`/trip-app-v2/index.html`
  - 關掉示範頁後，清單是 `/`、`/generator/`
- 依 W3C 規格，清單排序是：曾經聚焦過的視窗排前面，照最近聚焦的順序；從沒聚焦過的排後面，照建立順序。

**影響**
- 集合鬧鐘的通知點下去，會跳到最近聚焦過的同網域分頁（可能是首頁或產生器），而不是示範頁。
- 同網域沒有其他分頁開著時，行為才符合原意（有開示範頁就帶到前景，沒開就開啟）。

**修法方向**
- 只挑網址在示範頁範圍內的視窗（例如比對 `self.registration.scope`），都沒有才執行 `openWindow("./")`。
