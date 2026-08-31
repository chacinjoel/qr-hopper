const CACHE='hopperlink-pixelstream-v052';
const ASSETS=['./','./index.html','./styles.css?v=052','./fiducial-filter.css?v=052','./fiducial-filter.js?v=052','./hps5.js?v=052','./repair-preroll.js?v=052','./manifest.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));