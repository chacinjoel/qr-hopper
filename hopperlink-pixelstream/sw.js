const CACHE='hopperlink-pixelstream-v099';
const ASSETS=['./','./index.html','./styles.css?v=099','./photometric-lock.css?v=099','./binary-stage.css?v=099','./runtime-syntax-guard.js?v=099','./binary-tag-bridge-fast.js?v=099','./binary-tag-status.js?v=099','./safe-color-constellation.js?v=099','./hps7-duallane.js?v=099','./hps7-manual-max.js?v=098','./hps7.js?v=090core','./color-warmup.js?v=099','./transfer-telemetry.js?v=099','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
