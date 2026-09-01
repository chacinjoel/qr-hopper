const CACHE='hopperlink-pixelstream-v081';
const ASSETS=['./','./index.html','./styles.css?v=081','./photometric-lock.css?v=081','./binary-stage.css?v=081','./binary-tag-bridge.js?v=081','./binary-tag-status.js?v=081','./safe-color-constellation.js?v=081','./hps7.js?v=081','./color-warmup.js?v=081','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));