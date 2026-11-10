import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {mediaRoute,runMediaCleanup,MAX_MEDIA_BYTES,readLimitedMedia} from '../worker/media.js'
import {recycleRoute} from '../worker/recycle.js'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const memoryId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const privateId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const session={household_id:'home',user_id:'alice',role:'owner'}
const other={household_id:'home',user_id:'bob',role:'member'}
const foreign={household_id:'foreign',user_id:'eve',role:'owner'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 const manifest=read('scripts/check_migrations.py')
 const files=[...manifest.split('MIGRATIONS=[')[1].split(']')[0].matchAll(/"(\d{4}_[^"]+\.sql)"/g)]
 for(const [,file] of files)sqlite.exec(read('migrations/'+file))
 sqlite.exec("INSERT INTO households(id,display_name) VALUES('home','Home'),('foreign','Elsewhere')")
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('alice','alice','x','y'),('bob','bob','x','y'),('eve','eve','x','y')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('home','alice','owner'),('home','bob','member'),('foreign','eve','owner')")
 sqlite.prepare("INSERT INTO memories(id,household_id,created_by,visibility,title,happened_on) VALUES(?,'home','alice',?,'Album','2026-11-10')")
   .run(memoryId,'household')
 sqlite.prepare("INSERT INTO memories(id,household_id,created_by,visibility,title,happened_on) VALUES(?,'home','alice',?,'Private','2026-11-10')")
   .run(privateId,'private')
 const db={
  prepare(sql){const statement=sqlite.prepare(sql);let args=[]
   return {bind(...values){args=values;return this},
    async first(){return statement.get(...args)||null},
    async all(){return {results:statement.all(...args)}},
    async run(){return {meta:{changes:Number(statement.run(...args).changes)}}}}
  },
  async batch(statements){
    sqlite.exec('BEGIN')
    try{const out=[];for(const q of statements)out.push(await q.run());sqlite.exec('COMMIT');return out}
    catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 }
 const objects=new Map()
 let failDeletion=false
 const media={
  objects,
  async put(k,bytes){objects.set(k,new Uint8Array(bytes))},
  async get(k){const bytes=objects.get(k);return bytes?{body:bytes}:null},
  async delete(k){if(failDeletion){failDeletion=false;throw Error('simulated R2 temporary failure')}objects.delete(k)},
  failNextDelete(){failDeletion=true}
 }
 return {sqlite,db,media,env:{DB:db,MEDIA:media},close(){sqlite.close()}}
}
const upload=(id,bytes)=>new Request('https://homeflow.invalid/api/media/upload?memoryId='+id,{
 method:'POST',headers:{'content-type':'image/jpeg'},body:bytes
})
const jpeg=(length=64)=>{
 const bytes=new Uint8Array(length)
 bytes[0]=255;bytes[1]=216;bytes[2]=255
 return bytes
}

test('one private bucket binding; no R2 in preview; public access stays disabled in config',()=>{
 const toml=read('wrangler.toml'),prod=toml.split('[env.preview]')[0],preview=toml.split('[env.preview]')[1]
 assert.match(prod,/\[\[r2_buckets\]\][\s\S]*?binding = "MEDIA"[\s\S]*?bucket_name = "homeflow-family-media"/)
 assert.doesNotMatch(preview,/\[\[r2_buckets\]\]/)
 assert.doesNotMatch(toml,/public_bucket\\s*=|custom_domain\\s*=/i)
 assert.equal(MAX_MEDIA_BYTES,300*1024)
 assert.match(read('src/local-media.ts'),/MAX_PHOTO_BYTES=300\*1024/)
})

test('R2 uploads are private, user-scoped and rejected beyond 300KiB',async()=>{
 const f=fixture()
 try{
  const unavailable=await mediaRoute(upload(memoryId,jpeg(64)),{DB:f.db},'/api/media/upload',session)
  assert.equal(unavailable.status,503)
  const tooLarge=await mediaRoute(upload(memoryId,jpeg(MAX_MEDIA_BYTES+1)),f.env,'/api/media/upload',session)
  assert.equal(tooLarge.status,413)
  assert.equal(f.media.objects.size,0)
  const forbidden=await mediaRoute(upload(privateId,jpeg()),f.env,'/api/media/upload',other)
  assert.equal(forbidden.status,404)
  const okay=await mediaRoute(upload(memoryId,jpeg()),f.env,'/api/media/upload',session)
  assert.equal(okay.status,201)
  const {id,byteSize}=await okay.json()
  assert.equal(byteSize,64)
  assert.equal(f.media.objects.size,1)
  const foreignRead=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),f.env,'/api/media/'+id,foreign)
  assert.equal(foreignRead.status,404)
  const householdRead=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),f.env,'/api/media/'+id,other)
  assert.equal(householdRead.status,200)
  assert.equal(householdRead.headers.get('cache-control'),'private, no-store')
  const foreignDelete=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{method:'DELETE'}),
    f.env,'/api/media/'+id,other)
  assert.equal(foreignDelete.status,404)
  const del=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{method:'DELETE'}),
    f.env,'/api/media/'+id,session)
  assert.equal(del.status,200)
  assert.equal((await del.json()).pendingCleanup,false)
  assert.equal(f.media.objects.size,0,'the actual private R2 object must be deleted')
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get().n,0)
 }finally{f.close()}
})

test('failed R2 deletion is never publicly readable and survives until retried',async()=>{
 const f=fixture()
 try{
  const result=await mediaRoute(upload(privateId,jpeg()),f.env,'/api/media/upload',session)
  assert.equal(result.status,201)
  const {id}=await result.json()
  f.media.failNextDelete()
  const deleted=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{method:'DELETE'}),
    f.env,'/api/media/'+id,session)
  assert.equal((await deleted.json()).pendingCleanup,true)
  assert.equal(f.media.objects.size,1,'retain the object until retry')
  const hidden=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),f.env,'/api/media/'+id,session)
  assert.equal(hidden.status,404,'logically deleted media must be inaccessible')
  assert.ok(f.sqlite.prepare('SELECT deleted_at FROM media_assets WHERE id=?').get(id).deleted_at)
  const cleanup=await runMediaCleanup(f.env)
  assert.equal(cleanup.removed,1)
  assert.equal(f.media.objects.size,0)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get().n,0)
 }finally{f.close()}
})

test('trash retains R2 photos until permanent empty; then deletes R2 and D1 metadata',async()=>{
 const f=fixture()
 try{
  const saved=await mediaRoute(upload(memoryId,jpeg()),f.env,'/api/media/upload',session)
  assert.equal(saved.status,201)
  f.sqlite.prepare("UPDATE memories SET deleted_at='2026-11-10T01:00:00.000Z' WHERE id=?").run(memoryId)
  const unavailable=await mediaRoute(new Request('https://homeflow.invalid/api/media?memoryId='+memoryId),
    f.env,'/api/media',session)
  assert.equal((await unavailable.json()).items.length,0)
  assert.equal(f.media.objects.size,1,'soft deletion retains original for recovery')
  const req=new Request('https://homeflow.invalid/api/recycle/empty',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({confirm:'PERMANENTLY_EMPTY_RECYCLE_BIN'})
  })
  const erased=await recycleRoute(req,f.db,'/api/recycle/empty',session,f.env)
  assert.equal(erased.status,200,await erased.clone().text())
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM memories WHERE id=?').get(memoryId).n,0)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get().n,0)
  assert.equal(f.media.objects.size,0)
 }finally{f.close()}
})

test('ZIP restore is idempotent and does not duplicate R2 objects across retries',async()=>{
 const f=fixture()
 try{
  const sourceBytes=jpeg(90)
  const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sourceBytes)),
    x=>x.toString(16).padStart(2,'0')).join('')
  const url='https://homeflow.invalid/api/media/upload?memoryId='+memoryId+'&restoreKey='+key
  const send=()=>mediaRoute(new Request(url,{method:'POST',
    headers:{'content-type':'image/jpeg'},body:sourceBytes}),f.env,'/api/media/upload',session)
  const first=await send()
  assert.equal(first.status,201)
  const firstId=(await first.json()).id
  const second=await send()
  assert.equal(second.status,200)
  const repeat=await second.json()
  assert.equal(repeat.id,firstId)
  assert.equal(repeat.reused,true)
  assert.equal(f.media.objects.size,1)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM media_assets').get().n,1)
  const broken=await mediaRoute(new Request(
    'https://homeflow.invalid/api/media/upload?memoryId='+memoryId+'&restoreKey=invalid',
    {method:'POST',headers:{'content-type':'image/jpeg'},body:sourceBytes}),
    f.env,'/api/media/upload',session)
  assert.equal(broken.status,400)
 }finally{f.close()}
})

test('five-memory metadata lookup returns two per memory and R2 objects are not listed',async()=>{
 const f=fixture()
 try{
  for(let i=0;i<6;i++){
    const res=await mediaRoute(upload(memoryId,jpeg(64+i)),f.env,'/api/media/upload',session)
    assert.equal(res.status,201)
  }
  const first=await mediaRoute(
    new Request('https://homeflow.invalid/api/media?memoryIds='+memoryId),
    f.env,'/api/media',session)
  assert.equal(first.status,200)
  const initial=await first.json()
  assert.equal(initial.items.length,2)
  let cursor=initial.nextCursors[memoryId]
  assert.ok(cursor)
  const ids=new Set(initial.items.map(x=>x.id))
  let calls=0
  while(cursor){
    const response=await mediaRoute(new Request(
      'https://homeflow.invalid/api/media?memoryId='+memoryId+
      '&limit=2&cursor='+encodeURIComponent(cursor)),f.env,'/api/media',session)
    assert.equal(response.status,200)
    const next=await response.json()
    for(const item of next.items){assert.equal(ids.has(item.id),false);ids.add(item.id)}
    cursor=next.nextCursor;calls++
    assert.ok(calls<5,'must terminate')
  }
  assert.equal(ids.size,6)
  assert.equal(f.media.objects.size,6,'metadata-only reads must not write/delete objects')
  const invalid=await mediaRoute(new Request(
    'https://homeflow.invalid/api/media?memoryIds='+Array(6).fill(memoryId).join(',')),
    f.env,'/api/media',session)
  assert.equal(invalid.status,400)
  const empty=await mediaRoute(new Request('https://homeflow.invalid/api/media?memoryIds='),
    f.env,'/api/media',session)
  assert.deepEqual((await empty.json()).items,[])
 }finally{f.close()}
})

test('photo editing is uploader-only, max 300KiB, and overwrites one private object',async()=>{
 const f=fixture()
 try{
  const first=await mediaRoute(upload(memoryId,jpeg(64)),f.env,'/api/media/upload',session)
  const {id}=await first.json()
  const update=(bytes)=>new Request('https://homeflow.invalid/api/media/'+id,
    {method:'PUT',headers:{'content-type':'image/jpeg'},body:bytes})
  assert.equal((await mediaRoute(update(jpeg(77)),f.env,'/api/media/'+id,other)).status,404)
  assert.equal((await mediaRoute(update(jpeg(77)),f.env,'/api/media/'+id,foreign)).status,404)
  assert.equal((await mediaRoute(update(jpeg(MAX_MEDIA_BYTES+1)),f.env,'/api/media/'+id,session)).status,413)
  const edited=await mediaRoute(update(jpeg(90)),f.env,'/api/media/'+id,session)
  assert.equal(edited.status,200)
  assert.equal((await edited.json()).byteSize,90)
  assert.equal(f.media.objects.size,1)
  assert.equal(f.sqlite.prepare('SELECT byte_size FROM media_assets WHERE id=?').get(id).byte_size,90)
  const readback=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),
    f.env,'/api/media/'+id,session)
  assert.equal((await readback.arrayBuffer()).byteLength,90)
 }finally{f.close()}
})

test('a future-dated upload reservation is skipped until safe to clean',async()=>{
 const f=fixture()
 try{
  const saved=await mediaRoute(upload(memoryId,jpeg()),f.env,'/api/media/upload',session)
  const {id}=await saved.json()
  f.sqlite.prepare("UPDATE media_assets SET deleted_at=datetime('now','+1 hour') WHERE id=?").run(id)
  const early=await runMediaCleanup(f.env)
  assert.equal(early.removed,0,'do not delete an in-flight upload')
  assert.equal(f.media.objects.size,1)
  f.sqlite.prepare('UPDATE media_assets SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id)
  const later=await runMediaCleanup(f.env)
  assert.equal(later.removed,1)
  assert.equal(f.media.objects.size,0)
 }finally{f.close()}
})

test('failed metadata activation still leaves a durable R2 cleanup tombstone',async()=>{
 const f=fixture()
 try{
  const prepare=f.db.prepare.bind(f.db)
  f.db.prepare=(sql)=>{
   if(/UPDATE media_assets\s+SET deleted_at=NULL/.test(sql))return {
     bind(){return {run:async()=>{throw Error('simulated D1 activation failure')}}}
   }
   return prepare(sql)
  }
  f.media.failNextDelete()
  const res=await mediaRoute(upload(memoryId,jpeg()),f.env,'/api/media/upload',session)
  assert.equal(res.status,503)
  assert.equal(f.media.objects.size,1,'the first cleanup failed')
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM media_assets WHERE deleted_at IS NOT NULL').get().n,1)
  const again=await runMediaCleanup(f.env)
  assert.equal(again.removed,1)
  assert.equal(f.media.objects.size,0)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM media_assets').get().n,0)
 }finally{f.close()}
})


test('streamed uploads and edits reject oversized bodies without trusting Content-Length',async()=>{
 const req=(bytes,declared)=>new Request('https://homeflow.invalid/api/media/upload',{
  method:'POST',duplex:'half',
  headers:{'content-type':'image/jpeg',...(declared?{'content-length':declared}:{})},
  body:new ReadableStream({start(controller){
   controller.enqueue(bytes.subarray(0,64))
   controller.enqueue(bytes.subarray(64))
   controller.close()
  }})
 })
 assert.equal(await readLimitedMedia(req(jpeg(MAX_MEDIA_BYTES+64))),null)
 assert.equal(await readLimitedMedia(req(jpeg(MAX_MEDIA_BYTES+64),'40')),null)
 assert.equal((await readLimitedMedia(req(jpeg(64)))).length,64)
 const f=fixture()
 try{
  const tooLarge=await mediaRoute(req(jpeg(MAX_MEDIA_BYTES+64)),f.env,'/api/media/upload',session)
  assert.equal(tooLarge.status,413)
  assert.equal(f.media.objects.size,0)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM media_assets').get().n,0)
  const created=await mediaRoute(upload(memoryId,jpeg(64)),f.env,'/api/media/upload',session)
  const {id}=await created.json()
  const denied=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{
   method:'PUT',duplex:'half',headers:{'content-type':'image/jpeg'},
   body:new ReadableStream({start(c){c.enqueue(jpeg(MAX_MEDIA_BYTES+1));c.close()}})
  }),f.env,'/api/media/'+id,session)
  assert.equal(denied.status,413)
  assert.equal(f.media.objects.size,1)
 }finally{f.close()}
})

test('R2 photo edit keeps original bytes if the D1 swap fails after upload',async()=>{
 const f=fixture()
 try{
  const original=await mediaRoute(upload(memoryId,jpeg(64)),f.env,'/api/media/upload',session)
  const {id}=await original.json()
  const prepare=f.db.prepare.bind(f.db)
  f.db.prepare=sql=>/SET storage_key=\?1,mime_type='image\/jpeg'/.test(sql)
   ?{bind(){return {run:async()=>{throw Error('simulated atomic swap failure')}}}}
   :prepare(sql)
  const updated=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{
   method:'PUT',headers:{'content-type':'image/jpeg'},body:jpeg(90)
  }),f.env,'/api/media/'+id,session)
  assert.equal(updated.status,503)
  const photo=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),
   f.env,'/api/media/'+id,session)
  assert.equal((await photo.arrayBuffer()).byteLength,64,'original photo must remain readable')
  assert.equal(f.media.objects.size,1,'staged object is compensated')
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM media_assets').get().n,1)
 }finally{f.close()}
})

test('edited image becomes available even if deleting obsolete R2 object temporarily fails',async()=>{
 const f=fixture()
 try{
  const original=await mediaRoute(upload(memoryId,jpeg(64)),f.env,'/api/media/upload',session)
  const {id}=await original.json()
  const oldKey=f.sqlite.prepare('SELECT storage_key FROM media_assets WHERE id=?').get(id).storage_key
  f.media.failNextDelete()
  const edited=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id,{
   method:'PUT',headers:{'content-type':'image/jpeg'},body:jpeg(93)
  }),f.env,'/api/media/'+id,session)
  assert.equal(edited.status,200)
  assert.equal((await edited.json()).pendingCleanup,true)
  const photo=await mediaRoute(new Request('https://homeflow.invalid/api/media/'+id),
   f.env,'/api/media/'+id,session)
  assert.equal((await photo.arrayBuffer()).byteLength,93)
  assert.equal(f.media.objects.size,2,'obsolete image stays queued for retry')
  assert.equal(f.media.objects.has(oldKey),true)
  const cleanup=await runMediaCleanup(f.env)
  assert.equal(cleanup.removed,1)
  assert.equal(f.media.objects.size,1)
  assert.equal(f.media.objects.has(oldKey),false)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM media_assets').get().n,1)
 }finally{f.close()}
})
