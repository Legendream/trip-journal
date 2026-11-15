# 旅人手帖（trip-journal）— 給 Claude 的專案守則

> 2026-10-17 建立。這個檔案會隨 Netlify 公開（`publish = "."`），不放金鑰或私人內容。

## 守護清單：已經能用的行為，不能被順手改掉

改任何程式之前，先看這張表。**如果這次的改動會影響表中任何一項（包括為了修 bug），先停下來告訴 Claire：會影響哪一項、改完會變成怎樣，等她同意才動手。** 不能自己判斷「這樣比較好」就改。

立這份清單的原因：2026-09-17 為了修「非標準時間被清空」，把景點時間的時間選擇器換成數字鍵盤文字框，結果 Android 打不出冒號，也沒有選單可以挑；直到 10/17 Claire 實際用到才發現（見 `docs/acceptance/time-field.md`）。

| # | 行為 | 在哪裡 | 依據 |
|---|---|---|---|
| G1 | 行程 App 新增／編輯景點、產生器的活動與航班時間，都可以用原生時間選擇器挑時間（手機不能退回只有數字鍵盤的文字框） | `_itinTimeFieldHtml`（樣板）、`actTimeFieldHtml`（產生器） | Ado 行程截圖；`docs/acceptance/time-field.md` |
| G2 | 時間是「夜」「上午」這類非標準文字時，打開表單再存檔或匯出，原文字不被清空 | 同上 | 舊 repo commit `5b02040`；`docs/acceptance/time-field.md` |
| G3 | 集合時間用原生時間選擇器 | `m-time` | 現有程式 |
| G4 | 有地圖分享連結或精確定位的景點顯示天氣；太遠的日期顯示「出發前約兩週才有天氣」；載入中顯示 ⏳，不能直接空白 | `getWeatherCapsule` 等 | `docs/acceptance/map-link-location.md`（已確認） |
| G5 | 天氣只用使用者指定的位置（地圖連結或精確定位），不用地名猜——Claire 要精確的天氣。新版分享連結沒有座標時，用連結裡的地點代碼換算位置（`_placeIdLatLon`，產生器與樣板逐字相同） | 同上 | `docs/use-cases/map-link-location.md`；`docs/acceptance/map-link-place-id.md`；2026-10-17 Claire 再次確認 |
| G6 | 景點依時間自動排序；沒有「時:分」的景點不被移動 | `_timeMin`、`_insertByTime`、`_minimalTimeOrder` | 程式註解；`build-template.js --check` 會比對 |
| G7 | 陽春版（分享連結）與進階版（Firebase）的同步範圍照 PLAN.md 的表；行前清單、購物清單一律只存本機 | 整個樣板 | `PLAN.md`「App 各功能同步範圍」 |
| G8 | 分享連結的行程資料放在網址 `#` 後面，不送到伺服器 | `/v/` | `PLAN.md`「檢視器」 |
| G9 | 每個分享行程是各自獨立、可同時安裝的 App | manifest 的 `id` | PR #8 |
| G10 | 住宿可標「未訂」、複製到多天、套用到同一間其他晚；未訂住宿不出現在海報 | 樣板與產生器 | `docs/acceptance/lodging-status.md` |
| G11 | 沒有分組的行程，產生器匯出結果與分組功能上線前相同 | 產生器 | `scripts/fixtures/no-group`、`test-group-trip.js` |
| G13 | 沒有天氣的天要看得見原因：產生器日卡「這天沒有天氣」標籤＋最後一步摘要；App 在那天第一個景點說明「沒有貼地圖連結」 | `dayWxState`、`renderWxSummary`（產生器）、`_noWxNoteHtml`（樣板） | `docs/acceptance/weather-hint.md` |
| G12 | 示範行程 `trip-app-v2/` 不手動修改；樣板改了就用 `node scripts/build-demo.js` 重新產生 | `trip-app-v2/` | `PLAN.md`；2026-10-17 Claire 確認跟著樣板同步 |
| G14 | 行程 App 可改每日標題（按日卡存，分組各組分開）、可恢復原本標題並復原；日卡、海報、選天選單、分享文字都顯示改過的標題；同步範圍跟景點相同 | `_theme`、`showDayThemeForm`（樣板） | `docs/acceptance/day-theme-home-name.md` |
| G15 | 分組由 AI 從草稿找出：第一步「有分頭」只有開關＋說明；匯入以 AI 的 `groups` 建立成員與組別（最多 3 組）；沒分組時整理指令只多「程式碼框」一行；匯入能讀 Gemini 複製格式、貼到整理指令時直接說明 | `groupsFromImport`、`buildGroupSection`、`importAiJson` | `docs/acceptance/group-ai-detect.md` |
| G16 | 景點圖示：6 大類 41 個精選 emoji，AI 與使用者共用；介面只顯示大類名稱（交通、住宿、飲食、遊覽、購物、其他）＋「自訂」可放任何 emoji；AI 挑清單以外的匯入時換成 📍；不顯示每天的 emoji | `ICON_CATALOG`（產生器）、`ITIN_ICON_CATALOG`（樣板，兩份要相同） | `docs/acceptance/activity-icons.md` |
| G17 | 整趟海報下方沒有網址列（圖片上的網址與 QR code 保留）；單日海報不邀請使用產生器 | 樣板的海報分享視窗 | `docs/acceptance/activity-icons.md` J6 |
| G18 | 品牌名稱「旅　人　手　帖」在手機（320px 起）首頁頂部、首頁大標題、產生器頂部都一行顯示 | `index.html`、`generator/index.html` 的 CSS | `docs/acceptance/brand-title-wrap.md` |
| G19 | 首頁「雜誌左邊線」排版：首屏（小字、品牌名稱＋墨線、說明、標籤）與各區標題靠左、上方墨線，和下方卡片左緣對齊；結尾「翻開手帖」維持置中；手機與桌機一致 | `index.html` 的 `.hero*`、`.section-header`、`.section-eyebrow` | `docs/acceptance/landing-b-bird-logo.md` L1–L5 |
| G20 | 品牌圖記「飛鳥與手帖」全站一致：首頁頂部、產生器頂部、`icon.svg`／`v/icon.svg`、`favicon.svg`（小尺寸加粗）、分享行程 App 圖示（產生器下載版、Android 圓形裁切版、`/v/` 版，底色用行程主題色）、樣板 `.trip-mark` | 上述檔案；`buildTripIconSvg`、`buildTripIconMaskableSvg`、`generateIconSvg` | `docs/acceptance/landing-b-bird-logo.md` L6–L10 |

新功能合併後，把它「做完後應有的行為」補進這張表（一行一項，附依據）。

## 改完必跑的檢查

```
node scripts/build-template.js --check
node scripts/test-group-trip.js
node scripts/test-map-link.js
```

三支都要通過才算改完。動到守護清單裡的行為時，還要在瀏覽器實際操作那一項，並在 PR 說明逐條寫結果。

## 檔案的來源與產物

- 行程 App 樣板只改 `generator/template-src.html`，改完跑 `node scripts/build-template.js` 產生 `generator/generator-template.js`，再跑 `node scripts/build-demo.js` 更新示範行程。不要直接改這兩個產物。
- 開發流程（分支 → 驗收條件 → PR）照 Claire 的全域規則，這裡不重複。
