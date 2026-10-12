# docs/ 文件地圖

> 找文件先看這張。新增文件時，在對應的區塊補一行。

## 我現在要做／要看什麼

| 想知道 | 看這份 |
|---|---|
| 現在做到哪、下一步是什麼 | `design-handoff/group-trip/PROGRESS.md` |
| 吉隆坡旅行中要順便測的項目（要記回饋的那份） | `test-kl-trip.md` |
| 還沒做的待辦、之後的想法 | `../PLAN.md`（未來想法）、`design-handoff/visual-cleanup/backlog.md`（視覺待辦）、`sw-followups.md`（Service Worker 待辦） |

## 驗收條件與結果（每個功能一份，`acceptance/`）

| 功能 | 檔案 | 狀態 |
|---|---|---|
| 住宿未訂、複製到多天 | `acceptance/lodging-status.md` | 已實作、已合併（PR #8）；C8、G1～G4 未驗證 |
| 視覺減量（emoji、對比） | `acceptance/visual-cleanup.md` | 已實作、已合併（PR #8） |
| 貼地圖連結定位天氣 | `acceptance/map-link-location.md` | 已確認 |
| 單日行程分享（第一批／第二批） | `acceptance/single-day-share.md`、`single-day-share-batch2.md` | 第一批已確認；第二批草稿 |
| 行程展示分享（海報） | `acceptance/showcase-share.md` | 草稿 |

## 功能的背景與需求（`use-cases/`）

每份是一個功能「為什麼做、給誰用」。索引見 `use-cases/README.md`：分組旅行設定／檢視、集合、記帳預設、地圖連結定位、單日分享、行程展示分享。

## 分組旅行（`design-handoff/group-trip/`）

| 想看 | 檔案 |
|---|---|
| 規則與已定案的決定 | `decisions.md` |
| 當初的設計需求 | `brief.md` |
| 實作交接（產生器端／行程 App 端／包 5） | `implementation-handoff.md`、`app-handoff.md`、`package-5-handoff.md` |
| AI 提示詞與資料格式 | `ai-prompt.md`、`ai-test/`（提示詞測試與結果） |
| 設計走查報告（待驗證項目） | `test-report.md` |
| 驗證用腳本（我跑的，你不用管） | `verify-tools/`（說明見 `verify-tools/README.md`） |

## 其他

| 內容 | 檔案 |
|---|---|
| 兩個分享行程無法共存的診斷 | `bug-pwa-coexist.md` |
| 行程展示海報的設計規格 | `design-handoff/showcase-poster/` |
| 視覺減量的盤點 | `design-handoff/visual-cleanup/backlog.md` |
