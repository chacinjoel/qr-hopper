const CACHE='hopperlink-pixelstream-v073';
const ASSETS=['./','./index.html','./styles.css?v=073','./photometric-lock.css?v=073','./corner-geometry-guard.js?v=073','./safe-color-constellation.js?v=073','./hps7.js?v=073','./color-warmup.js?v=073','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));