import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import worker from '../worker/index.js'
import {constantEqualHex,hashPassword,passwordMatches,sameOrigin,validDate,validPassword} from '../worker/security.js'
const request=(path,method='GET',headers={})=>new Request('https://homeflow.example'+path,{method,headers})
function environment(name='preview',database='homeflow-preview',migration='0034_rewards_shop.sql'){
  return {APP_ENV:name,DB:{
    prepare(sql){return {
      bind(){return this},
      first:async()=>sql.includes('environment_identity')?{database_name:database,latest_migration:migration,
         required_migration_ready:migration==='0034_rewards_shop.sql'?1:0,
         action_index_ready:1,sync_table_ready:1,member_sync_ready:1,completion_read_ready:1,settlement_origin_ready:1,points_table_ready:1,points_triggers_ready:10,rewards_tables_ready:5,rewards_triggers_ready:4}:null,
      all:async()=>({results:[]}),
      run:async()=>({meta:{changes:1}})
    }}
  },ASSETS:{fetch:()=>new Response('ASSET_MARKER')}}
}
test('health confirms D1 identity',async()=>{
  const res=await worker.fetch(request('/api/health'),environment())
  assert.equal(res.status,200)
  assert.equal((await res.json()).database,'ready')
})
test('health rejects old migration baselines even if they were accepted during rollout',async()=>{
  for(const migration of ['0025_daily_notification_inbox.sql','0026_shopping_any_receipt_complete.sql',
    '0028_explicit_today_actions.sql','0031_completion_event_read_state.sql',
    '0032_settlement_origin.sql','0033_completion_points.sql']){
    const res=await worker.fetch(request('/api/health'),environment('preview','homeflow-preview',migration))
    assert.equal(res.status,503,migration)
  }
})
test('health rejects a missing physical Today index even with a current migration name',async()=>{
  const env=environment()
  env.DB.prepare=()=>({first:async()=>({
   database_name:'homeflow-preview',latest_migration:'0034_rewards_shop.sql',
   required_migration_ready:1,action_index_ready:0,sync_table_ready:1,member_sync_ready:1,completion_read_ready:1,settlement_origin_ready:1,points_table_ready:1,points_triggers_ready:10,rewards_tables_ready:5,rewards_triggers_ready:4})})
  assert.equal((await worker.fetch(request('/api/health'),env)).status,503)
})
test('preview fails closed when attached to production',async()=>{
  const res=await worker.fetch(request('/api/health'),environment('preview','homeflow'))
  assert.equal(res.status,503)
})
test('missing latest D1 migration fails closed even when the database identity matches',async()=>{
  const res=await worker.fetch(request('/api/health'),environment('preview','homeflow-preview','0022_recycle_plans.sql'))
  assert.equal(res.status,503)
})
test('validated binding identity is reused briefly but never shared across different bindings',async()=>{
  let count=0
  const env=environment()
  const original=env.DB.prepare
  env.DB.prepare=(sql)=>{count++;return original(sql)}
  assert.equal((await worker.fetch(request('/api/health'),env)).status,200)
  assert.equal((await worker.fetch(request('/api/health'),env)).status,200)
  assert.equal(count,1)
  const changed={...env,APP_ENV:'production'}
  assert.equal((await worker.fetch(request('/api/health'),changed)).status,503)
  assert.equal(count,2)
})
test('unknown environment fails closed',async()=>{
  const res=await worker.fetch(request('/api/health'),environment('staging'))
  assert.equal(res.status,503)
})
test('missing migration fails closed',async()=>{
  const env=environment()
  env.DB.prepare=()=>({first:async()=>{throw Error('missing table')}})
  const res=await worker.fetch(request('/api/health'),env)
  assert.equal(res.status,503)
})
test('private API always denies anonymous requests regardless of method',async()=>{
  for(const method of ['GET','POST','PUT','DELETE']){
    const res=await worker.fetch(request('/api/tasks',method),environment())
    assert.equal(res.status,401)
    assert.notEqual(await res.text(),'ASSET_MARKER')
  }
})
test('health refuses mutations',async()=>{
  assert.equal((await worker.fetch(request('/api/health','POST'),environment())).status,405)
})
test('CSRF requests require exact same Origin',()=>{
  assert.equal(sameOrigin(request('/api/tasks','POST',{'origin':'https://evil.example'})),false)
  assert.equal(sameOrigin(request('/api/tasks','POST',{'origin':'https://homeflow.example','sec-fetch-site':'same-origin'})),true)
  assert.equal(sameOrigin(request('/api/tasks','POST')),false)
})
test('password validation and constant time digest check',async()=>{
  assert.equal(validPassword('weak'),false)
  assert.equal(validPassword('very-long-password-for-two-users'),true)
  const a=await hashPassword('safe-not-real-password','test-salt-0123456789abcdef',100000)
  assert.equal(await passwordMatches('safe-not-real-password',{password_salt:a.salt,password_verifier:a.verifier,password_rounds:a.rounds}),true)
  assert.equal(await passwordMatches('different-wrong-password',{password_salt:a.salt,password_verifier:a.verifier,password_rounds:a.rounds}),false)
  assert.equal(constantEqualHex('a0f1','a0f1'),true)
  assert.equal(constantEqualHex('a0f1','a0f2'),false)
})
test('date validation does not accept rolled over dates',()=>{
  assert.equal(validDate('2028-02-29'),true)
  assert.equal(validDate('2027-02-29'),false)
  assert.equal(validDate('2027-13-01'),false)
  assert.equal(validDate(null),true)
})

test('future migration must not break identity health if required schema remains intact',async()=>{
 const env=environment()
 env.DB.prepare=()=>({first:async()=>({
  database_name:'homeflow-preview',latest_migration:'0029_example_safe_additive.sql',
  required_migration_ready:1,action_index_ready:1,sync_table_ready:1,member_sync_ready:1,completion_read_ready:1,settlement_origin_ready:1,points_table_ready:1,points_triggers_ready:10,rewards_tables_ready:5,rewards_triggers_ready:4})})
 assert.equal((await worker.fetch(request('/api/health'),env)).status,200)
})

test('health refuses a recorded 0032 migration whose provenance column is absent',async()=>{
 const env=environment()
 env.DB.prepare=()=>({first:async()=>({
  database_name:'homeflow-preview',required_migration_ready:1,
  action_index_ready:1,sync_table_ready:1,member_sync_ready:1,
  completion_read_ready:1,settlement_origin_ready:0,points_table_ready:1,points_triggers_ready:10,rewards_tables_ready:5,rewards_triggers_ready:4})})
 assert.equal((await worker.fetch(request('/api/health'),env)).status,503)
})

test('health requires latest settlement migration and column in one D1 read',()=>{
 const source=readFileSync(new URL('../worker/security.js',import.meta.url),'utf8')
 assert.ok(source.includes("name='0036_plan_scoring.sql'"))
 assert.ok(source.includes("pragma_table_info('goal_period_settlements')"))
 assert.ok(source.includes("Number(identity.settlement_origin_ready)===1"))
})

test('health rejects a point table missing its secure completion triggers',async()=>{
 const env=environment()
 env.DB.prepare=()=>({first:async()=>({database_name:'homeflow-preview',
  required_migration_ready:1,action_index_ready:1,sync_table_ready:1,
  member_sync_ready:1,completion_read_ready:1,settlement_origin_ready:1,
  points_table_ready:1,points_triggers_ready:9,rewards_tables_ready:5,rewards_triggers_ready:4})})
 assert.equal((await worker.fetch(request('/api/health'),env)).status,503)
})

test('new point feature only uses authenticated API routing',async()=>{
 const res=await worker.fetch(request('/api/points'),environment())
 assert.equal(res.status,401)
})


test('health requires reward tables and pooling triggers',async()=>{
 const env=environment()
 env.DB.prepare=()=>({first:async()=>({database_name:'homeflow-preview',
  required_migration_ready:1,action_index_ready:1,sync_table_ready:1,
  member_sync_ready:1,completion_read_ready:1,settlement_origin_ready:1,
  points_table_ready:1,points_triggers_ready:10,rewards_tables_ready:4,rewards_triggers_ready:4})})
 assert.equal((await worker.fetch(request('/api/health'),env)).status,503)
})
test('reward routes cannot be accessed anonymously',async()=>{
 for(const path of ['/api/rewards','/api/rewards/pool','/api/rewards/redeem']){
  assert.equal((await worker.fetch(request(path),environment())).status,401)
 }
})
