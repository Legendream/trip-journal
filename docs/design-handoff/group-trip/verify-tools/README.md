# 驗證用腳本（headless Chrome）

包 4 的瀏覽器驗收是用這幾支腳本跑的（行動尺寸 390×844）。包 5 可以直接沿用、再加新的。

| 檔案 | 用途 |
|---|---|
| make-pages.js | 用「改前」樣板（`BASE_REF`，預設 `62a76e9` = 包 3 合併後的 main）和目前工作區的樣板，各產出 5 種頁面：沒分組、沒分組＋Firebase 模擬、分組、分組＋Firebase 模擬、單一成員＋Firebase 模擬。分組設定檔取自 `ai-test/reference.json` |
| cdp.js | 最小的 Chrome DevTools Protocol 驅動（Node 24 內建 WebSocket）：`launch()`、`goto`、`eval`、`shot`、`setClock`（固定「今天」） |
| verify4.js | 包 4 驗收清單 4-1 ～ 4-16b 的瀏覽器項目 |
| shared-mock.js | 包 5 用：共用模擬後端（本機 node 伺服器＋頁面端輪詢），讓多個瀏覽器連到同一份資料；同時當靜態頁面伺服器。不進產品程式 |
| verify5.js | 包 5 驗收清單 5-1 ～ 5-20 的瀏覽器項目（開多個 Chrome、各自設時鐘；約 3 分鐘）。5-21 看 test-group-trip.js，5-22 跑 verify3／verify4 |
| verify3.js | 包 3 驗收清單的瀏覽器項目（4-17／5-22 回歸用） |

## 怎麼跑

```bash
node docs/design-handoff/group-trip/verify-tools/make-pages.js            # 產頁面到 $OUT（預設系統暫存資料夾的 group-trip-pages）
(cd "$(node -e "console.log(require('path').join(require('os').tmpdir(),'group-trip-pages'))")" && python3 -m http.server 8765 &)
python3 -m http.server 8766 &                                             # 在 repo 根目錄；verify3 的 /v/ 分享連結要用
node docs/design-handoff/group-trip/verify-tools/verify4.js
node docs/design-handoff/group-trip/verify-tools/verify3.js
```

- 輸出每行 ✅／❌；沒有 ❌ 才算過。
- 驗證沒分組行程「與改前相同」時，`main-*.html` 是 `BASE_REF` 的樣板。包 5 的基準請維持 `62a76e9`（沒分組沒 Firebase 的行程從分組功能加入前到現在都不該有差異）。
- 包 5：`node verify5.js`（不需要 python 伺服器，它自己起）。
- **限制（包 4 當時）**：Firebase 模擬後端（`generator/generator-app.js` 的 `PREVIEW_MOCK_FB`）是每個頁面各自一份記憶體，**不會跨頁／跨瀏覽器同步**。包 5 的「兩個瀏覽器」驗收（5-1 ～ 5-14）沒辦法用它直接驗，見 package-5-handoff.md。
