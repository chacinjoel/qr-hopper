const CACHE='hopperlink-pixelstream-v096';
const ASSETS=['./','./index.html','./styles.css?v=096','./photometric-lock.css?v=096','./binary-stage.css?v=096','./runtime-syntax-guard.js?v=096','./binary-tag-bridge.js?v=096','./binary-tag-status.js?v=096','./safe-color-constellation.js?v=096','./hybrid-control.js?v=096','./hps7-runtime.js?v=096','./hps7.js?v=090core','./color-warmup.js?v=096','./transfer-telemetry.js?v=096','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
