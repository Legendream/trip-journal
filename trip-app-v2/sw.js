// 只有改了快取策略或預先快取清單才需要升版；頁面內容更新不必改這裡（見下方 fetch）
const CACHE = "tohoku2026-v2-v2";
// 只放一定存在的檔案：清單裡任何一個抓不到，新版 SW 就裝不起來，裝置會卡在舊版
const ASSETS = ["./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 網路優先：有網路就拿伺服器上的最新版並順手更新快取，離線才退回快取。
// 以前是快取優先、快取永不更新，從主畫面以 ./index.html 開啟的人會一直看到
// SW 安裝當下的舊頁面。跨網域請求（Firebase、天氣／地圖 API）不攔截。
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const fromNetwork = fetch(req);
  e.respondWith(fromNetwork.catch(() => fromCache(req)));
  // 順手把最新版存進快取，離線時才有東西可用。waitUntil 必須在事件當下呼叫；
  // clone 要緊接在拿到回應時做，趕在瀏覽器開始讀取回應內容之前
  e.waitUntil(fromNetwork.then(res => {
    if (res.status !== 200) return;
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {}));
});

function fromCache(req) {
  return caches.match(req).then(cached => {
    if (cached) return cached;
    if (req.mode === "navigate") {
      return caches.match("./index.html").then(page => page || Response.error());
    }
    return Response.error();
  });
}

// ─── Alarm Scheduling (fallback for browsers without Notification Triggers) ──

let scheduledAlarmTimer = null;

self.addEventListener("message", e => {
  if (e.data.type === "SCHEDULE_ALARM") {
    if (scheduledAlarmTimer) clearTimeout(scheduledAlarmTimer);
    const delay = e.data.timestamp - Date.now();
    if (delay > 0 && delay < 12 * 3600 * 1000) {
      scheduledAlarmTimer = setTimeout(() => {
        self.registration.showNotification("🔔 集合時間到！", {
          body: e.data.message || "現在出發！",
          vibrate: [400, 200, 400, 200, 600],
          requireInteraction: true,
          tag: "meeting-alarm"
        });
      }, delay);
    }
  } else if (e.data.type === "CANCEL_ALARM") {
    if (scheduledAlarmTimer) {
      clearTimeout(scheduledAlarmTimer);
      scheduledAlarmTimer = null;
    }
  }
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // 只挑這個 App 範圍內的分頁，避免誤帶去同網域的其他頁面（首頁／產生器）
      const inScope = list.filter(c => c.url.startsWith(self.registration.scope));
      if (inScope.length) return inScope[0].focus();
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
