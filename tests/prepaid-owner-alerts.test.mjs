import test from 'node:test'
import assert from 'node:assert/strict'
import {loadPrepaidOwnerAlertEvents,nextPrepaidAlertObservation} from '../worker/prepaid-alerts.js'

const owner={user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 household_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
const day='2026-11-19'
function fixture(){
 const wallet={scope:'legacy',key:'Suica',name:'Suica',balance:633,
  mode:'lower',thresholdJpy:1000,upperThresholdJpy:2000,version:1}
 let ownerUserId=owner.user_id,writes=0
 const states=new Map()
 const db={prepare(sql){return {bind(...args){
  const key=args.slice(0,4).join('|')
  return {
   async first(){return sql.includes('SELECT settings_version')?(states.get(key)||null):null},
   async run(){
    writes++
    if(sql.includes('INSERT OR IGNORE INTO prepaid_alert_observations')){
     if(!states.has(key))states.set(key,{
      settings_version:args[4],is_below:args[5],cycle:args[6],triggered_on:args[7],
      is_above:args[8],above_cycle:args[9],above_triggered_on:args[10],
      lower_active:args[11],upper_active:args[12],
      lower_threshold_jpy:args[13],upper_threshold_jpy:args[14]})
    }else if(sql.includes('UPDATE prepaid_alert_observations')){
     const previous=states.get(key)
     if(previous&&previous.settings_version===args[15]&&
      previous.is_below===args[16]&&previous.cycle===args[17]&&
      previous.is_above===args[18]&&previous.above_cycle===args[19])
      states.set(key,{
       settings_version:args[4],is_below:args[5],cycle:args[6],triggered_on:args[7],
       is_above:args[8],above_cycle:args[9],above_triggered_on:args[10],
       lower_active:args[11],upper_active:args[12],
       lower_threshold_jpy:args[13],upper_threshold_jpy:args[14]})
    }else throw Error('Unexpected SQL mutation')
    return {meta:{changes:1}}
   }
  }
 }}}}
 const env={DB:db,KAKEBO_LEDGER_SERVICE:{async fetch(url){
  const requested=new URL(url)
  assert.equal(requested.pathname,'/api/internal/prepaid-balance-alerts')
  assert.equal(requested.searchParams.get('householdId'),owner.household_id)
  assert.equal(requested.searchParams.get('ownerUserId'),owner.user_id)
  return Response.json({ok:true,householdId:owner.household_id,ownerUserId,
   items:[{...wallet}]})
 }}}
 return {env,wallet,setOwner:v=>ownerUserId=v,writes:()=>writes,states}
}

test('lower-only alert preserves dedupe and re-arms after recharge',async()=>{
 const f=fixture()
 const first=await loadPrepaidOwnerAlertEvents(f.env,owner,day)
 assert.equal(first.length,1)
 assert.match(first[0].title,/余额不足/)
 assert.match(first[0].message,/633/)
 assert.equal((await loadPrepaidOwnerAlertEvents(f.env,owner,day))[0].id,first[0].id)
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20'),[])
 f.wallet.balance=1500
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20'),[])
 f.wallet.balance=450
 const again=await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-21')
 assert.equal(again.length,1)
 assert.notEqual(again[0].id,first[0].id)
})

test('upper-only alert triggers on inclusive upper boundary and re-arms below it',async()=>{
 const f=fixture()
 Object.assign(f.wallet,{mode:'upper',balance:2000,upperThresholdJpy:2000})
 const first=await loadPrepaidOwnerAlertEvents(f.env,owner,day)
 assert.equal(first.length,1)
 assert.match(first[0].title,/超出上限/)
 assert.match(first[0].id,/prepaid-high-balance/)
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20'),[])
 f.wallet.balance=1000
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20'),[])
 f.wallet.balance=2500
 const again=await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-21')
 assert.equal(again.length,1)
 assert.notEqual(again[0].id,first[0].id)
})

test('both sides remain independent; changing upper limit does not repeat low alert',async()=>{
 const f=fixture()
 Object.assign(f.wallet,{mode:'both',balance:750,thresholdJpy:1000,upperThresholdJpy:2000})
 const low=await loadPrepaidOwnerAlertEvents(f.env,owner,day)
 assert.equal(low.length,1)
 assert.match(low[0].id,/prepaid-low-balance/)
 f.wallet.version=2
 f.wallet.upperThresholdJpy=2500
 const unchanged=await loadPrepaidOwnerAlertEvents(f.env,owner,day)
 assert.equal(unchanged.length,1)
 assert.equal(unchanged[0].id,low[0].id)
 f.wallet.balance=1600
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20'),[])
 f.wallet.balance=2600
 const high=await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-20')
 assert.equal(high.length,1)
 assert.match(high[0].id,/prepaid-high-balance/)
 assert.notEqual(high[0].id,low[0].id)
 assert.deepEqual(await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-21'),[])
 f.wallet.balance=900
 const reLow=await loadPrepaidOwnerAlertEvents(f.env,owner,'2026-11-21')
 assert.equal(reLow.length,1)
 assert.notEqual(reLow[0].id,low[0].id)
})

test('historic lower-only observation stays on its original cycle after schema upgrade',()=>{
 const f=fixture()
 const historic={settings_version:1,is_below:1,cycle:5,triggered_on:day,
  is_above:0,above_cycle:0,above_triggered_on:null,
  lower_active:1,upper_active:0,lower_threshold_jpy:null,upper_threshold_jpy:null}
 const updated=nextPrepaidAlertObservation(f.wallet,historic,day)
 assert.equal(updated.cycle,5)
 assert.equal(updated.triggered_on,day)
 assert.equal(updated.above_cycle,0)
})

test('fail closed on mismatched owner or inverted thresholds without writing',async()=>{
 const f=fixture()
 f.setOwner('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 await assert.rejects(loadPrepaidOwnerAlertEvents(f.env,owner,day),/owner_scope_mismatch/)
 assert.equal(f.writes(),0)
 f.setOwner(owner.user_id)
 Object.assign(f.wallet,{mode:'both',thresholdJpy:3000,upperThresholdJpy:2000})
 await assert.rejects(loadPrepaidOwnerAlertEvents(f.env,owner,day),/owner_scope_mismatch/)
 assert.equal(f.writes(),0)
})
