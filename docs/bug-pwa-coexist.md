# Bug：兩個分享行程 App 無法共存（已修，待實機確認）

> 2026-10-12 記錄。給下次開新對話接手用：先讀這份，再動手。
> 流程：獨立開分支（建議 `fix/pwa-scope-per-trip`）→ PR，不和分組旅行（`feat/group-trip-app-*`）混在一起。

## 結論（2026-10-12 更新）

- **原因：manifest 沒設 `id`**。規格規定沒有 `id` 時身分預設是 `start_url` 並去掉 `#` 片段，所有行程的身分都變成 `/v/`；Chrome Android 在第二個行程顯示「已安裝這個應用程式」並開到第一個（Claire 兩支 Android 手機截圖確認）。不是 scope 攔截，下方「推論」與方案 A、B 不採用。
- **兩個行程的 `storagePrefix` 不同**（台東 `20262026354`、吉隆坡 `20262026`），資料 key 都帶分隔符號，不會互相覆蓋。
- **修法**：`v/index.html` 的 manifest 加 `id: /v/?trip=<storagePrefix>`（方案 C）。假設各行程代號不重複。
- **舊的已安裝 App**：身分已固定成 `/v/`，改程式動不了；要重新「安裝並建立捷徑」才會換成新身分。
- 待實機確認：Android Chrome 兩個行程各自可安裝；iOS 加到主畫面沒退步。

## 症狀（Claire 回報）

- 手機上已經加了「台東」行程到主畫面。再下載「馬來西亞（吉隆坡）」行程後，必須先把台東刪掉，否則點馬來西亞的連結或圖示會**先跳到台東 App，再轉接到馬來西亞**。兩個 App 無法並存。
- 兩個行程都是分享連結（`/v/#z=…`），不是下載部署版。

## 已確認的事實（讀 code 得到）

出處：[v/index.html](../v/index.html)

1. 兩個行程的網址相同、只差 `#` 後面的資料：都是 `https://trips.claire-cheng.com/v/#z=<壓縮後的行程>`。
2. 檢視頁載入後，用 `installPwaManifest()` 動態產生 manifest（blob URL），內容是：
   - `start_url: location.pathname + location.hash`（= `/v/#z=該行程`）
   - `scope: location.pathname`（= `/v/`）
3. 檢視頁刻意不註冊 service worker（`navigator.serviceWorker.register` 被換成空函式）。
4. 所有行程共用同一個網域與路徑，也就共用同一個 `localStorage`；各行程資料的 key 靠 `meta.storagePrefix` 區分。

## 推論（**未驗證**）

- 兩個已安裝的 PWA（或「加到主畫面」的捷徑）**scope 完全相同（`/v/`）**。手機系統看到點擊的連結落在某個已安裝 App 的 scope 內，就交給**先裝的那個**開啟（開的是它自己的 `start_url`，也就是台東），之後頁面才依 `#z=` 載入另一個行程，所以看起來是「先跳台東再轉馬來西亞」。
- 若真是這個原因，刪掉台東就不會再被攔截，與回報的現象一致。

## 還沒確認的事

- [ ] 是 iOS 還是 Android？用 Safari／Chrome／哪個瀏覽器加到主畫面？（行為在各平台不同）
- [ ] 重現步驟：先裝台東 → 在瀏覽器貼馬來西亞連結 → 發生什麼？從馬來西亞主畫面圖示點開又發生什麼？
- [ ] 兩個行程的 `meta.storagePrefix` 是否相同？相同的話連 localStorage（集合、記帳、換卡、已選身分）都會互相覆蓋，是第二個問題。
  - 檢查方式（不要把連結貼進公開地方）：把 `#z=` 後面的字串存成檔案，用 Node 解開：
    ```js
    const zlib = require('zlib'), fs = require('fs');
    const z = fs.readFileSync('link.txt', 'utf8').trim().split('#z=')[1];
    const cfg = JSON.parse(zlib.gunzipSync(Buffer.from(z.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString());
    console.log(cfg.meta.title, cfg.meta.storagePrefix);
    ```
- [ ] 吉隆坡那串連結開頭有 `hhttps`（多一個 h），Claire 貼的時候可能是貼錯，不一定是連結本身的問題。

## 可能的修法（待討論，動手前要先驗證原因）

| 方案 | 做法 | 優點 | 風險 |
|---|---|---|---|
| A. 每個行程自己的 scope | manifest 的 `scope` 與 `start_url` 帶行程代號，例如 `/v/<storagePrefix>/`，並讓 `/v/<代號>/` 也能服務同一個檢視頁（Netlify 加 rewrite） | 各行程互不攔截 | 要改 netlify 設定與檢視頁；**已安裝的舊行程 scope 仍是 `/v/`**，舊的要重新加到主畫面才生效 |
| B. 不設 scope | manifest 拿掉 `scope`（瀏覽器預設以 start_url 所在目錄為 scope，仍是 `/v/`） | 改動最小 | 大概率無效，只是列出來排除 |
| C. 每個行程用不同的 `id` | manifest 加 `id`（Chrome 用它辨識是不是同一個 App） | 在支援 `id` 的瀏覽器上被視為不同 App | iOS Safari 對 `id` 的支援要查證；scope 攔截是否受影響要實測 |

動手前先做：查證各平台對「同 scope、不同 start_url」的處理（官方文件，不憑記憶）。

## 驗收條件草稿（開工時再和 Claire 確認）

1. 在同一支手機安裝兩個不同的分享行程，各自從主畫面圖示開啟，都進到自己的行程，不會先跳到另一個。
2. 瀏覽器貼其中一個連結，開到的是那個行程。
3. 兩個行程的集合／記帳／換卡／已選身分互不影響。
4. 已安裝的舊行程不需要刪除重裝也能繼續用（或明確告知需要重裝）。

## 不要做的事

- 不要在檢視頁加 service worker（原本刻意移除，避免快取舊的檢視頁，見 `v/index.html` 的註解）。
- 這個 bug 與分組旅行無關，不要放進分組旅行的 PR。
