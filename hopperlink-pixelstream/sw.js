const CACHE='hopperlink-pixelstream-v0914fix1';
const ASSETS=['./','./index.html','./styles.css?v=0914','./photometric-lock.css?v=0914','./binary-stage.css?v=0914','./runtime-syntax-guard.js?v=0914','./binary-tag-bridge-fast.js?v=0914','./binary-tag-status.js?v=0914','./safe-color-constellation.js?v=0914','./premium-flow-ui.js?v=0914','./hps7-projection.js?v=0914','./repair-reacquisition.js?v=0914','./hps7-duallane-v2.js?v=0914fix1','./hps7-manual-max.js?v=098','./hps7.js?v=090core','./color-warmup.js?v=099','./transfer-telemetry.js?v=099','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
