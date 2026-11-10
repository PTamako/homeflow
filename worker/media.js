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

// Bound streamed request bodies before allocation, including requests whose
// Content-Length is missing or inaccurate (e.g. chunked uploads).
export async function readLimitedMedia(request){
 const declared=request.headers.get('content-length')
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_MEDIA_BYTES))
   return null
 if(!request.body)return null
 const reader=request.body.getReader(),parts=[]
 let size=0
 try{
   for(;;){
     const {value,done}=await reader.read()
     if(done)break
     size+=value.byteLength
     if(size>MAX_MEDIA_BYTES){
       await reader.cancel().catch(()=>{})
       return null
     }
     parts.push(value)
   }
 }catch{return null}
 finally{reader.releaseLock()}
 const bytes=new Uint8Array(size)
 let offset=0
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 return bytes
}


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
   WHERE deleted_at IS NOT NULL AND datetime(deleted_at)<=datetime('now')${clause}
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
   const params=new URL(request.url).searchParams
   const memoryId=params.get('memoryId')
   const idsParam=params.get('memoryIds')
   if(memoryId&&!uuid.test(memoryId))return json({error:'invalid_input'},400)
   if(memoryId&&idsParam!==null)return json({error:'invalid_input'},400)
   const cloudAvailable=!!env.MEDIA
   const baseWhere="a.household_id=?1 AND a.deleted_at IS NULL AND m.deleted_at IS NULL "+
     "AND (m.visibility='household' OR m.created_by=?2)"
   const columns="a.id,a.memory_id AS memoryId,a.uploaded_by AS uploadedBy,"+
     "a.mime_type AS mimeType,a.byte_size AS byteSize,a.created_at AS createdAt"
   if(idsParam==='')return json({items:[],nextCursors:{},cloudAvailable})
   if(idsParam!==null){
     // First two thumbnails for up to five currently displayed memories.
     // One D1 statement, zero R2 list operations and no offscreen reads.
     const ids=idsParam.split(',')
     if(ids.length<1||ids.length>5||new Set(ids).size!==ids.length||
        !ids.every(id=>uuid.test(id)))return json({error:'invalid_input'},400)
     const marks=ids.map((_,i)=>'?'+(i+3)).join(',')
     const sql='WITH ranked AS (SELECT '+columns+
       ',ROW_NUMBER() OVER (PARTITION BY a.memory_id ORDER BY a.created_at DESC,a.id DESC) AS rn'+
       ' FROM media_assets a JOIN memories m ON m.id=a.memory_id WHERE '+baseWhere+
       ' AND a.memory_id IN ('+marks+')) '+
       'SELECT * FROM ranked WHERE rn<=3 ORDER BY memoryId,createdAt DESC,id DESC'
     const {results=[]}=await db.prepare(sql).bind(h,u,...ids).all()
     const grouped={}
     for(const row of results){
       if(!grouped[row.memoryId])grouped[row.memoryId]=[]
       grouped[row.memoryId].push(row)
     }
     const items=[],nextCursors={}
     for(const id of ids){
       const rows=grouped[id]||[]
       const shown=rows.slice(0,2)
       items.push(...shown.map(({rn,...item})=>item))
       nextCursors[id]=rows.length>2&&shown.length?
         shown[shown.length-1].createdAt+'|'+shown[shown.length-1].id:null
     }
     return json({items,nextCursors,cloudAvailable})
   }
   if(memoryId){
     const requested=Number(params.get('limit')||5)
     const raw=params.get('cursor')||''
     if(!Number.isInteger(requested)||requested<1||requested>10||raw.length>100)
       return json({error:'invalid_input'},400)
     let date='',id=''
     if(raw){
       const sep=raw.lastIndexOf('|')
       if(sep<=0)return json({error:'invalid_input'},400)
       date=raw.slice(0,sep);id=raw.slice(sep+1)
       if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:.]+$/.test(date)||!uuid.test(id))
         return json({error:'invalid_input'},400)
     }
     const args=[h,u,memoryId]
     const cursorSql=raw?' AND (a.created_at<?4 OR (a.created_at=?4 AND a.id<?5))':''
     if(raw)args.push(date,id)
     args.push(requested+1)
     const sql='SELECT '+columns+' FROM media_assets a JOIN memories m ON m.id=a.memory_id '+
       'WHERE '+baseWhere+' AND a.memory_id=?3'+cursorSql+
       ' ORDER BY a.created_at DESC,a.id DESC LIMIT ?'+args.length
     const {results=[]}=await db.prepare(sql).bind(...args).all()
     const items=results.slice(0,requested),last=items[items.length-1]
     const nextCursor=results.length>requested&&last?last.createdAt+'|'+last.id:null
     return json({items,nextCursor,cloudAvailable})
   }
   // Legacy endpoint for authenticated callers that need the full catalog.
   // Timeline itself uses the bounded memoryIds endpoint instead.
   const sql='SELECT '+columns+' FROM media_assets a JOIN memories m ON m.id=a.memory_id '+
     'WHERE '+baseWhere+' ORDER BY a.created_at DESC,a.id DESC LIMIT 250'
   const {results=[]}=await db.prepare(sql).bind(h,u).all()
   return json({items:results,cloudAvailable})
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
   if(!allowed.has(mime))return json({error:'photo_too_large_or_unsupported'},413)
   const bytes=await readLimitedMedia(request)
   if(!bytes)return json({error:'photo_exceeds_300kb'},413)
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
   // Reserve durable metadata BEFORE R2.put: an interrupted upload can
   // never leave an untracked object. Future deleted_at allows a one-hour
   // grace period before the daily cleanup may act on an unfinished upload.
   try{
     await db.prepare(`INSERT INTO media_assets
       (id,household_id,uploaded_by,visibility,memory_id,storage_key,mime_type,byte_size,deleted_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,datetime('now','+1 hour'))`)
       .bind(id,h,u,memory.visibility,memoryId,storageKey,mime,bytes.length).run()
   }catch{
     return json({error:'photo_metadata_failed'},503)
   }
   let objectStored=false
   try{
     await env.MEDIA.put(storageKey,bytes,{httpMetadata:{contentType:mime}})
     objectStored=true
     const activated=await db.prepare(`UPDATE media_assets
       SET deleted_at=NULL WHERE id=?1 AND household_id=?2
         AND uploaded_by=?3 AND deleted_at IS NOT NULL
         -- The memory can be archived/deleted while R2.put is in flight.
         -- Never activate an object after its parent is no longer accessible.
         AND EXISTS (SELECT 1 FROM memories m
           WHERE m.id=media_assets.memory_id AND m.household_id=?2
             AND m.deleted_at IS NULL
             AND (m.visibility='household' OR m.created_by=?3))`)
       .bind(id,h,u).run()
     if(Number(activated.meta?.changes)!==1)throw Error('metadata_activation_failed')
     return json({ok:true,id,byteSize:bytes.length},201)
   }catch{
     // Keep the tombstone for the daily cron if immediate cleanup fails.
     try{
       await db.prepare(`UPDATE media_assets SET deleted_at=CURRENT_TIMESTAMP
         WHERE id=?1 AND household_id=?2 AND uploaded_by=?3 AND deleted_at IS NOT NULL`)
         .bind(id,h,u).run()
       await runMediaCleanup(env,h)
     }catch{console.warn('homeflow_r2_upload_compensation_pending')}
     return json({error:objectStored?'photo_metadata_failed':'photo_upload_failed'},503)
   }
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
 if(match&&request.method==='PUT'){
   if(!env.MEDIA)return json({error:'cloud_photo_storage_not_enabled'},503)
   // Stage a new private object instead of replacing the only good copy.
   // Reuse the existing durable media_assets tombstone queue, so a Worker
   // crash or D1 failure cannot strand an R2 object without a cleanup key.
   const photo=await db.prepare(`SELECT a.storage_key,a.memory_id,a.visibility FROM media_assets a
     JOIN memories m ON m.id=a.memory_id
     WHERE a.id=?1 AND a.household_id=?2 AND a.uploaded_by=?3
       AND a.deleted_at IS NULL AND m.deleted_at IS NULL
       AND (m.visibility='household' OR m.created_by=?3)`)
     .bind(match[1],h,u).first()
   if(!photo)return json({error:'not_found'},404)
   const mime=(request.headers.get('content-type')||'').split(';')[0].toLowerCase()
   if(mime!=='image/jpeg')return json({error:'photo_too_large_or_unsupported'},413)
   const bytes=await readLimitedMedia(request)
   if(!bytes||bytes.length<16||!signatures['image/jpeg'](bytes))
     return json({error:'invalid_photo'},413)
   const reservationId=crypto.randomUUID()
   const nextKey='private/'+h+'/'+reservationId+'/edit'
   // This intermediate database key has no corresponding R2 object. It
   // frees UNIQUE(storage_key) during the atomic three-statement swap.
   const swapKey='private/'+h+'/'+reservationId+'/swap'
   try{
     await db.prepare(`INSERT INTO media_assets
       (id,household_id,uploaded_by,visibility,memory_id,storage_key,mime_type,byte_size,deleted_at)
       VALUES(?1,?2,?3,?4,?5,?6,'image/jpeg',?7,datetime('now','+1 hour'))`)
       .bind(reservationId,h,u,photo.visibility,photo.memory_id,nextKey,bytes.length).run()
   }catch{return json({error:'photo_metadata_failed'},503)}
   try{
     await env.MEDIA.put(nextKey,bytes,{httpMetadata:{contentType:mime}})
     // D1 batch commits atomically. The original asset ID stays unchanged.
     // If another edit/delete won the race, restore the staged key as a
     // cleanup tombstone; never replace their new photo or delete it.
     const changed=await db.batch([
       db.prepare(`UPDATE media_assets SET storage_key=?1
         WHERE id=?2 AND household_id=?3 AND uploaded_by=?4
           AND storage_key=?5 AND deleted_at IS NOT NULL`)
         .bind(swapKey,reservationId,h,u,nextKey),
       db.prepare(`UPDATE media_assets SET storage_key=?1,mime_type='image/jpeg',byte_size=?2
         WHERE id=?3 AND household_id=?4 AND uploaded_by=?5
           AND storage_key=?6 AND deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM memories m WHERE m.id=media_assets.memory_id
             AND m.household_id=?4 AND m.deleted_at IS NULL
             AND (m.visibility='household' OR m.created_by=?5))
           AND EXISTS (SELECT 1 FROM media_assets stage
             WHERE stage.id=?7 AND stage.household_id=?4
               AND stage.storage_key=?8 AND stage.deleted_at IS NOT NULL)`)
         .bind(nextKey,bytes.length,match[1],h,u,photo.storage_key,reservationId,swapKey),
       db.prepare(`UPDATE media_assets SET storage_key=CASE
           WHEN EXISTS (SELECT 1 FROM media_assets active
             WHERE active.id=?1 AND active.household_id=?2
               AND active.storage_key=?3 AND active.deleted_at IS NULL)
             THEN ?4 ELSE ?3 END,deleted_at=CURRENT_TIMESTAMP
         WHERE id=?5 AND household_id=?2 AND uploaded_by=?6
           AND storage_key=?7 AND deleted_at IS NOT NULL`)
         .bind(match[1],h,nextKey,photo.storage_key,reservationId,u,swapKey)
     ])
     // A losing concurrent edit makes statement #2 a no-op. The candidate
     // is still queued for deletion, while the winner remains intact.
     const committed=Number(changed[1]?.meta?.changes)===1
     const cleanup=await runMediaCleanup(env,h).catch(()=>({failed:1}))
     if(!committed)return json({error:'photo_edit_conflict'},409)
     return json({ok:true,byteSize:bytes.length,pendingCleanup:!!cleanup.failed})
   }catch{
     // Even if a response failed after committing, the pending row is
     // always the obsolete key, never the live object.
     try{
       await db.prepare(`UPDATE media_assets SET deleted_at=CURRENT_TIMESTAMP
         WHERE id=?1 AND household_id=?2 AND uploaded_by=?3 AND deleted_at IS NOT NULL`)
         .bind(reservationId,h,u).run()
       await runMediaCleanup(env,h)
     }catch{console.warn('homeflow_r2_edit_compensation_pending')}
     return json({error:'photo_edit_failed'},503)
   }
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
   return json({ok:true,unchanged:!!photo.deleted_at,pendingCleanup:!!cleaned.failed})
 }
 return json({error:'not_found'},404)
}
