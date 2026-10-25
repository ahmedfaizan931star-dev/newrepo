const VERSION = 'offscript-shell-v5';
const API_CACHE = 'offscript-public-data-v4';
const PHOTO_CACHE = 'offscript-editorial-photos-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/admin.html', '/admin.js', '/admin.css', '/manifest.webmanifest', '/offline.html',
'/images/cover-culture.svg', '/images/cover-spaces.svg', '/images/cover-table.svg', '/images/cover-style.svg', '/images/cover-elsewhere.svg', '/images/cover-practice.svg', '/images/cover-people.svg', '/images/cover-ideas.svg', '/images/cover-plants.svg', '/images/cover-beauty.svg', '/images/editorial-still-life.webp', '/images/app-icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![VERSION, API_CACHE, PHOTO_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cache cross-origin photos after a successful first load; keep an opaque response when the CDN disallows CORS.
    if (request.destination === 'image' && /^https:\/\/(images\.unsplash\.com|images\.pexels\.com)\//i.test(url.href)) {
      event.respondWith((async () => {
        const cache = await caches.open(PHOTO_CACHE);
        const saved = await cache.match(request);
        if (saved) return saved;
        try {
          const fresh = await fetch(request);
          if (fresh.ok || fresh.type === 'opaque') await cache.put(request, fresh.clone());
          return fresh;
        } catch { return Response.error(); }
      })());
    }
    return;
  }
  if (url.pathname.startsWith('/api/admin/')) return; // Never cache private publishing data.
  if (url.pathname === '/api/articles' || url.pathname.startsWith('/api/articles/')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await (await caches.open(API_CACHE)).put(request, fresh.clone());
        return fresh;
      } catch {
        const cached = await (await caches.open(API_CACHE)).match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Offline and no saved copy exists yet.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }
    })());
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const fresh = await fetch(request); if (fresh.ok) await cache.put(request, fresh.clone()); return fresh; }
      catch { return (await cache.match(request)) || (await caches.match('/index.html')) || (await caches.match('/offline.html')); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try { const fresh = await fetch(request); if (fresh.ok) await (await caches.open(VERSION)).put(request, fresh.clone()); return fresh; }
    catch { return cached || new Response('Offline', { status: 503, statusText: 'Offline' }); }
  })());
});
