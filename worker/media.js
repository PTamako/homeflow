import {json,sha256} from './security.js'

// This bucket is intentionally private. No public URLs or object keys are
// exposed. All reads and writes are scoped to a signed-in household member.
export const MAX_MEDIA_BYTES=300*1024
const allowed=new Set(['image/jpeg','image/png','image/webp'])
const signatures={
 'image/jpeg':buf=>buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff,
 'image/png':buf=>buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4e&&buf[3]===0x47,
 'image/webp':buf=>String.fromCharCode(...buf.slice(0,4))==='RIFF'&&
   String.fromCharCode(...buf.slice(8,12))==='WEBP'
}
const uuid=/^[0-9a-f-]{36}$/i

/**
 * Retry physical R2 deletes without ever exposing an object that was logically
 * deleted. The D1 media_assets row is the durable cleanup queue: only after
 * the R2 deletion succeeds is metadata removed. Safe to retry after failure.
 */
export async function runMediaCleanup(env,householdId=null){
 if(!env?.MEDIA||!env?.DB)return {skipped:true}
 const db=env.DB
 const clause=householdId?' AND household_id=?1':''
 const stmt=db.prepare(`SELECT id,household_id,storage_key FROM media_assets
   WHERE deleted_at IS NOT NULL${clause}
   ORDER BY deleted_at,id LIMIT 100`)
 const {results=[]}=await (householdId?stmt.bind(householdId):stmt).all()
 let removed=0,failed=0
 for(const photo of results){
   try{
     await env.MEDIA.delete(photo.storage_key)
     await db.prepare(`DELETE FROM media_assets
       WHERE id=?1 AND household_id=?2 AND storage_key=?3 AND deleted_at IS NOT NULL`)
       .bind(photo.id,photo.household_id,photo.storage_key).run()
     removed++
   }catch{failed++}
 }
 return {removed,failed}
}

export async function mediaRoute(request,env,path,session){
 const db=env.DB,h=session.household_id,u=session.user_id
 if(path==='/api/media'&&request.method==='GET'){
   const memoryId=new URL(request.url).searchParams.get('memoryId')
   if(memoryId&&!uuid.test(memoryId))return json({error:'invalid_input'},400)
   const query=`SELECT a.id,a.memory_id AS memoryId,a.uploaded_by AS uploadedBy,
     a.mime_type AS mimeType,a.byte_size AS byteSize,a.created_at AS createdAt
     FROM media_assets a JOIN memories m ON m.id=a.memory_id
     WHERE a.household_id=?1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL
     AND (m.visibility='household' OR m.created_by=?2)`+
     (memoryId?' AND a.memory_id=?3':'')+' ORDER BY a.created_at DESC,a.id DESC LIMIT 250'
   const {results}=await db.prepare(query).bind(...(memoryId?[h,u,memoryId]:[h,u])).all()
   return json({items:results||[],cloudAvailable:!!env.MEDIA})
 }
 if(path==='/api/media/upload'&&request.method==='POST'){
   if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
   const memoryId=new URL(request.url).searchParams.get('memoryId')
   if(!memoryId||!uuid.test(memoryId))return json({error:'invalid_input'},400)
   const memory=await db.prepare(`SELECT id,created_by,visibility FROM memories
     WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL
       AND (visibility='household' OR created_by=?3)`).bind(memoryId,h,u).first()
   if(!memory)return json({error:'not_found'},404)
   const mime=(request.headers.get('content-type')||'').split(';')[0].toLowerCase()
   const length=Number(request.headers.get('content-length')||0)
   if(!allowed.has(mime)||length>MAX_MEDIA_BYTES)return json({error:'photo_too_large_or_unsupported'},413)
   const bytes=new Uint8Array(await request.arrayBuffer())
   if(bytes.length>MAX_MEDIA_BYTES)return json({error:'photo_exceeds_300kb'},413)
   if(bytes.length<16||!signatures[mime](bytes))return json({error:'unsupported_photo'},400)
   // Idempotent ZIP restore: retrying a partial restore must not duplicate
   // pictures. Never expose the original digest or private storage key.
   const restoreKey=new URL(request.url).searchParams.get('restoreKey')
   if(restoreKey!==null&&!/^[0-9a-f]{64}$/.test(restoreKey))
     return json({error:'invalid_restore_key'},400)
   const seed=restoreKey?await sha256(h+':'+u+':'+memoryId+':'+restoreKey):null
   const id=seed?
     seed.slice(0,8)+'-'+seed.slice(8,12)+'-4'+seed.slice(13,16)+'-8'+seed.slice(17,20)+'-'+seed.slice(20,32):
     crypto.randomUUID()
   if(seed){
     const existing=await db.prepare(`SELECT id,deleted_at FROM media_assets
       WHERE id=?1 AND household_id=?2 AND uploaded_by=?3 AND memory_id=?4`)
       .bind(id,h,u,memoryId).first()
     if(existing?.deleted_at)return json({error:'photo_cleanup_pending'},409)
     if(existing)return json({ok:true,id,reused:true},200)
   }
   const sha=await sha256(id)
   const storageKey='private/'+h+'/'+id+'/'+sha.slice(0,10)
   try{await env.MEDIA.put(storageKey,bytes,{httpMetadata:{contentType:mime}})}
   catch{return json({error:'photo_upload_failed'},503)}
   try{
     await db.prepare(`INSERT INTO media_assets
       (id,household_id,uploaded_by,visibility,memory_id,storage_key,mime_type,byte_size)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
       .bind(id,h,u,memory.visibility,memoryId,storageKey,mime,bytes.length).run()
   }catch{
     // The object is not referenced by D1. Attempt cleanup immediately.
     try{await env.MEDIA.delete(storageKey)}catch{console.warn('homeflow_r2_unindexed_upload_cleanup_failed')}
     return json({error:'photo_metadata_failed'},503)
   }
   return json({ok:true,id,byteSize:bytes.length},201)
 }
 const match=path.match(/^\/api\/media\/([0-9a-f-]{36})$/i)
 if(match&&request.method==='GET'){
   if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
   const photo=await db.prepare(`SELECT a.storage_key,a.mime_type FROM media_assets a
     JOIN memories m ON m.id=a.memory_id
     WHERE a.id=?1 AND a.household_id=?2 AND a.deleted_at IS NULL
       AND m.deleted_at IS NULL AND (m.visibility='household' OR m.created_by=?3)`)
       .bind(match[1],h,u).first()
   if(!photo)return json({error:'not_found'},404)
   const obj=await env.MEDIA.get(photo.storage_key)
   if(!obj)return json({error:'not_found'},404)
   return new Response(obj.body,{headers:{
     'content-type':photo.mime_type,
     'cache-control':'private, no-store',
     'x-content-type-options':'nosniff',
     'content-security-policy':"default-src 'none'; sandbox",
     'referrer-policy':'no-referrer'
   }})
 }
 if(match&&request.method==='DELETE'){
   if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
   // A member may delete only their own uploaded asset (including shared albums).
   const photo=await db.prepare(`SELECT id,storage_key,deleted_at FROM media_assets
     WHERE id=?1 AND household_id=?2 AND uploaded_by=?3`).bind(match[1],h,u).first()
   if(!photo)return json({error:'not_found'},404)
   if(!photo.deleted_at){
     const result=await db.prepare(`UPDATE media_assets SET deleted_at=CURRENT_TIMESTAMP
       WHERE id=?1 AND household_id=?2 AND uploaded_by=?3 AND deleted_at IS NULL`)
       .bind(match[1],h,u).run()
     if(!result.meta?.changes)return json({error:'photo_delete_conflict'},409)
   }
   // Immediately hide the photo; retry R2 deletion if an outage occurs.
   const cleaned=await runMediaCleanup(env,h).catch(()=>({failed:1}))
   return json({ok:true,pendingCleanup:!!cleaned.failed})
 }
 return json({error:'not_found'},404)
}
