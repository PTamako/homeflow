import {json,sha256} from './security.js'
const allowed=new Set(['image/jpeg','image/png','image/webp'])
const signatures={
  'image/jpeg':buf=>buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff,
  'image/png':buf=>buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4e&&buf[3]===0x47,
  'image/webp':buf=>String.fromCharCode(...buf.slice(0,4))==='RIFF'&&String.fromCharCode(...buf.slice(8,12))==='WEBP'
}
export async function mediaRoute(request,env,path,session){
  const db=env.DB,h=session.household_id,u=session.user_id
  if(path==='/api/media'&&request.method==='GET'){
    const {results}=await db.prepare(`SELECT a.id,a.memory_id AS memoryId,a.mime_type AS mimeType,a.byte_size AS byteSize,
      a.created_at AS createdAt FROM media_assets a JOIN memories m ON m.id=a.memory_id WHERE a.household_id=?1
      AND (m.visibility='household' OR m.created_by=?2)
      ORDER BY a.created_at DESC LIMIT 120`).bind(h,u).all()
    return json({items:results||[],cloudAvailable:!!env.MEDIA})
  }
  if(path==='/api/media/upload'&&request.method==='POST'){
    if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
    const url=new URL(request.url),memoryId=url.searchParams.get('memoryId')
    if(!memoryId||!/^[0-9a-f-]{36}$/.test(memoryId))return json({error:'invalid_input'},400)
    const memory=await db.prepare(`SELECT id,created_by,visibility FROM memories WHERE id=?1
      AND household_id=?2 AND (visibility='household' OR created_by=?3)`).bind(memoryId,h,u).first()
    if(!memory)return json({error:'not_found'},404)
    const mime=(request.headers.get('content-type')||'').split(';')[0].toLowerCase()
    const max=4*1024*1024
    if(!allowed.has(mime)||Number(request.headers.get('content-length')||0)>max)return json({error:'unsupported_photo'},413)
    const bytes=new Uint8Array(await request.arrayBuffer())
    if(bytes.length>max||bytes.length<16||!signatures[mime](bytes))return json({error:'unsupported_photo'},400)
    const id=crypto.randomUUID()
    const key=h+'/'+id
    const sha=await sha256(id)
    const storageKey='private/'+key+'/'+sha.slice(0,10)
    await env.MEDIA.put(storageKey,bytes,{httpMetadata:{contentType:mime}})
    try{
      await db.prepare(`INSERT INTO media_assets
        (id,household_id,uploaded_by,visibility,memory_id,storage_key,mime_type,byte_size)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
        .bind(id,h,u,memory.visibility,memoryId,storageKey,mime,bytes.length).run()
    }catch{
      await env.MEDIA.delete(storageKey)
      return json({error:'photo_metadata_failed'},503)
    }
    return json({ok:true,id},201)
  }
  const m=path.match(/^\/api\/media\/([0-9a-f-]{36})$/)
  if(m && request.method==='GET'){
    if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
    const photo=await db.prepare(`SELECT a.storage_key,a.mime_type FROM media_assets a JOIN memories m ON m.id=a.memory_id
      WHERE a.id=?1 AND a.household_id=?2 AND (m.visibility='household' OR m.created_by=?3)`)
      .bind(m[1],h,u).first()
    if(!photo)return json({error:'not_found'},404)
    const object=await env.MEDIA.get(photo.storage_key)
    if(!object)return json({error:'not_found'},404)
    return new Response(object.body,{headers:{'content-type':photo.mime_type,
      'cache-control':'private, max-age=60','x-content-type-options':'nosniff',
      'content-security-policy':"default-src 'none'; sandbox"}})
  }
  return json({error:'not_found'},404)
}
