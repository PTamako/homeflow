import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {lifeRoute} from '../worker/life.js'
import {financeRoute} from '../worker/finance.js'

const wishId='11111111-1111-4111-8111-111111111111'
const goalId='22222222-2222-4222-8222-222222222222'
const member={user_id:'husband',household_id:'family',role:'member'}
const owner={user_id:'wife',household_id:'family',role:'owner'}
const request=(path,method='GET',body)=>new Request('https://homeflow.invalid'+path,{
 method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})
})
const linkedWish={id:wishId,title:'共享心愿',created_by:member.user_id,visibility:'household',status:'completed'}
const savedGoal={id:goalId,wish_id:wishId,created_by:member.user_id,visibility:'household',
 title:'共享心愿 · 储值计划',target_amount:100000,goal_mode:'once',reserved_amount:0,start_on:'2026-11-01'}
const bridge={fetch:async()=>Response.json({income:90000,expense:30000,net:60000})}
function database(goal=savedGoal){
 const calls=[],writes=[]
 return {calls,writes,prepare(sql){
   const query={sql,params:[],bind(...args){this.params=args;calls.push(this);return this},
     async first(){
       if(sql.includes('FROM goals'))return goal
       if(sql.includes('FROM finance_target_settings'))
         return {adjustment_amount:5000,period_start:'2026-11-01',period_end:'2026-11-06'}
       return null
     },
     async all(){
       if(sql.includes('FROM wishes'))return {results:[linkedWish]}
       if(sql.includes('FROM goals'))return {results:[goal]}
       return {results:[]}
     },
     async run(){writes.push(this);return {success:true}}
   }
   return query
 }}
}
const env=db=>({DB:db,APP_ENV:'production',
 KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
 KAKEBO_LEDGER_SERVICE:bridge})

test('completed shared wish resolves its linked savings goal beyond goal pagination and status scope',async()=>{
 const db=database()
 const response=await lifeRoute(request('/api/wishes?limit=5&scope=history'),db,
   '/api/wishes',owner)
 assert.equal(response.status,200)
 const body=await response.json()
 assert.equal(body.items[0].linkedGoal.id,goalId)
 const related=db.calls.find(x=>x.sql.includes('wish_id IN'))
 assert.ok(related)
 assert.match(related.sql,/visibility='household' OR created_by=\?2/)
 assert.deepEqual(related.params.slice(0,2),['family','wife'])
})

test('household member may read the shared goal progress without seeing other ledger totals or entries',async()=>{
 const db=database()
 const status=await financeRoute(request('/api/finance/status'),env(db),'/api/finance/status',member)
 assert.equal(status.status,200)
 const read=await financeRoute(request('/api/finance/goal/net?targetId='+goalId+
   '&start=2026-11-01&end=2026-11-06'),env(db),'/api/finance/goal/net',member)
 assert.equal(read.status,200)
 const net=await read.json()
 assert.equal(net.net,60000)
 assert.equal(net.income,undefined)
 assert.equal(net.expense,undefined)
 const blocked=await financeRoute(request('/api/finance/candidates?start=2026-11-01&end=2026-11-06'),
   env(db),'/api/finance/candidates',member)
 assert.equal(blocked.status,403)
})

test('creator of a shared goal may update manual adjustment; unrelated member cannot',async()=>{
 const db=database()
 const settings=await financeRoute(request('/api/finance/settings?type=goal&targetId='+goalId),
   env(db),'/api/finance/settings',member)
 assert.equal(settings.status,200)
 assert.equal((await settings.json()).adjustmentAmount,5000)
 const own=await financeRoute(request('/api/finance/settings','PUT',{
   type:'goal',targetId:goalId,adjustmentAmount:7000,periodStart:'2026-11-01',periodEnd:'2026-11-06'
 }),env(db),'/api/finance/settings',member)
 assert.equal(own.status,200)
 assert.equal(db.writes.length,1)
 const otherDb=database({...savedGoal,created_by:owner.user_id})
 const other=await financeRoute(request('/api/finance/settings','PUT',{
   type:'goal',targetId:goalId,adjustmentAmount:10000
 }),env(otherDb),'/api/finance/settings',member)
 assert.equal(other.status,403)
 assert.equal(otherDb.writes.length,0)
 const shopping=await financeRoute(request('/api/finance/settings?type=shopping&targetId='+goalId),
   env(db),'/api/finance/settings',member)
 assert.equal(shopping.status,403)
})

test('shared history actions are available to both users; private edits and settlement remain gated',()=>{
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const finance=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
 assert.match(life,/function linkedGoal\(w:Row\)\{return w\.linkedGoal\|\|/)
 assert.match(life,/\(canEdit\(w\)&&w\.status!=='cancelled'\)\|\|!!linkedGoal\(w\)/)
 assert.match(life,/<div v-if="expandedTaskMenu==='wish:'\+w\.id"/)
 assert.match(life,/const results=await Promise\.allSettled\(/)
 assert.match(life,/const goalArchivePath=planScope\.value==='history'/)
 assert.match(life,/<button type="button" class="goal-finance-action"/)
 assert.match(finance,/<section v-if="owner\|\|embeddedKind==='goal'"/)
 assert.match(finance,/v-if="canModify" type="button" :disabled="busy" @click="saveSettings"/)
 assert.match(finance,/v-if="kind==='goal'&&owner" class="goal-completion-panel"/)
})
