import test from 'node:test'
import assert from 'node:assert/strict'
import {loadPrepaidOwnerAlertEvents} from '../worker/prepaid-alerts.js'

const member={user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 household_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}
const day='2026-11-19'
function fixture(){
 let balance=633,version=1,ownerUserId=member.user_id
 const states=new Map()
 let writes=0
 const db={prepare(sql){return {bind(...args){const key=args.slice(0,4).join('|')
  return {
   async first(){return sql.includes('SELECT settings_version')?(states.get(key)||null):null},
   async run(){
    writes++
    if(sql.includes('INSERT OR IGNORE INTO prepaid_alert_observations')){
     if(!states.has(key))states.set(key,{settings_version:args[4],is_below:args[5],
      cycle:args[6],triggered_on:args[7]})
    }else if(sql.includes('UPDATE prepaid_alert_observations')){
     const old=states.get(key)
     if(old&&old.settings_version===args[8]&&old.is_below===args[9]&&old.cycle===args[10])
      states.set(key,{settings_version:args[4],is_below:args[5],cycle:args[6],triggered_on:args[7]})
    }else throw Error('unexpected SQL')
    return {meta:{changes:1}}
   }
  }
 }}}}
 const env={DB:db,KAKEBO_LEDGER_SERVICE:{async fetch(url){
  const u=new URL(url)
  assert.equal(u.pathname,'/api/internal/prepaid-balance-alerts')
  assert.equal(u.searchParams.get('householdId'),member.household_id)
  assert.equal(u.searchParams.get('ownerUserId'),member.user_id)
  return Response.json({ok:true,householdId:member.household_id,ownerUserId,
   items:[{scope:'legacy',key:'Suica',name:'Suica',balance,thresholdJpy:1000,version}]})
 }}}
 return {env,setBalance:v=>balance=v,setVersion:v=>version=v,
  setOwner:v=>ownerUserId=v,writes:()=>writes}
}

test('owner-only wallet warning is rearmed after recharge, not sent every day',async()=>{
 const f=fixture()
 const first=await loadPrepaidOwnerAlertEvents(f.env,member,day)
 assert.equal(first.length,1)
 assert.match(first[0].message,/633/)
 assert.equal(first[0].kind,'system')
 assert.equal((await loadPrepaidOwnerAlertEvents(f.env,member,day))[0].id,first[0].id)
 assert.equal((await loadPrepaidOwnerAlertEvents(f.env,member,'2026-11-20')).length,0)
 f.setBalance(1500)
 assert.equal((await loadPrepaidOwnerAlertEvents(f.env,member,'2026-11-20')).length,0)
 f.setBalance(500)
 const again=await loadPrepaidOwnerAlertEvents(f.env,member,'2026-11-21')
 assert.equal(again.length,1)
 assert.notEqual(again[0].id,first[0].id)
 f.setVersion(2)
 const revised=await loadPrepaidOwnerAlertEvents(f.env,member,'2026-11-21')
 assert.equal(revised.length,1)
 assert.notEqual(revised[0].id,again[0].id)
})

test('a projection claiming a different owner is rejected before writing an alert',async()=>{
 const f=fixture()
 f.setOwner('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
 await assert.rejects(loadPrepaidOwnerAlertEvents(f.env,member,day),/owner_scope_mismatch/)
 assert.equal(f.writes(),0)
})
