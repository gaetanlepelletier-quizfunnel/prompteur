// Réseau d'abord (les mises à jour arrivent dès la réouverture), copie en cache si hors ligne.
const CACHE = 'prompteur-v9';
const ASSETS = ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const net = fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.respondWith((async () => {
    const cached = caches.match(e.request, { ignoreSearch: true });
    // Réseau lent (mauvaise réception) : après 3 s, on ouvre la copie enregistrée si elle existe.
    const slow = new Promise(r => setTimeout(r, 3000)).then(() => cached);
    try {
      const res = await Promise.race([net, slow.then(c => c || net)]);
      return res || net;
    } catch {
      return (await cached) || Response.error();
    }
  })());
});
