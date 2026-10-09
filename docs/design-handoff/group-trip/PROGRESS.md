# 分組旅行：進度與下次接手

> 最後更新：2026-10-06。新對話開始時，先讀這份，再讀 decisions.md。

## 現在在哪個階段

設計完成，等實作。brief.md 要求交回的四項都已完成；AI 提示詞 v3 已實測通過；實作交接已寫好（implementation-handoff.md）。

下一步 1（AI 提示詞與資料格式）完成：提示詞 v3 經 Gemini 網頁版與 Antigravity 實測皆 27/27，見 ai-prompt.md 第 8 節。

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

1. **包 1 資料層 + 包 2 產生器畫面**：Claude Code，照 implementation-handoff.md。同一個分支、一個 PR，多個 commit（先包 1 再包 2）。
3. 之後：行程 App 端（D3–D12）、Firebase 資料路徑、舊行程相容（分享網址與備份檔帶組別）。
4. 可選：原型 A、B 的真人可用性測試（test-report.md 3 項待驗證）；原型 B 加換卡、三組畫面、大字體標籤。

## 隔一段時間再回來時

- 本資料夾 2026-10 從舊的私人 repo `trip-app` 搬到公開 repo `trip-journal`；舊 repo 已凍結，不再更新。merge 後 docs 會隨網站公開（netlify.toml `publish = "."`），不要放金鑰、真實 Firebase 設定或不想公開的內容。

- 先看這份的「下一步」，再看 `git status`，確認文件都已 commit、在哪個分支。
- 畫布若有改過，`screens/` 要重新匯出，否則 Claude Code 讀到的是舊版。
- AI 提示詞若要再改，改 `ai-test/group-section.txt` → `node build-prompt.js` → 用 check.js 重測，通過再改程式。generator-app.js 的 PARSE_PROMPT 若被別的工作改過，也要重跑 build-prompt.js 確認插入點還在。
- 產生器若在這段期間有別的改動（例如視覺減量），開工前先 rebase main。

## 開新對話時可以這樣說

> 請讀 trip-journal/docs/design-handoff/group-trip/PROGRESS.md 和 decisions.md，接續分組旅行的下一步。

要直接進實作（Claude Code）：

> 請讀 docs/design-handoff/group-trip/implementation-handoff.md，先做包 1、再做包 2（同一個分支、同一個 PR，多個 commit）。先做 Git 檢查，開分支再動手；改程式前先存一份沒分組行程的匯出結果當基準。
