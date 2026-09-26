// 舊版東北賞櫻 App（2026-04）遺留的 Service Worker。首頁已在 42e8ebd 改為導引頁，
// 現在沒有任何頁面會呼叫 register("sw.js") 了——但 4/14～5/5 間造訪過首頁的瀏覽器可能
// 還留著這支舊版，範圍是整個網站根目錄，會讓那些使用者一直拿到安裝當下的舊快取。
// 這支新版只做一件事：清掉自己的快取、卸載自己，讓那些瀏覽器脫離控制。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    self.clients.claim()
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then(clientList => clientList.forEach(client => client.navigate(client.url)))
  );
});
