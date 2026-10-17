# 加密短網址：實作方案（交接給新對話）

> 2026-10-17 由 Opus 對話整理，預定開新對話用 Sonnet 實作。
> **開工前必做**：先跟 Claire 確認文末「待決」與「驗收條件草稿」（開發五站流程站①），確認後才寫程式。

## 一、為什麼要做

- 陽春版（分享連結 `/v/#z=…`）把整份行程壓縮後放在網址 `#` 後面，示範行程約 6,600 字，貼到 LINE 很洗版。
- 使用者因此自己拿去第三方縮網址（reurl、Bitly），等於把**整份行程明文**交給第三方，比現在更不安全。
- 實測過「拿掉沒用的欄位」只省約 5%（`weatherLocs` 已沒在用，約 280 字），解決不了洗版。

## 二、已和 Claire 確認的方向（2026-10-17）

1. 做**加密短網址**：行程在手機上加密，伺服器只存打不開的密文，鑰匙只在連結裡。
2. **長網址保留**，使用者可以選。
3. 保存期限以「三個月」為基礎（起算點見待決 1）。
4. 首頁宣告要改成台灣讀者讀起來順的說法（候選見第六節）。

## 三、架構

### 存放位置：Cloudflare Workers KV（另一個帳號，與 Netlify 分開）

選 Cloudflare 而不是 Netlify Blobs 的原因（查證來源見第九節）：

| | Netlify（現有） | Cloudflare Workers KV 免費版 |
|---|---|---|
| 超過額度時 | 免費方案是硬上限，**帳號下所有網站暫停**（首頁、產生器、所有人的 App 一起停） | 只有超過的那類動作當天失敗，到 UTC 00:00 重置，**不影響主站** |
| 免費額度 | 每月 300 點（每 1 萬次請求 2 點、每 GB 流量 20 點、運算每 GB·小時 10 點） | 每天讀 100,000 次、寫 1,000 次（不同 key）、儲存 1 GB；單筆最大 25 MiB |
| 自動到期 | 沒有，要自己寫清理 | KV 寫入可設到期時間（`expiration`／`expirationTtl`）**——實作時查官方文件確認** |

### 連結長相

```
https://trips.claire-cheng.com/v/#s=<id>.<key>
```

- 網域仍是我們的，檢視頁照舊由 Netlify 提供（靜態檔，幾乎不花點數）。
- `id`（約 10 字元亂數）與 `key`（AES 金鑰，base64url 約 22 字元）都放在 `#` 後面，**連 Netlify 都收不到**；只有 Worker 收到 `id`，永遠收不到 `key`。
- 整條約 60～70 字元。Worker 用預設的 `*.workers.dev` 網址即可（不需要把網域搬到 Cloudflare）。

### 流程

**產生（產生器步驟 4）**
1. 照現在的 `shareCfgJson()` 取得行程 JSON → gzip（沿用 `gzipBytes`）。
2. 用 Web Crypto `AES-GCM` 隨機產生 128-bit 金鑰與 12-byte IV，加密。
3. `POST` 到 Worker：本體＝IV＋密文（二進位），另帶一個**明文**的到期日（只透露「哪天可刪」）。
4. Worker 檢查大小與到期日上限 → 產生隨機 `id` → 寫入 KV（設到期）→ 回 `id`。
5. 產生器組出短網址；QR Code、「傳送給旅伴」都改用短網址。
6. Worker 失敗（額度滿、網路斷）→ 顯示「短網址暫時無法產生，先用長網址」，並給長網址。

**打開（檢視頁 `/v/`）**
1. 偵測 `#s=` → 向 Worker `GET` 這個 `id` → 用 `key` 解密 → 解壓得到行程。
2. **立刻 `history.replaceState` 把網址換成 `#z=<長網址資料>`**，再照現在的 `#z=` 流程渲染。
   這樣「加到主畫面」記住的是長網址，桌面 App **不依賴伺服器**，到期刪除後照樣能開。（推論，必須在 iPhone Safari 與 Android Chrome 實測，見驗收 S7）
3. 找不到（已到期或刪除）→ 顯示「這個行程已過保存期限，請向分享的人要新連結」。
4. 解密失敗（連結被截斷、鑰匙錯）→ 顯示「連結不完整，請重新複製」。

### Worker 的防濫用（一定要做，不是加分項）

- 單筆大小上限：建議 64 KB（示範行程壓縮後約 5 KB）。
- 到期日上限：不超過建立後 1 年；沒給或格式錯就拒絕。
- 同一 IP 產生次數限制（例如每小時 20 次）。Cloudflare 有 Rate Limiting 功能，**免費版能不能用要查**；不能用就另想辦法（注意：用 KV 計數會吃掉每天 1,000 次的寫入額度）。
- `id` 用足夠長的亂數（至少 10 字元 base64url），不能用流水號。
- CORS 只允許 `trips.claire-cheng.com`（只能擋瀏覽器端濫用，擋不了直接呼叫）。
- 不記錄內容、不記錄 IP（跟 `netlify/functions/expand-map-link.mjs` 同樣原則）。

## 四、程式要動的地方（實作者先讀這些）

| 檔案 | 改什麼 |
|---|---|
| 新增 `cloudflare/short-link-worker/`（`wrangler.toml`＋`src/index.js`） | Worker：`POST /`（存）、`GET /<id>`（取）、防濫用 |
| `generator/generator-app.js` | `buildShareUrl()`／`generateShareUrl()` 旁加短網址產生；步驟 4 分享區的按鈕與說明文字（約 2800 行附近） |
| `generator/index.html` | 步驟 4 分享區：長／短網址的選擇 UI |
| `v/index.html` | 解析 `#s=`、取密文、解密、`replaceState` 成 `#z=`、錯誤畫面 |
| `index.html`（首頁） | 隱私宣告文字：第 532、537、917、944 行附近 |
| `PLAN.md` | 「為什麼符合『不存使用者資料』原則」一節改寫 |
| `CLAUDE.md` | 守護清單 G8 更新；新增短網址的守護項（見第七節） |

相關的既有規則：`CLAUDE.md` 守護清單（尤其 G7 陽春版同步範圍、G8 分享連結、G9 各自獨立的 App）。改完必跑 `CLAUDE.md` 列的三支檢查。

## 五、Claire 要親手做的事（Claude 不能代辦）

- 註冊 Cloudflare 帳號（Claude 不能建立帳號、不能輸入密碼）。
- 在電腦上登入 `wrangler`（Cloudflare 的指令列工具）或在 Cloudflare 網頁後台建立 KV 與 Worker。實作者寫好步驟、一步一步帶 Claire 做。
- 部署後把 Worker 網址告訴實作者，填進產生器與檢視頁。

## 六、首頁宣告候選（請 Claire 挑）

- 首頁小標章：「✔ 行程加密保存，我們也看不到」
- 說明段落：「分享時，行程會先在你的手機上鎖好，才放到網站上；鑰匙只在你傳出去的連結裡。所以網站只存了一個打不開的盒子，只有拿到連結的人看得到行程，連我們也看不到。」
- 更短：「行程上鎖保存，鑰匙只在你的連結裡。」
- 要誠實保留的一句：拿到連結的人就能看（加密防的是網站與第三方，不防轉傳）。
- 長網址的說明也要調：選長網址＝完全不經伺服器。

## 七、守護清單要怎麼改（需 Claire 同意）

- **G8** 現在寫「分享連結的行程資料放在網址 `#` 後面，不送到伺服器」。改成：長網址維持不送到伺服器；短網址只存密文、鑰匙不送到伺服器。
- **新增**：短網址打開後換回長網址，桌面 App 不依賴伺服器；到期刪除不影響已加到桌面的 App。
- **新增**：Worker 失敗時一定退回長網址，分享不能因此做不到。

## 八、驗收條件草稿（站①，要 Claire 確認）

| # | 情境 | 預期行為 |
|---|---|---|
| S1 | 產生器步驟 4 選「短網址」 | 產生 `…/v/#s=…` 的連結，長度 100 字元以內；QR Code 與「傳送給旅伴」用短網址 |
| S2 | 旅伴用短網址打開 | 看到完整行程，跟長網址打開的畫面一樣 |
| S3 | S2 打開後看網址列 | 已換成 `#z=` 的長網址 |
| S4 | Worker 收到的資料 | 只有 IV＋密文與到期日；拿 Worker 存的內容無法還原行程（實測：用錯的鑰匙解不開） |
| S5 | 短網址到期或被刪除後打開 | 顯示「已過保存期限」說明，不是空白頁或錯誤代碼 |
| S6 | 連結被截掉幾個字 | 顯示「連結不完整，請重新複製」 |
| S7 | iPhone Safari、Android Chrome：用短網址打開 → 加到主畫面 → 從 Worker 刪掉那筆 → 從桌面圖示打開 | 仍然打得開、行程完整 |
| S8 | Worker 沒回應或回錯誤 | 產生器提示並改給長網址，分享照樣能完成 |
| S9 | 上傳超過大小上限、到期日超過一年、短時間大量產生 | Worker 拒絕，不寫入 |
| S10 | 長網址 | 行為完全不變（守護清單 G8） |
| S11 | 首頁、PLAN.md、產生器的宣告文字 | 換成 Claire 選定的版本 |
| S12 | `CLAUDE.md` 列的三支檢查＋ verify-tools 回歸腳本 | 都通過 |

## 九、待決（新對話開工時先問 Claire）

1. **保存期限從哪天算？** 建議「旅程最後一天後 3 個月，最多 1 年」（從分享那天算的話，提早半年排行程的人可能還沒出發就失效）。Claire 只說過「三個月」，起算點還沒確認。
2. **預設給短網址還是長網址？** 建議預設短網址，長網址放在「進階／完全不經伺服器」選項。
3. **首頁宣告用哪個版本？**（第六節）
4. **分享連結要不要拿掉訂位號碼？** 隱私更好、也略短；但旅伴會看不到訂位號碼。可另開一項再決定。
5. **進階版「用自己的 Firebase 縮網址」**：這次不做，之後再說（2026-10-17 討論過，尚未決定時程）。
6. Cloudflare Rate Limiting 免費版能不能用、KV 到期設定的確切寫法：實作時查官方文件。

## 十、PR 安排（Claire 指定，2026-10-17 更新）

- PR #10（新版地圖連結讀不到位置）先推、先合併，讓天氣先修好；註解歸位、verify4／verify5 預期更新、這份方案都已一起推上 PR #10。
- 短網址**另開新分支、另開 PR**：等 Claire 說 PR #10 合併後，從最新的 main 開分支（例如 `feat/encrypted-short-link`）。如果開工時 PR #10 還沒合併，先問 Claire。
- push／開 PR 前照例先問 Claire（會扣 Netlify 預覽點數）。

## 十一、查證來源（2026-10-17 查）

- Netlify：[How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)、[價目頁](https://www.netlify.com/pricing/)、[Blobs 文件](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- Cloudflare：[Workers KV Limits](https://developers.cloudflare.com/kv/platform/limits/)、[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- Firebase：[Pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)、[Realtime Database billing](https://firebase.google.com/docs/database/usage/billing)

## 十二、開新對話的說法（貼給 Sonnet）

> 我們要做「加密短網址」。請先讀 `docs/design-handoff/short-link/plan.md` 和 `CLAUDE.md`，確認 PR #10 已合併後，從最新的 main 開新分支。先跟我確認方案第九節的待決事項與第八節的驗收條件，確認後再開始寫程式。
