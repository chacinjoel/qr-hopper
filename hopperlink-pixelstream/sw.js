const CACHE='hopperlink-pixelstream-v046';
const ASSETS=['./','./index.html','./styles.css?v=046','./manual-arq.js?v=046','./color-assist.js?v=046','./pass-hold.js?v=046','./hps4-session-loader.js?v=046','./hps4.js?v=046core','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));