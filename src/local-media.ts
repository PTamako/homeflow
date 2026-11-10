// Legacy device photo reader/remover only. New uploads and ZIP restores go to private R2.
// Do not add IndexedDB photo writes; photos never reside in D1.
const NAME='homeflow-local-media-v1'
// Access only an existing legacy database. Reading cloud-only albums must not
// create an empty IndexedDB database merely to look for older local pictures.
async function store():Promise<IDBDatabase|null> {
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return resolve(null)
    const r=indexedDB.open(NAME,1)
    let abortedNewDatabase=false
    r.onupgradeneeded=()=>{
      abortedNewDatabase=true
      r.transaction?.abort()
    }
    r.onsuccess=()=>resolve(r.result)
    r.onerror=()=>abortedNewDatabase?resolve(null):reject(r.error||Error('本机相册打开失败'))
  })
}
export const MAX_PHOTO_BYTES=300*1024
/** Both cloud and offline photos use <= 300KiB JPEG. Quality-only compression
 * is insufficient for noisy iPhone images, so dimensions also shrink. */
async function compress(file:File):Promise<Blob>{
  // iOS may return HEIC/HEIF (or an empty MIME for a .heic file).
  // Decode in-browser when supported; upload only the compressed JPEG.
  const mime=file.type.toLowerCase()
  const accepted=/^image\/(jpeg|png|webp|heic|heif|heic-sequence|heif-sequence)$/.test(mime)||
    (!mime&&/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))
  if(!accepted||file.size>12*1024*1024)
    throw Error('仅支持 12MB 以下的 JPEG/PNG/WebP/HEIC/HEIF')
  const isHeic=/heic|heif/i.test(mime)||/\.(heic|heif)$/i.test(file.name)
  const src=URL.createObjectURL(file)
  let bitmap:ImageBitmap|null=null
  try{
    const image=new Image()
    image.src=src
    let decoded:CanvasImageSource=image
    let naturalWidth=0,naturalHeight=0
    try{
      await image.decode()
      naturalWidth=image.naturalWidth
      naturalHeight=image.naturalHeight
    }catch{
      // WebKit's native Image decoder and ImageBitmap have different
      // capabilities across iOS versions; try both without storing a copy.
      if(typeof createImageBitmap==='function'){
        try{bitmap=await createImageBitmap(file)}catch{}
      }
      if(!bitmap)throw Error(isHeic?
        '当前设备无法解码 HEIC/HEIF，请先将照片转换为 JPEG 后上传':
        '图片无法读取，请选择其他照片重试')
      decoded=bitmap
      naturalWidth=bitmap.width
      naturalHeight=bitmap.height
    }
    if(!naturalWidth||!naturalHeight||naturalWidth*naturalHeight>35000000)throw Error('图片尺寸过大')
    const ratio=Math.min(1,1600/Math.max(naturalWidth,naturalHeight))
    const canvas=document.createElement('canvas')
    let width=Math.max(1,Math.round(naturalWidth*ratio))
    let height=Math.max(1,Math.round(naturalHeight*ratio))
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('图片处理失败')
    const jpeg=(quality:number)=>new Promise<Blob>((resolve,reject)=>
      canvas.toBlob(blob=>blob?resolve(blob):reject(Error('照片压缩失败')),'image/jpeg',quality))
    for(let step=0;step<12;step++){
      canvas.width=width;canvas.height=height
      ctx.drawImage(decoded,0,0,width,height)
      for(const quality of [0.82,0.68,0.52,0.38,0.24]){
        const blob=await jpeg(quality)
        if(blob.size<=MAX_PHOTO_BYTES)return blob
      }
      if(width<=64&&height<=64)break
      width=Math.max(1,Math.round(width*0.76))
      height=Math.max(1,Math.round(height*0.76))
    }
    throw Error('照片无法压缩到 300KB 以下')
  }finally{bitmap?.close();URL.revokeObjectURL(src)}
}
export async function listLocalPhotos(userId:string,memoryId:string):Promise<Blob[]>{
  const db=await store()
  if(!db)return []
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


export async function compressPhoto(file:File):Promise<Blob>{return compress(file)}

/** Remove exactly one device photo after a successful R2 upload or manual delete. */
export async function deleteLocalPhoto(userId:string,memoryId:string,index:number):Promise<void>{
  const db=await store()
  if(!db)throw Error('没有需要删除的本机旧照片')
  const base=userId+':'+memoryId
  const tx=db.transaction('photos','readonly')
  const obj=tx.objectStore('photos')
  const keys=obj.getAllKeys(IDBKeyRange.bound(base+':',base+':\uffff'))
  const legacy=obj.get(base)
  const all=await new Promise<IDBValidKey[]>((resolve,reject)=>{
    tx.oncomplete=()=>resolve([...(legacy.result?[base]:[]),...(keys.result||[])])
    tx.onerror=()=>reject(tx.error||Error('本机照片读取失败'))
  }).catch(e=>{db.close();throw e})
  if(!Number.isSafeInteger(index)||index<0||index>=all.length){db.close();throw Error('照片序号已失效')}
  await new Promise<void>((resolve,reject)=>{
    const write=db.transaction('photos','readwrite')
    write.objectStore('photos').delete(all[index])
    write.oncomplete=()=>resolve()
    write.onerror=()=>reject(write.error||Error('本机照片删除失败'))
  }).finally(()=>db.close())
}
