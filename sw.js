/* Cüzdanım PWA Service Worker v37 */
const APP_CACHE = 'cuzdanim-app-v37b';
const CDN_CACHE = 'cuzdanim-cdn-v37';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== CDN_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isLiveApiRequest(url) {
  if (url.hostname.endsWith('supabase.co')) return true;
  if (url.hostname === 'open.er-api.com') return true;
  return false;
}

function fetchWithTimeout(input, init, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(input, init).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isLiveApiRequest(url)) return;

  // 1) HTML / Sayfa açılışı: Network-First (güncelleme anında gelir, çevrimdışıyken önbellekten açılır)
  if (req.mode === 'navigate' || (url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')))) {
    event.respondWith(
      fetchWithTimeout(req.url, { cache: 'no-cache', credentials: 'same-origin' }, 3500)
        .then((res) => {
          if (res && res.ok) {
            const copy1 = res.clone();
            const copy2 = res.clone();
            caches.open(APP_CACHE).then((c) => {
              c.put('./index.html', copy1).catch(() => {});
              c.put(req.url, copy2).catch(() => {});
            });
          }
          return res;
        })
        .catch(() =>
          caches.match(req.url)
            .then((m) => m || caches.match('./index.html'))
            .then((m) => m || caches.match('./'))
        )
    );
    return;
  }

  // 2) CDN kütüphaneleri & yazı tipleri: Stale-While-Revalidate (anında açılış + çevrimdışı destek)
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const networkPromise = fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          }).catch(() => cached);
          return cached || networkPromise;
        })
      )
    );
    return;
  }

  // 3) Aynı kaynak statik dosyalar (ikonlar, manifest): Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const networkPromise = fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
            return res;
          }).catch(() => cached);
          return cached || networkPromise;
        })
      )
    );
  }
});
