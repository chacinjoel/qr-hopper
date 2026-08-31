const CACHE='hopperlink-pixelstream-v043';
const ASSETS=['./','./index.html','./styles.css?v=043','./manual-arq.js?v=043','./color-assist.js?v=043','./pass-hold.js?v=043','./hps4.js?v=043','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));
