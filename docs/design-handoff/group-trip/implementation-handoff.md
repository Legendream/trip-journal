# 分組旅行：實作交接（給 Claude Code）

> 2026-10-06。設計與 AI 提示詞已定稿，這份說明怎麼實作。
> 先讀：PROGRESS.md → decisions.md → ai-prompt.md → 本檔。

## 0. 開工前

- 依全域 CLAUDE.md 的流程做 Git 檢查（分支 → PR → 使用者 merge）。設計文件已在 main（`docs/design-handoff/group-trip/`）。
- 實作開新分支，從 main 切：`feat/group-trip-data`（包 1）、`feat/group-trip-generator-ui`（包 2）。同一階段相關的工作放同一個 PR，用多個 commit 分段。
- **規則 7 是最高原則**：沒分組的行程，產生器畫面、提示詞、匯出的設定檔都要跟現在一字不差。每一包都要驗這條。

## 包 1：資料層（不碰畫面）

### 範圍

1. **新檔 `generator/group-trip.js`**：放所有分組的純函式，不碰 DOM。結尾加 `if (typeof module !== 'undefined') module.exports = {...}`，讓 Node 測試能直接 require。`generator/index.html` 在 generator-app.js 之前載入它。
   - `buildGroupSection(groups)`：回傳提示詞分組段落。文字照 `ai-test/group-section.txt`（v3 定稿），`{分組清單}` 換成一組一行。
   - `resolveWith(withArr, groups, members)`：組名／代號 → 成員 id 清單＋對不到的字串。
   - `normalizeImported(data, groups)`：把 AI 回傳的 `with`／`unsure` 轉成內部格式（ai-prompt.md 第 4 節）。
   - `computeAlerts(state)`：回傳 A-1～A-5 清單（ai-prompt.md 第 5 節的計算定義）。可直接參考 `ai-test/check.js` 的實作，它已用四份輸出驗證過。
2. **`generator-app.js`**
   - `state` 加 `groups: []`（`{id, name, memberIds, order}`）、`members` 每人加 `id`。舊 state 讀入時補 id（決策：內部用 id，匯出仍用名字，記帳不動；decisions 第 1 節）。
   - `buildPrompt()`：`state.groups.length > 0` 時，在 `JSON Schema（嚴格遵守）：` 前插入 `buildGroupSection()`。沒分組時 **不動**。
   - `applyParsedData()`：有 `with`／`unsure` 時呼叫 `normalizeImported()`。日卡、活動、日卡 hotel、日卡 flight、hotels 都可能有 `with`。
   - `fromLegacyDay()`／`normalizeItem()`：保留 `with`（成員 id 清單）與 `unsure`，不要在轉換時丟掉。
   - `toLegacyDay()` 與匯出設定檔：**這一包先不輸出分組欄位**（行程 App 還不認得，App 包再做）。
3. **順手修既有 bug**：AI 可能把 `notes` 回成字串陣列，行程 App 會靜默丟掉、產生器編輯器會出錯。
   - `PARSE_PROMPT` 的 schema 範例改成 `"notes": [{ "icon": "⚠️", "text": "…" }]`。這會改到沒分組時的提示詞，屬於修 bug，不算違反規則 7。
   - `applyParsedData()` 把字串轉成 `{ icon: "⚠️", text }`。

### 驗收

新增 `scripts/test-group-trip.js`（Node，不需瀏覽器）：

| # | 測試 | 通過條件 |
|---|---|---|
| 1 | `ai-test/reference.json` 匯入後算提醒 | 只有 A-5 一條（11/4） |
| 2 | `out-antigravity-v3.json` | A-2（阿熊 11/4）＋A-5，與 `check.js` 輸出一致 |
| 3 | `out-gemini-web-v3.json` | 只有 A-5（11/4 那筆活動） |
| 4 | 把 reference 裡某個 `with` 改成「福岡團」 | 出現 A-1 |
| 5 | `generator/schema-example.json`（沒分組）匯入→匯出 | 匯出的設定檔與改程式前完全相同（先存一份改前的輸出當基準） |
| 6 | 沒分組時 `buildPrompt()` | 只有 notes 範例那一行不同，其餘與改前相同 |
| 7 | notes 字串陣列匯入 | 轉成 `{icon, text}` |

另外在瀏覽器手動跑一次：用 schema-example.json 走完四步驟，產出的行程 App 跟改前一樣。

## 包 2：產生器畫面

前提：包 1 已 merge。畫面規格在 `screens/`（從 Claude Design 畫布匯出的快照，讀法見 `screens/README.md`），文字與規則在 decisions.md。

### 範圍

| 畫面 | 位置 | 規格 |
|---|---|---|
| D1 分組設定 | 步驟 1「用 AI 整理」，文字框下方 | screens/D1.dc.html；文字 G-1～G-8 |
| 步驟 2 各組成員摘要 | 步驟 2「旅行成員」 | decisions 第 3 節；三條匯入路線共用 |
| 日卡組名標籤＋選擇器 | 步驟 2「每日行程」 | screens/D2.dc.html；decisions 第 2、3 節 |
| 活動同行、分頭／一起行動、合併復原 | 同上，日卡展開 | screens/D2b.dc.html；G-10、G-11、G-15 |
| 新增成員欄位 placeholder | 步驟 2「旅行成員」 | `#new-name` 的「輸入姓名」改「輸入代號或暱稱」，**全域生效**（decisions 第 8 節，規則 7 的界線） |
| 判讀提醒列 | 步驟 2 頂部 | screens/D2.dc.html；A-0～A-5、G-12～G-14 |
| 組名標籤配色 | 共用元件 | screens/Colors.dc.html；decisions 第 2 節 |

要點：

- 標籤外觀只用來顯示狀態；選擇器裡用一般單選，不用標籤外觀。
- 標籤點擊範圍 44px 高（外觀不變）。
- 選了組別、全員、跟這天一樣後，選擇器自動關閉；「自己選」維持開啟。
- 合併卡片、刪除組別不跳確認視窗，沿用產生器既有的復原提示。
- 判讀提醒「略過」的清單要存進 state（Firebase 那份是之後的事）。

### 驗收

- 規則 7：選「全程一起」時，步驟 1、2 的畫面跟改前截圖逐一比對，沒有多出任何元素；唯一允許的差異是 M-1 的 placeholder 文字。
- 用 `ai-test/draft.txt` 走一次完整流程：填組別 → 複製提示詞貼給 AI → 貼回 JSON → 步驟 2 的提醒和標籤正確。
- 原型 A 的任務 A1（阿熊 11/4 改跟福岡組）5 步內完成。

## 尚未決定（實作時遇到再問 Claire）

- 行程 App 端（D3–D12）、Firebase 路徑、分享網址與備份檔帶組別：之後的包，見 PROGRESS.md 下一步 2、3。

## 給 Claude Code 的第一句話

> 請讀 docs/design-handoff/group-trip/implementation-handoff.md，做包 1。先做 Git 檢查，開分支再動手；改程式前先存一份沒分組行程的匯出結果當基準。
