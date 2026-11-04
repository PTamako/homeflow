// Photos are private to this browser/device until the user enables R2.
// The app never stores photo bytes in Cloudflare D1.
const NAME='homeflow-local-media-v1'
async function store():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(Error('本机照片存储不可用'))
    const r=indexedDB.open(NAME,1)
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('photos'))r.result.createObjectStore('photos')}
    r.onsuccess=()=>resolve(r.result)
    r.onerror=()=>reject(r.error||Error('本机相册打开失败'))
  })
}
async function compress(file:File):Promise<Blob>{
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw Error('仅支持 12MB 以下的 JPEG/PNG/WebP')
  const src=URL.createObjectURL(file)
  try{
    const image=new Image()
    image.src=src
    await image.decode()
    if(image.naturalWidth*image.naturalHeight>35000000)throw Error('图片尺寸过大')
    const ratio=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio))
    canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('图片处理失败')
    ctx.drawImage(image,0,0,canvas.width,canvas.height)
    return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('照片压缩失败')),'image/jpeg',0.8))
  }finally{URL.revokeObjectURL(src)}
}
export async function saveLocalPhoto(userId:string,memoryId:string,file:File){
  const blob=await compress(file)
  const db=await store()
  const key=userId+':'+memoryId+':'+crypto.randomUUID()
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('photos','readwrite')
    tx.objectStore('photos').put(blob,key)
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||Error('照片存储失败'))}
  })
}
export async function listLocalPhotos(userId:string,memoryId:string):Promise<Blob[]>{
  const db=await store()
  const legacy=userId+':'+memoryId
  const begin=legacy+':'
  const range=IDBKeyRange.bound(begin,begin+'\uffff')
  return new Promise<Blob[]>((resolve,reject)=>{
    const tx=db.transaction('photos','readonly'),obj=tx.objectStore('photos')
    const all=obj.getAll(range)
    const old=obj.get(legacy)
    let newFiles:Blob[]=[]
    let legacyFile:Blob|undefined
    all.onsuccess=()=>{newFiles=(all.result||[]) as Blob[]}
    old.onsuccess=()=>{legacyFile=old.result as Blob|undefined}
    tx.oncomplete=()=>{db.close();resolve(legacyFile?[legacyFile,...newFiles]:newFiles)}
    tx.onerror=()=>{db.close();reject(tx.error||Error('照片读取失败'))}
  })
}
export async function downloadLocalPhoto(blob:Blob,name:string){
  const url=URL.createObjectURL(blob)
  try{
    const a=document.createElement('a')
    a.href=url;a.download=name;a.style.display='none'
    document.body.appendChild(a);a.click();a.remove()
  }finally{
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
}


/** Restore one original locally compressed photo with an idempotent key. */
export async function restoreLocalPhoto(userId:string,memoryId:string,blob:Blob,sourceKey:string):Promise<void>{
  if(!/^[0-9a-f-]{36}$/i.test(memoryId)||blob.type!=='image/jpeg'||blob.size>5*1024*1024)
    throw new Error('照片文件无效')
  if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(sourceKey))throw new Error('照片恢复标记无效')
  const db=await store()
  return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('photos','readwrite')
    tx.objectStore('photos').put(blob,userId+':'+memoryId+':restore-'+sourceKey)
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('照片恢复失败'))}
    tx.onabort=()=>{db.close();reject(tx.error||new Error('照片恢复被取消'))}
  })
}

export async function compressPhoto(file:File):Promise<Blob>{return compress(file)}
