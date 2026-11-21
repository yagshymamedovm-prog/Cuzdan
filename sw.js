/* Cüzdanım PWA Service Worker v48 (iOS Safari 404 & Redirect Korumalı) */
const APP_CACHE = 'cuzdanim-app-v48';
const CDN_CACHE = 'cuzdanim-cdn-v48';
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

// iOS Safari, Service Worker'dan donen redirected=true yanitlari navigasyonda reddedebilir.
function cleanResponse(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.arrayBuffer().then((buf) => {
    const headers = new Headers(res.headers);
    return new Response(buf, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  });
}

function precacheOne(cache, url) {
  return fetch(url, { cache: 'reload', credentials: 'same-origin', redirect: 'follow' })
    .then((res) => {
      if (!res || !res.ok) return null;
      return cleanResponse(res).then((clean) => cache.put(url, clean));
    })
    .catch(() => null);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => precacheOne(cache, u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== APP_CACHE && k !== CDN_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

function getCachedShell() {
  return caches.open(APP_CACHE)
    .then((cache) => cache.match('./index.html').then((m) => m || cache.match('./')))
    .then((m) => (m ? cleanResponse(m) : m));
}

function cacheAndReturnShell(res) {
  return cleanResponse(res).then((clean) => {
    const c1 = clean.clone();
    const c2 = clean.clone();
    caches.open(APP_CACHE).then((cache) => {
      cache.put('./index.html', c1).catch(() => {});
      cache.put('./', c2).catch(() => {});
    });
    return clean;
  });
}

function fetchAppShellNetworkFirst(reqUrl) {
  const opts = { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' };
  return fetchWithTimeout(reqUrl, opts, 3500)
    .then((res) => {
      if (res && res.ok) return cacheAndReturnShell(res);
      // Sunucu 404/5xx donduyse (ornegin eski kisayol yolu) dogrudan ./index.html dene
      return fetchWithTimeout('./index.html', opts, 3500).then((fallbackRes) => {
        if (fallbackRes && fallbackRes.ok) return cacheAndReturnShell(fallbackRes);
        return getCachedShell();
      });
    })
    .catch(() => getCachedShell())
    .then((res) => res || new Response('Cevrimdisi — Lutfen internet baglantinizi kontrol edin.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isLiveApiRequest(url)) return;

  // 1) Sayfa acilisi / HTML: Network-First + 404/Redirect korumasi + Cevrimdisi onbellek
  if (
    req.mode === 'navigate' ||
    (url.origin === self.location.origin && (url.pathname.endsWith('/') || /\.html?$/i.test(url.pathname)))
  ) {
    event.respondWith(fetchAppShellNetworkFirst(req.url));
    return;
  }

  // 2) CDN kutuphaneleri & yazi tipleri: Stale-While-Revalidate (aninda acilis + cevrimdisi destek)
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

  // 3) Ayni kaynak statik dosyalar (ikonlar, manifest): Stale-While-Revalidate
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
