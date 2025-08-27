
const CACHE_NAME = 'cleaning-pwa-v1';
const ASSETS = [
  '/', '/index.html', '/manifest.json', '/service-worker.js',
  '/jsQR.min.js', '/qrcode.min.js',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k!==CACHE_NAME)?caches.delete(k):null)))
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (ASSETS.includes(url.pathname)) {
    // cache-first for static
    event.respondWith(
      caches.match(event.request).then(resp => resp || fetch(event.request))
    );
    return;
  }
  // network-first for API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(()=>new Response(JSON.stringify({ offline:true }), { headers:{'Content-Type':'application/json'} }))
    );
    return;
  }
  // default: try cache, then network
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
