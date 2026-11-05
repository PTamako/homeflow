// Cache only same-origin static assets; NEVER cache private /api endpoints.
const CACHE='homeflow-shell-v4'
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'])))
  self.skipWaiting()
})
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('homeflow-shell-')&&k!==CACHE).map(k=>caches.delete(k)))))
  self.clients.claim()
})
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url)
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/vapid-'))return
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-store'}).then(response=>{
      if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,clone)))}
      return response
    }).catch(()=>caches.match(req).then(x=>x||caches.match('/'))))
    return
  }
  event.respondWith(caches.match(req).then(found=>found||fetch(req).then(res=>{
    if(res.ok && (url.pathname.startsWith('/assets/') || ['/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'].includes(url.pathname))){
      const clone=res.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,clone)))
    }
    return res
  })))
})

self.addEventListener('push',event=>{
  let msg={title:'HomeFlow · 今日提醒',body:'你有新的家庭待办',url:'/',tag:'homeflow-reminder'}
  try{
    if(event.data){const data=event.data.json();if(data&&typeof data==='object')msg={...msg,...data}}
  }catch{}
  const title=String(msg.title||'HomeFlow · 今日提醒').slice(0,90)
  event.waitUntil((async()=>{
    await self.registration.showNotification(title,{
      body:String(msg.body||'').slice(0,150),
      tag:String(msg.tag||'homeflow-reminder').slice(0,180),
      icon:'/icon-192.png',badge:'/icon-192.png',
      data:{url:(()=>{try{
        const url=new URL(String(msg.url||'/'),self.location.origin)
        if(url.origin!==self.location.origin||url.pathname!=='/')return '/'
        return url.pathname+url.search
      }catch{return '/'}})()}
    })
    if(msg.recordInInbox===true){
      // iOS installed Home Screen PWAs support badges after push permission.
      // A dot is enough here; the page will synchronize the exact unread count.
      try{await self.navigator.setAppBadge?.()}catch{}
      const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true})
      for(const page of pages)page.postMessage({type:'homeflow-notification-pushed'})
    }
  })())
})
self.addEventListener('notificationclick',event=>{
  event.notification.close()
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
    const path=event.notification.data?.url||'/'
    const target=new URL(path,self.location.origin)
    if(target.origin!==self.location.origin)return
    for(const client of list){
      if(new URL(client.url).origin===self.location.origin){
        if(target.searchParams.has('taskId')){
          client.postMessage({type:'homeflow-open-task',
            kind:target.searchParams.get('taskType'),id:target.searchParams.get('taskId'),
            completed:target.searchParams.get('taskDone')==='1',
            periodKey:target.searchParams.get('taskPeriod'),
            notificationId:target.searchParams.get('notificationId')})
        }else if(target.searchParams.has('notificationId')){
          client.postMessage({type:'homeflow-open-notification',
            id:target.searchParams.get('notificationId')})
        }
        await client.focus();return
      }
    }
    await self.clients.openWindow(target.href)
  }))
})
