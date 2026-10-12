# 包 5 接手說明（2026-10-11 收工時寫）

> 給新對話的 Claude 讀。先讀 PROGRESS.md → decisions.md → app-handoff.md（第 4 節包 5、第 6 節決定）→ 本檔。

## 現在的狀態

- 包 3 已合併進 main（PR #6）。
- 包 4 已實作並通過驗收，在本機分支 `feat/group-trip-app-identity`（3 個 commit，**尚未 push、沒有 PR**）。
  - 驗收：4-1 ～ 4-17 逐條實測通過；另派空白記憶的 agent 獨立驗收＋找 bug，抓到的問題都已處理（見該分支的 commit 訊息）。
  - 之後 Claire 決定：**包 4 與包 5 合成同一個 PR**（多個 commit 分段），等包 5 做完一起開。所以包 5 從包 4 的分支切出去，不要等包 4 merge。
- 包 5 還沒開始。

## 開工步驟

1. `git status` 確認乾淨、在 `feat/group-trip-app-identity`；`git log --oneline -4` 應看到 `da92f95`、`3322ba4`、`0b2704c` 在 `62a76e9` 之上。
2. `git checkout -b feat/group-trip-app-sync`（從包 4 切出）。最後 PR 的 base 是 main，一個 PR 帶包 4 ＋ 包 5 的 commit；push 與開 PR 前先問 Claire（會觸發 Netlify 預覽）。
3. 先照 app-handoff.md 第 4 節把包 5 的驗收清單（5-1 ～ 5-22，Claire 已於 2026-10-10 確認）貼給 Claire 看一眼，再動手。
4. 動手前存基準：`node docs/design-handoff/group-trip/verify-tools/make-pages.js`（見該資料夾 README）。

## 包 4 留下、包 5 要接的東西（都在 `generator/template-src.html`）

| 項目 | 說明 |
|---|---|
| `ME`、`_meMember()`、`_whoEnabled()` | 身分。`ME` 是成員 id、`"none"`（只是看看）或 `null`（沒問過）。沒分組＋有 Firebase 的行程也會問身分，所以集合／記帳可以直接用 `ME` |
| `OVERRIDES`、`OVR_KEY`、`_myCards()`、`viewCardsFor()` | 換卡基本版存手機：`{ <成員id>: { <day>: <卡片key> } }`。包 5 的換卡同步要：有 Firebase 時改寫 `<prefix>/overrides/<成員id>/<day>`、不顯示「只有這支手機會換」；手機上既有的換卡第一次連上時寫進去一次 |
| `chooseSwap()`、`openSwap()` | 換卡面板（`#swap-overlay`）。「只有這支手機會換」那行要在有 Firebase 時隱藏 |
| `_listTagHtml(ids, swapDay)` | 組名標籤；`swapDay` 有值時是可點的按鈕 |
| `_dispDay(d)`、`_viewCards()`、`_filtering()` | 目前檢視的卡與 Day 編號。記帳預設分擔要用「付款人當天日卡的同行名單（套用換卡）」，可用 `viewCardsFor(DAYS, GMEMBERS, 付款人id, 換卡資料, _ck)` 取該成員的卡 |
| `_itinWithValue()` 等 | 新增景點「同行的人」（包 4 已完成） |
| 集合／記帳舊程式 | `renderMeeting()`、`setMeeting()`、`submitMeeting()`、`renderExpenses()`、`submitExpense()`、`calcSettlement()`、`DB_PATH`（`<prefix>/meeting`）、`EXP_PATH` |

## 驗證上的障礙：Firebase 模擬後端不跨頁

`PREVIEW_MOCK_FB`（`generator/generator-app.js` 內）是每個頁面各自一份記憶體，兩個瀏覽器不會互相看到資料。包 5 的 5-1 ～ 5-14 需要「兩個瀏覽器連同一個後端」。可選：

- **A**：請 Claire 提供一個測試用 Firebase 專案（金鑰與設定**不要進 repo**，docs 會隨網站公開），驗收時臨時填進設定檔。
- **B**（我的建議，推論、未驗證可行）：在 `verify-tools/` 寫一個只給驗證用的共用模擬後端（用 `BroadcastChannel` 或 `localStorage` 的 `storage` 事件在同源的兩個頁面間同步），不進產品程式。用 B 驗完大部分，再請 Claire 用 A 做最後一次真實連線驗收。

動手前先跟 Claire 確認走哪一條。

## 規格上要注意

- 規則 7（沒分組的行程）：包 5 的集合與記帳改動在有 Firebase 的行程不論有無分組都適用（多個集合並存、只有發起者能取消、付款人預設是自己）；沒分組又沒 Firebase 的行程畫面要與改前相同。沒分組行程不出現「通知誰」與任何標籤。
- 舊資料相容：舊路徑 `<prefix>/meeting` 只讀不寫；記帳的 `payer`／`forWhom` 對得上成員 id 就當 id、對不上當名字、再找不到用 `names`。
- 最後一個 commit 才拿掉 `generator/group-ui.js` 的 `groupFeatureOn()` 閘門與對應測試；PROGRESS.md 的進度、產生器 Firebase 教學裡提到單一集合的文字一併檢查（5-21）。
- 拿掉閘門 ＝ 分組功能對外開放。這一步 Claire 要明確同意再做。

## 還沒決定／待 Claire 的事

- 「我的行程」沒有任何卡時的空狀態文字：「這趟行程裡沒有排到你。可以切到「全部」看大家的行程。」（我擬的，待定稿）
- 新增景點「自己選」沒勾人時的提示：「請選擇同行的人」（我擬的，待定稿）
- 頭部倒數只看身分、不隨檢視切換（已記為決定，Claire 2026-10-11 同意）。

## 已知、不屬於這幾包的既有問題

- `localStorage` 被封鎖（部分無痕模式）時，App 在載入階段（約第 196、251 行）就會當掉，早於包 4 的程式。
- 「最近刪除」在我的行程裡仍列出別組的項目。

## 流程提醒（Claire 的全域規則）

- 站①驗收條件＝app-handoff.md 的 5-1 ～ 5-22（已確認）；站③逐條實測、標記通過／未通過；站④跑 `/code-review`（低強度）。
- 這次包 4 的做法可沿用：實作後派「空白記憶」的驗收 agent，只給它驗收條件與產物位置（本機有 `acceptance-reviewer` 就用它，沒有就用一般 agent 並明說不看實作過程），請它逐條驗收並主動找 bug；先向 Claire 說明成本並得到同意。
- 不直接 commit main；merge 由 Claire 在 GitHub 按；收尾（切回 main、pull、刪分支前先驗證已併入）等她說 merge 完成。
