# 分組旅行：進度與下次接手

> 最後更新：2026-10-09。新對話開始時，先讀這份，再讀 decisions.md。

## 現在在哪個階段

產生器端（包 1 資料層＋包 2 產生器畫面）已實作，在分支 `feat/group-trip-generator`（PR 待 merge）。行程 App 端、Firebase、舊行程相容還沒做。

- AI 提示詞 v3 經 Gemini 網頁版與 Antigravity 實測皆 27/27，見 ai-prompt.md 第 8 節。
- 測試：`node scripts/test-group-trip.js`（資料層＋畫面片段＋沒分組基準比對，不需瀏覽器）。沒分組基準檔在 `scripts/fixtures/no-group/`，是分組功能加入前（main b6d8c41）的輸出。
- 程式位置：`generator/group-trip.js`（純函式）、`generator/group-ui.js`（畫面）、`generator/generator-app.js`（掛接）。

實作時的補充決定（設計文件沒寫死的地方）：

- **入口暫時藏起來**：行程 App 端還不認得分組，所以步驟 1 的「有人分頭行動嗎？」只在網址帶 `?groups=1` 時顯示（例：`/generator/?groups=1`）；已選「有分頭」的草稿、或這次開啟頁面期間出現過入口，會一直顯示。App 端做完後，拿掉 `group-ui.js` 的 `groupFeatureOn()` 閘門即可。沒帶參數時，步驟 1、2 與改前一致（除了 M-1 placeholder、提示詞 notes 範例行）。
- 切回「全程一起」時，若同一天有 2 張以上的卡，切換列下方顯示說明（卡會保留、不標示誰跟哪張、可到步驟 2 按「這天一起行動」）。
- 新增提醒 A-6「日期「{原字串}」看不懂，請改成 月/日（例：11/3）」（decisions 沒有這條，文字待確認）；組名重複／沒填時在組別旁顯示紅字提醒（不擋）；分組行程改日期後依日期重新編號。
- `state.splitUp` 記錄「有分頭」開關；切回「全程一起」時組別保留但不生效，切回來就還在。
- 載入既有行程（還原路線）時，步驟 1 已填的組別用名字對上載入的成員；對不上的成員從組別拿掉。
- 成員沒有頭像時（手動建立），摘要與標籤顯示名字。
- 對不上的組名（A-1）在計算其他提醒時視為「沒人」，避免連帶誤報 A-2／A-4。

## 檔案地圖

| 檔案 | 內容 |
|---|---|
| brief.md | 原始需求 |
| decisions.md | 所有設計決策：資料結構、標籤規格、產生器流程、判讀提醒、App 換卡、規則 9–15、定稿文字（G/P/R/A/H 編號）、D4–D6 取捨、既有文字修改 |
| ai-prompt.md | AI 提示詞分組段落、`with`／`unsure` 欄位、匯入轉換、判讀提醒計算定義、待拍板事項 |
| implementation-handoff.md | **給 Claude Code 的實作交接**：包 1 資料層、包 2 產生器畫面，範圍與驗收 |
| screens/ | 畫布畫面原始檔快照（Claude Code 讀這裡，打不開 claude.ai 畫布） |
| ai-test/ | 實測工具：範例草稿、組好的提示詞、預期答案、檢查腳本 |
| test-report.md | 設計走查結果：5 個任務、10 項發現與處理狀態（3 項待真人驗證） |
| ../visual-cleanup/backlog.md | 另案：emoji 減量、琥珀黃對比問題，分組旅行上線後處理 |

畫面：Claude Design 畫布「分組旅行」（私人畫布，無公開連結；快照見 `screens/`）

- 產生器：D1、D2、D2b
- 行程 App：D3–D12
- 組名標籤配色表（定案）、舊比較板（已淘汰）
- 可點原型：原型 A（產生器改同行名單）、原型 B（App 你是誰／我的行程／全部）

## 已定案的關鍵方向（細節見 decisions.md）

- 資料存「成員」，組別只是名單別名，最多 3 組；標籤由名單反推。
- 標籤用主題深淺版：實心／外框／淡底加框；時間標籤不改。
- 產生器：組別填一次，日卡只看不填，有錯才點標籤；選擇器是單選（全員／各組／自己選）。
- App 旅途中跳組：「這天跟誰走？」換整張卡；基本版只存手機，進階版存 Firebase。
- 不加彈出引導；靠「▾」與判讀提醒。

## 下一步（依優先順序）

1. **行程 App 端**（D3–D12 畫面已設計好，不必回 Claude Design）＋ Firebase 資料路徑 ＋ 舊行程相容（分享網址與備份檔帶組別）。新對話開頭先**討論再定案**（激盪），定案後才寫實作交接與驗收清單：
   - 分組資訊怎麼進匯出設定檔、分享連結、還原：同行名單（`with`）、組別、成員 id 的格式；匯出目前用名字當 key、記帳 `payer` 存名字，改 id 要不要一起動。
   - `restaurants` 用 day 編號當 key、`weatherLocs` 以日期為 key，同一天兩張卡時分不出屬於哪組（ai-prompt.md 第 6 節）。
   - 分包方式：基本版（身分選擇、我的行程／全部、會合日卡、新增景點）先，進階版（Firebase：換卡同步、集合通知、記帳預設）後。
   - 規則 7：沒分組的行程，App 端畫面也要與改前一致。
   - D3–D12 是 2026-10-06 的快照，開工前先逐張核對與 decisions.md 有沒有矛盾（衝突以 decisions 為準）。
   - App 端做完後，拿掉 `generator/group-ui.js` 的 `groupFeatureOn()` 閘門（目前入口藏在網址 `?groups=1`），分組功能才算對外開放。
2. 可選：原型 A、B 的真人可用性測試（test-report.md 3 項待驗證）；原型 B 加換卡、三組畫面、大字體標籤。

## 隔一段時間再回來時

- 本資料夾 2026-10 從舊的私人 repo `trip-app` 搬到公開 repo `trip-journal`；舊 repo 已凍結，不再更新。merge 後 docs 會隨網站公開（netlify.toml `publish = "."`），不要放金鑰、真實 Firebase 設定或不想公開的內容。

- 先看這份的「下一步」，再看 `git status`，確認文件都已 commit、在哪個分支。
- 畫布若有改過，`screens/` 要重新匯出，否則 Claude Code 讀到的是舊版。
- AI 提示詞若要再改，改 `ai-test/group-section.txt` → `node build-prompt.js` → 用 check.js 重測，通過再改程式。generator-app.js 的 PARSE_PROMPT 若被別的工作改過，也要重跑 build-prompt.js 確認插入點還在。
- 產生器若在這段期間有別的改動（例如視覺減量），開工前先 rebase main。

## 開新對話時可以這樣說

行程 App 端（建議用 Opus 或 Fable：開頭有匯出格式與分包的架構討論）：

> 請讀 trip-journal/docs/design-handoff/group-trip/PROGRESS.md 和 decisions.md，接續分組旅行的下一步：行程 App 端。先和我討論匯出格式與分包方式，定案後再寫實作交接與驗收清單。

產生器端（包 1、包 2）已在 2026-10-10 合併進 main（PR #5）；`implementation-handoff.md` 是當時的交接，留作紀錄。測試：`node scripts/test-group-trip.js`。
