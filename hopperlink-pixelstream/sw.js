const CACHE='hopperlink-pixelstream-v074';
const ASSETS=['./','./index.html','./styles.css?v=074','./photometric-lock.css?v=074','./monochrome-fiducials.css?v=074','./corner-geometry-guard.js?v=074','./safe-color-constellation.js?v=074','./hps7.js?v=074','./color-warmup.js?v=074','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));