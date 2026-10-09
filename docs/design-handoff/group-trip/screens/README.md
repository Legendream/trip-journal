# 分組旅行：畫面原始檔（快照）

> 2026-10-06 從 Claude Design 畫布「分組旅行」匯出，給 Claude Code 讀。畫布本身在 claude.ai，Claude Code 打不開，所以以這裡為準。
> 畫布：Claude Design「分組旅行」（私人畫布，無公開連結）
> 畫布之後若有修改，要重新匯出覆蓋這個資料夾。

## 怎麼讀

這些是 Claude Design 的元件檔（`.dc.html`），需要畫布的執行環境才能顯示，直接用瀏覽器開會缺樣式與 `{{變數}}`。請當成**規格**讀：版面結構、class 與 inline style 的數值、文字、互動狀態（`data-props` 裡的開關）。顏色變數的算法寫在每個檔案底部的 `renderVals()`。

## 對照

| 檔案 | 畫面 | 對應實作包 |
|---|---|---|
| D1.dc.html | 產生器步驟 1：分組設定（畫布上的 Main） | 包 2 |
| D2.dc.html | 產生器步驟 2：日卡組名標籤、判讀提醒、選擇器 | 包 2 |
| D2b.dc.html | 產生器步驟 2：活動同行、這天分頭／一起行動、合併復原 | 包 2 |
| D3–D12.dc.html | 行程 App（你是誰、我的行程／全部、會合日、集合、換卡…） | 之後的 App 包 |
| Colors.dc.html | 組名標籤配色（定案） | 包 2、App 包 |
| ProtoGen.dc.html | 可點原型 A：產生器改同行名單 | 參考互動 |
| ProtoApp.dc.html | 可點原型 B：行程 App | 參考互動 |
| canvas.json | 畫布索引（各畫面標題） | — |

已淘汰的「標籤比較」板沒有匯出。文字與規則以 ../decisions.md 為準；畫面與 decisions 衝突時，以 decisions 為準。
