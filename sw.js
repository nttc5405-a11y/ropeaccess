// 繩索受力分析系統 - Service Worker v2
// 策略：HTML/JS 用 network-first（總是抓最新），靜態資源 cache-first
const CACHE = 'rope-analysis-v2';
const ASSETS = ['./manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
  // 立即取代舊版 SW
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // HTML / JSON / 主要文件 → network-first（避免更新後看到舊版）
  const isDoc = e.request.mode === 'navigate'
             || e.request.destination === 'document'
             || url.pathname.endsWith('/')
             || url.pathname.endsWith('.html')
             || url.pathname.endsWith('.webmanifest');

  if (isDoc) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok && url.origin === location.origin) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // 其他資源（圖示、CDN 腳本）→ cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        if (resp && resp.ok && url.origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});

// 接收主執行緒指令立即更新
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
