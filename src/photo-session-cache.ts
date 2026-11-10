// Private, in-memory photo cache. No CacheStorage, IndexedDB or localStorage.
// Bounded for mobile RAM and scoped to the logged-in account.
const MAX_ITEMS=24
const MAX_BYTES=8*1024*1024
const TTL=8*60*1000
type Entry={url:string;size:number;last:number}
const cached=new Map<string,Entry>()
const pending=new Map<string,Promise<string>>()
const versions=new Map<string,number>()
let account='',generation=0,bytes=0

function discard(id:string){
 const entry=cached.get(id)
 if(!entry)return
 cached.delete(id);bytes-=entry.size
 URL.revokeObjectURL(entry.url)
}
function trim(){
 const now=Date.now()
 for(const [id,entry] of cached)if(now-entry.last>TTL)discard(id)
 while(cached.size>MAX_ITEMS||bytes>MAX_BYTES){
  const oldest=cached.keys().next().value
  if(oldest===undefined)break
  discard(oldest)
 }
}
export function setPhotoCacheUser(userId:string){
 if(account===userId)return
 generation++
 account=userId
 for(const id of [...cached.keys()])discard(id)
 pending.clear();versions.clear()
}
export function invalidatePhoto(userId:string,id:string){
 setPhotoCacheUser(userId)
 versions.set(id,(versions.get(id)||0)+1)
 discard(id);pending.delete(id)
}
export function clearPhotoCache(){
 generation++
 for(const id of [...cached.keys()])discard(id)
 pending.clear();versions.clear();account=''
}
export async function readPhoto(userId:string,id:string):Promise<string>{
 setPhotoCacheUser(userId)
 trim()
 const prior=cached.get(id)
 if(prior){
  cached.delete(id);prior.last=Date.now();cached.set(id,prior)
  return prior.url
 }
 const running=pending.get(id)
 if(running)return running
 const token=generation,version=versions.get(id)||0
 const task=(async()=>{
  const res=await fetch('/api/media/'+encodeURIComponent(id),{
   credentials:'same-origin',cache:'no-store'
  })
  if(!res.ok)throw Error('照片读取失败，请稍后重试')
  const photo=await res.blob()
  if(photo.size>300*1024||!photo.type.startsWith('image/'))
   throw Error('照片格式不支持')
  if(token!==generation||version!==(versions.get(id)||0)||account!==userId)
   throw Error('照片已更新，请重新打开')
  const url=URL.createObjectURL(photo)
  cached.set(id,{url,size:photo.size,last:Date.now()})
  bytes+=photo.size
  trim()
  return url
 })()
 pending.set(id,task)
 try{return await task}
 finally{if(pending.get(id)===task)pending.delete(id)}
}
