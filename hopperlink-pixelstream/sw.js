const CACHE='hopperlink-one-v1200';
const ASSETS=[
  './',
  './index.html',
  './premium-one.css?v=1200',
  './premium-one-receiver.css?v=1200',
  './premium-one-fullscreen.css?v=1200',
  './hopper-one.js?v=1200',
  './hopper-one.runtime.json?v=1200',
  './runtime/hopper-one.bundle-01.txt?v=1200',
  './runtime/hopper-one.bundle-02.txt?v=1200',
  './manifest.json'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all(ASSETS.map(async rel=>{
      const url=new URL(rel,self.location).href;
      const response=await fetch(new Request(url,{cache:'reload'}));
      if(!response.ok)throw new Error(`HopperLink ONE cache failed: ${rel} ${response.status}`);
      await cache.put(url,response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(request);
        const cache=await caches.open(CACHE);
        cache.put(request,fresh.clone());
        return fresh;
      }catch{
        return (await caches.match(request))||(await caches.match('./index.html'));
      }
    })());
    return;
  }
  event.respondWith((async()=>{
    const cached=await caches.match(request,{ignoreSearch:false});
    if(cached)return cached;
    const fresh=await fetch(request);
    const cache=await caches.open(CACHE);
    cache.put(request,fresh.clone());
    return fresh;
  })());
});
