// Monopoly: No Mercy service worker. It keeps the app's own files on the device so the game opens instantly;
// live game data (/api, Supabase, realtime) always goes to the network and is never cached.
const CACHE = 'mw-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Build files have a content hash in their name and never change, so the saved copy is always right.
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|mpeg|mp3|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  // Pages come from the network first, so a new version shows at once; the saved page is only used offline.
  if (request.mode === 'navigate') event.respondWith(
    fetch(request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); return response; })
      .catch(() => caches.match(request).then(saved => saved || Response.error()))
  );
});
