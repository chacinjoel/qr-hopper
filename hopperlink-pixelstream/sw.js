const CACHE='hopperlink-pixelstream-v097';
const ASSETS=['./','./index.html','./styles.css?v=097','./photometric-lock.css?v=097','./binary-stage.css?v=097','./runtime-syntax-guard.js?v=097','./binary-tag-bridge.js?v=097','./binary-tag-status.js?v=097','./safe-color-constellation.js?v=097','./hac5-control.js?v=097','./hps7-runtime-hac5.js?v=097','./hps7.js?v=090core','./color-warmup.js?v=090','./transfer-telemetry.js?v=090','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
