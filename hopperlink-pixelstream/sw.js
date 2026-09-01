const CACHE='hopperlink-pixelstream-v075';
const ASSETS=['./','./index.html','./styles.css?v=075','./photometric-lock.css?v=075','./monochrome-fiducials.css?v=075','./corner-geometry-guard.js?v=075','./safe-color-constellation.js?v=075','./hps7.js?v=075','./color-warmup.js?v=075','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));