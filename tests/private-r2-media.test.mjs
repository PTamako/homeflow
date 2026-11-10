import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {mediaRoute,runMediaCleanup,MAX_MEDIA_BYTES} from '../worker/media.js'
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
    async all(){return {results:statement.all(...args)},
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
 assert.doesNotMatch(toml,/public_bucket|r2\.dev|custom_domain\s*=/i)
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
