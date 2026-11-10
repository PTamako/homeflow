import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {portableRoute} from '../worker/portable.js'

test('family ZIP can archive partner-created shared memories, never private or deleted records',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 try{
  sqlite.exec(`CREATE TABLE memories (
   id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT,
   title TEXT,story TEXT,happened_on TEXT,linked_type TEXT,linked_id TEXT,
   created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT)`)
  sqlite.exec(`INSERT INTO memories(id,household_id,created_by,visibility,title,story,happened_on,deleted_at)
   VALUES
   ('own','house','alice','household','own','ok','2026-11-10',NULL),
   ('shared','house','bob','household','partner','family','2026-11-10',NULL),
   ('private','house','bob','private','secret','no','2026-11-10',NULL),
   ('deleted','house','bob','household','deleted','no','2026-11-10','2026-11-10'),
   ('foreign','other','bob','household','foreign','no','2026-11-10',NULL)`)
  const db={prepare(sql){const st=sqlite.prepare(sql);return {
   bind(...args){return {all:async()=>({results:st.all(...args)})}}
  }}}
  const path='/api/portable/shared-memories'
  const response=await portableRoute(new Request('https://homeflow.invalid'+path),
   db,path,{household_id:'house',user_id:'alice'})
  assert.equal(response.status,200)
  const data=await response.json()
  assert.equal(data.restorePolicy,'read-only')
  assert.deepEqual(data.items.map(x=>x.id),['shared'])
  assert.equal(data.items[0].created_by,'bob')
  const invalid=await portableRoute(new Request('https://homeflow.invalid'+path+'?cursor=-1'),
   db,path,{household_id:'house',user_id:'alice'})
  assert.equal(invalid.status,400)
 }finally{sqlite.close()}
})
test('ZIP keeps partner memories separate from account-owned restore records',()=>{
 const source=readFileSync(new URL('../src/components/BackupPanel.vue',import.meta.url),'utf8')
 assert.match(source,/shared-memories-readonly\.json/)
 assert.match(source,/\/portable\/shared-memories/)
 assert.match(source,/const ownMemories=new Set/)
 assert.match(source,/if\(!match\|\|!ownMemories\.has\(match\[1\]\)\)continue/)
})
