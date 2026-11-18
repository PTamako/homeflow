import test from 'node:test'
import assert from 'node:assert/strict'
import {portableRoute} from '../worker/portable.js'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'

const id=x=>'00000000-0000-4000-8000-'+String(x).padStart(12,'0')
const session={household_id:id(1),user_id:id(2),role:'member'}
function harness(){
  const writes=[]
  const db={
    prepare(sql){
      return {sql,bind(...args){this.args=args;return this},
        async all(){return {results:[]}}}
    },
    async batch(statements){
      writes.push(...statements.map(s=>({sql:s.sql,args:s.args})))
      return statements.map(()=>({meta:{changes:1}}))
    }
  }
  const restore=async(dataset,items,extra={})=>{
    const r=await portableRoute(new Request('https://homeflow.invalid/api/portable/restore',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({dataset,items,confirm:true,...extra})
    }),db,'/api/portable/restore',session)
    return {status:r.status,body:await r.json()}
  }
  return {writes,restore}
}
const task=(flag)=>({id:id(3),title:'Only remind',visibility:'private',
  notes:'',due_on:'2026-11-18',bonus_points:0,...(flag===undefined?{}:{reminder_only:flag})})
const routine=(flag)=>({id:id(4),title:'Reminder routine',
  anchor_date:'2026-11-18',repeat_type:'daily',repeat_config:'{}',
  visibility:'private',...(flag===undefined?{}:{reminder_only:flag})})

test('portable restore preserves reminder-only task and routine in SQL and binding',async()=>{
  const h=harness()
  for(const [dataset,records] of [['tasks',[task(1)]],['routines',[routine(1)]]]){
    const result=await h.restore(dataset,records)
    assert.equal(result.status,200,JSON.stringify(result.body))
    assert.equal(result.body.inserted,1)
  }
  assert.equal(h.writes.length,2)
  for(const write of h.writes){
    assert.match(write.sql,/reminder_only/)
    assert.equal(write.args.at(-1),1)
  }
})
test('legacy ZIP without reminder-only restores as normal tasks',async()=>{
  const h=harness()
  assert.equal((await h.restore('tasks',[task(undefined)])).status,200)
  assert.equal((await h.restore('routines',[routine(undefined)])).status,200)
  assert.equal(h.writes[0].args.at(-1),0)
  assert.equal(h.writes[1].args.at(-1),0)
})
test('malformed reminder flags are rejected before writing',async()=>{
  const h=harness()
  assert.equal((await h.restore('tasks',[task('yes')])).status,400)
  assert.equal((await h.restore('routines',[routine(2)])).status,400)
  assert.equal(h.writes.length,0)
})
test('active original sessions are extended, expired ones stay expired',()=>{
  const db=new DatabaseSync(':memory:')
  db.exec('CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER,created_at TEXT NOT NULL)')
  const now=Date.now()
  const created=days=>new Date(now-days*86400000).toISOString().replace('T',' ').slice(0,19)
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('active','member',now+3600000,created(13))
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('expired','member',now-3600000,created(15))
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('new','owner',now+30*86400000,created(0))
  db.exec(readFileSync(new URL('../migrations/0065_extend_active_sessions_to_30_days.sql',import.meta.url),'utf8'))
  const rows=Object.fromEntries(db.prepare('SELECT token_hash,expires_at FROM sessions').all()
    .map(row=>[row.token_hash,Number(row.expires_at)]))
  assert.ok(rows.active>now+16*86400000&&rows.active<=now+18*86400000)
  assert.equal(rows.expired,now-3600000)
  assert.ok(rows.new<=now+30*86400000)
  assert.ok(rows.new>=now+29*86400000)
  db.close()
})
