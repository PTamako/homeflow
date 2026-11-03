const DATABASE='homeflow-local-media-v1'
function database():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(Error('indexed_db_unavailable'));return}
    const request=indexedDB.open(DATABASE,1)
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos')}
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>reject(request.error||Error('indexed_db_open_failed'))
  })
}
async function operate<T>(key:string,mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await database()
  return new Promise<T>((resolve,reject)=>{
    const tx=db.transaction('photos',mode)
    const req=fn(tx.objectStore('photos'))
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error||Error('indexed_db_error'))
    tx.oncomplete=()=>db.close()
    tx.onerror=()=>{db.close();reject(tx.error||Error('indexed_db_tx_failed'))}
  })
}
async function thumbnail(file:File):Promise<Blob>{
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw Error('unsupported_photo')
  const url=URL.createObjectURL(file)
  try{
    const img=new Image()
    img.src=url
    await img.decode()
    const factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight))
    const canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(img.naturalWidth*factor))
    canvas.height=Math.max(1,Math.round(img.naturalHeight*factor))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('image_processing_unavailable')
    ctx.drawImage(img,0,0,canvas.width,canvas.height)
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('image_encoding_failed')),'image/jpeg',0.8))
  }finally{URL.revokeObjectURL(url)}
}
export async function saveLocalPhoto(userId:string,memoryId:string,file:File){
  const blob=await thumbnail(file)
  await operate(userId+':'+memoryId,'readwrite',s=>s.put(blob,userId+':'+memoryId))
}
export async function getLocalPhoto(userId:string,memoryId:string):Promise<Blob|null>{
  return await operate<Blob|undefined>(userId+':'+memoryId,'readonly',s=>s.get(userId+':'+memoryId))||null
}
