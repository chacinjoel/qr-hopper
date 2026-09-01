const CACHE='hopperlink-pixelstream-v099c';
const ASSETS=['./','./index.html','./styles.css?v=099c','./photometric-lock.css?v=099c','./binary-stage.css?v=099c','./runtime-syntax-guard.js?v=099c','./binary-tag-bridge-fast.js?v=099c','./binary-tag-status.js?v=099c','./safe-color-constellation.js?v=099c','./hps7-duallane-v2.js?v=099c','./hps7-manual-max.js?v=098','./hps7.js?v=090core','./color-warmup.js?v=099c','./transfer-telemetry.js?v=099c','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
