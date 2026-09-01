const CACHE='hopperlink-pixelstream-v083';
const ASSETS=['./','./index.html','./styles.css?v=083','./photometric-lock.css?v=083','./binary-stage.css?v=083','./binary-tag-bridge.js?v=083','./binary-tag-status.js?v=083','./safe-color-constellation.js?v=083','./hps7-runtime.js?v=083','./hps7.js?v=083core','./color-warmup.js?v=083','./transfer-telemetry.js?v=083','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));