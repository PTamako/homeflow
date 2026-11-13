import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifiedDatabase} from '../worker/security.js'

const envFor=({name='homeflow',baseline=1,throwError=false}={})=>{
 const queries=[]
 const db={prepare(sql){
   queries.push(sql)
   return {first:async()=>{
     if(throwError)throw Error('D1 unavailable')
     if(/sqlite_master|pragma_table_info/.test(sql))return null
     return {database_name:name,baseline_ready:baseline}
   }}
 }}
 return {env:{APP_ENV:'production',DB:db},queries}
}
test('hot-path D1 guard uses only indexed identity and latest migration, then caches',async()=>{
 const f=envFor()
 assert.equal(await verifiedDatabase(f.env,{quick:true}),true)
 assert.equal(f.queries.length,1)
 assert.match(f.queries[0],/FROM environment_identity WHERE key='current'/)
 assert.match(f.queries[0],/0052_achievement_thresholds.sql/)
 assert.doesNotMatch(f.queries[0],/sqlite_master|pragma_table_info|PRAGMA/)
 assert.equal(await verifiedDatabase(f.env,{quick:true}),true)
 assert.equal(f.queries.length,1)
})
test('short preflight rejects wrong database, old schema and D1 errors',async()=>{
 for(const input of [{name:'homeflow-preview'},{baseline:0},{throwError:true}]){
   const f=envFor(input)
   assert.equal(await verifiedDatabase(f.env,{quick:true}),false)
 }
 const f=envFor()
 delete f.env.APP_ENV
 assert.equal(await verifiedDatabase(f.env,{quick:true}),false)
 assert.equal(f.queries.length,0)
})
test('short preflight never bypasses full trigger and index audit',async()=>{
 const f=envFor()
 assert.equal(await verifiedDatabase(f.env,{quick:true}),true)
 assert.equal(await verifiedDatabase(f.env),false,'quick cache cannot approve a full structural check')
 assert.equal(f.queries.length,2)
 assert.match(f.queries[1],/sqlite_master/)
 assert.match(f.queries[1],/pragma_table_info/)
})
test('full audit still protects production health check and hourly Cron',()=>{
 const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 assert.match(source,/if\(path==='\/api\/health'\)[\s\S]{0,250}verifiedDatabase\(env\)/)
 assert.match(source,/if\(path==='\/api' \|\| path\.startsWith\('\/api\/'\)\)[\s\S]{0,260}verifiedDatabase\(env,\{quick:true\}\)/)
 assert.match(source,/if\(phase==='skip'\|\|!await verifiedDatabase\(env\)\)return/)
})
