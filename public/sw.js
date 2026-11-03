// Cache only same-origin static assets; NEVER cache private /api endpoints.
const CACHE='homeflow-shell-v1'
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/icon.svg','/manifest.webmanifest'])))
  self.skipWaiting()
})
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('homeflow-shell-')&&k!==CACHE).map(k=>caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url)
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(response=>{
      if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,clone)))}
      return response
    }).catch(()=>caches.match(req).then(x=>x||caches.match('/'))))
    return
  }
  event.respondWith(caches.match(req).then(found=>found||fetch(req).then(res=>{
    if(res.ok && (url.pathname.startsWith('/assets/') || ['/icon.svg','/manifest.webmanifest'].includes(url.pathname))){
      const clone=res.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,clone)))
    }
    return res
  })))
})
