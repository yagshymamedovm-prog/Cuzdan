/* Cüzdanım PWA Service Worker v59 (Anında Önbellek Açılışı + Çevrimdışı & Düşük İnternet Korumalı) */
const APP_CACHE = 'cuzdanim-app-v59';
const CDN_CACHE = 'cuzdanim-cdn-v59';
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

function cleanResponse(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.arrayBuffer().then((buf) => {
    const headers = new Headers(res.headers);
    return new Response(buf, { status: res.status, statusText: res.statusText, headers });
  });
}

function precacheOne(cache, url) {
  return fetch(url, { cache: 'reload', credentials: 'same-origin', redirect: 'follow' })
    .then((res) => (res && res.ok) ? cleanResponse(res).then((clean) => cache.put(url, clean)) : null)
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
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isLiveApiRequest(url) {
  if (url.hostname.endsWith('supabase.co')) return true;
  if (url.hostname === 'open.er-api.com') return true;
  if (url.hostname === 'api.aladhan.com') return true;
  return false;
}

function notifyClientsUpdated() {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => { try { c.postMessage({ type: 'APP_UPDATED' }); } catch (e) {} });
  }).catch(() => {});
}

function getCachedShell() {
  return caches.open(APP_CACHE)
    .then((cache) => cache.match('./index.html').then((m) => m || cache.match('./')))
    .then((m) => (m ? cleanResponse(m) : m));
}

function revalidateAppShell(reqUrl, hadCached, cachedEtag, cachedLen) {
  const opts = { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' };
  return fetch(reqUrl, opts)
    .then((res) => (res && res.ok) ? res : fetch('./index.html', opts))
    .then((res) => {
      if (!res || !res.ok) return null;
      return cleanResponse(res).then((clean) => {
        const newEtag = clean.headers.get('etag') || clean.headers.get('last-modified') || '';
        const newLen = clean.headers.get('content-length') || '';
        const c1 = clean.clone();
        const c2 = clean.clone();
        return caches.open(APP_CACHE).then((cache) =>
          Promise.all([cache.put('./index.html', c1), cache.put('./', c2)])
            .then(() => {
              if (hadCached && ((newEtag && cachedEtag && newEtag !== cachedEtag) || (newLen && cachedLen && newLen !== cachedLen))) {
                notifyClientsUpdated();
              }
              return clean;
            })
        );
      });
    })
    .catch(() => null);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isLiveApiRequest(url)) return;

  // 1) Sayfa acilisi / HTML: Aninda Onbellek (Stale-While-Revalidate) -> 0ms bekleme + arka planda guncelleme
  if (
    req.mode === 'navigate' ||
    (url.origin === self.location.origin && (url.pathname.endsWith('/') || /\.html?$/i.test(url.pathname)))
  ) {
    event.respondWith(
      getCachedShell().then((cached) => {
        const cachedEtag = cached ? (cached.headers.get('etag') || cached.headers.get('last-modified') || '') : '';
        const cachedLen = cached ? (cached.headers.get('content-length') || '') : '';
        const netPromise = revalidateAppShell(req.url, !!cached, cachedEtag, cachedLen);
        if (cached) {
          event.waitUntil(netPromise);
          return cached;
        }
        return netPromise.then((res) => res || new Response('Cevrimdisi — Lutfen internet baglantinizi kontrol edin.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        }));
      })
    );
    return;
  }

  // 2) CDN kutuphaneleri & yazi tipleri: Stale-While-Revalidate
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const networkPromise = fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
            return res;
          }).catch(() => cached);
          if (cached) {
            event.waitUntil(networkPromise);
            return cached;
          }
          return networkPromise;
        })
      )
    );
    return;
  }

  // 3) Ayni kaynak statik dosyalar (ikonlar, manifest): Stale-While-Revalidate (tekil anahtar)
  if (url.origin === self.location.origin) {
    const cleanKey = url.origin + url.pathname;
    event.respondWith(
      caches.open(APP_CACHE).then((cache) =>
        cache.match(cleanKey, { ignoreSearch: true }).then((cached) => {
          const networkPromise = fetch(req).then((res) => {
            if (res && res.ok) cache.put(cleanKey, res.clone()).catch(() => {});
            return res;
          }).catch(() => cached);
          if (cached) {
            event.waitUntil(networkPromise);
            return cached;
          }
          return networkPromise;
        })
      )
    );
  }
});
