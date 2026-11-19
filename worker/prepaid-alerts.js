// Owner-only prepaid balance alerts, checked via the existing private Kakeibo
// Service Binding. Lower and upper crossings maintain independent cycles.
const scopes=new Set(['legacy','member'])
const modes=new Set(['lower','upper','both'])
const amountOK=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000
const validItem=item=>item&&scopes.has(item.scope)&&
 typeof item.key==='string'&&item.key.length>0&&item.key.length<=160&&
 typeof item.name==='string'&&item.name.length>0&&item.name.length<=80&&
 Number.isSafeInteger(item.balance)&&
 modes.has(item.mode)&&amountOK(item.thresholdJpy)&&
 amountOK(item.upperThresholdJpy)&&
 (item.mode!=='both'||item.thresholdJpy<item.upperThresholdJpy)&&
 Number.isSafeInteger(item.version)&&item.version>=1

const observationQuery=`SELECT settings_version,is_below,cycle,triggered_on,
 is_above,above_cycle,above_triggered_on,lower_active,upper_active,
 lower_threshold_jpy,upper_threshold_jpy
 FROM prepaid_alert_observations
 WHERE household_id=?1 AND recipient_user_id=?2 AND account_scope=?3 AND card_key=?4`

export function nextPrepaidAlertObservation(item,before,day){
 const lowerActive=item.mode!=='upper'
 const upperActive=item.mode!=='lower'
 const below=lowerActive&&item.balance<=item.thresholdJpy
 const above=upperActive&&item.balance>=item.upperThresholdJpy
 if(!before)return {
  settings_version:item.version,is_below:below?1:0,cycle:below?1:0,
  triggered_on:below?day:null,is_above:above?1:0,
  above_cycle:above?1:0,above_triggered_on:above?day:null,
  lower_active:lowerActive?1:0,upper_active:upperActive?1:0,
  lower_threshold_jpy:item.thresholdJpy,upper_threshold_jpy:item.upperThresholdJpy
 }
 // NULL lower threshold in migrated rows belongs to the old LOWER-only policy.
 // Keep its existing cycle and notification history when unchanged.
 const lowerPolicyChanged=Number(before.lower_active)!==(lowerActive?1:0)||
  (before.lower_threshold_jpy!==null&&
   before.lower_threshold_jpy!==item.thresholdJpy)
 const upperPolicyChanged=Number(before.upper_active)!==(upperActive?1:0)||
  (before.upper_threshold_jpy!==null&&
   before.upper_threshold_jpy!==item.upperThresholdJpy)
 const newBelow=below&&(!before.is_below||lowerPolicyChanged)
 const newAbove=above&&(!before.is_above||upperPolicyChanged)
 return {
  settings_version:item.version,
  is_below:below?1:0,
  cycle:Number(before.cycle)+(newBelow?1:0),
  triggered_on:below?(newBelow?day:before.triggered_on):null,
  is_above:above?1:0,
  above_cycle:Number(before.above_cycle)+(newAbove?1:0),
  above_triggered_on:above?(newAbove?day:before.above_triggered_on):null,
  lower_active:lowerActive?1:0,upper_active:upperActive?1:0,
  lower_threshold_jpy:item.thresholdJpy,upper_threshold_jpy:item.upperThresholdJpy
 }
}

async function alertEvent(item,day,state,side,hash){
 const low=side==='low'
 const active=low?state.is_below===1:state.is_above===1
 const trigger=low?state.triggered_on:state.above_triggered_on
 const cycle=low?state.cycle:state.above_cycle
 if(!active||trigger!==day||!Number.isSafeInteger(cycle)||cycle<1)return null
 const money=n=>'¥'+n.toLocaleString('ja-JP')
 return {
  kind:'system',
  id:'prepaid-'+(low?'low':'high')+'-balance-'+item.scope+'-'+hash+'-'+cycle,
  dueOn:day,daysBefore:0,
  title:item.name+(low?' · 余额不足':' · 余额超出上限'),
  message:'当前余额 '+money(item.balance)+'，'+
   (low?'下限 '+money(item.thresholdJpy)+' 以下。请检查是否需要充值。':
     '上限 '+money(item.upperThresholdJpy)+' 以上。请检查余额。'),
  priority:'normal'
 }
}

export async function loadPrepaidOwnerAlertEvents(env,member,day){
 if(!env.KAKEBO_LEDGER_SERVICE||!env.DB)return []
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!member?.user_id||!member?.household_id)return []
 const url=new URL('https://kakeibo.internal/api/internal/prepaid-balance-alerts')
 url.searchParams.set('householdId',member.household_id)
 url.searchParams.set('ownerUserId',member.user_id)
 const response=await env.KAKEBO_LEDGER_SERVICE.fetch(url.toString(),{method:'GET'})
 if(!response.ok)throw Error('prepaid_alert_private_projection_unavailable')
 const data=await response.json()
 if(data?.ok!==true||data.householdId!==member.household_id||
  data.ownerUserId!==member.user_id||!Array.isArray(data.items)||
  data.items.length>100||!data.items.every(validItem))
  throw Error('prepaid_alert_owner_scope_mismatch')
 const result=[]
 for(const item of data.items){
  const params=[member.household_id,member.user_id,item.scope,item.key]
  const before=await env.DB.prepare(observationQuery).bind(...params).first()
  const next=nextPrepaidAlertObservation(item,before,day)
  if(!before){
   await env.DB.prepare(`INSERT OR IGNORE INTO prepaid_alert_observations
     (household_id,recipient_user_id,account_scope,card_key,
      settings_version,is_below,cycle,triggered_on,is_above,above_cycle,
      above_triggered_on,lower_active,upper_active,lower_threshold_jpy,upper_threshold_jpy)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
    .bind(...params,next.settings_version,next.is_below,next.cycle,next.triggered_on,
      next.is_above,next.above_cycle,next.above_triggered_on,next.lower_active,
      next.upper_active,next.lower_threshold_jpy,next.upper_threshold_jpy).run()
  }else if(Object.keys(next).some(key=>next[key]!==before[key])){
   // Optimistic guard: concurrent hourly runs must not increment cycles twice.
   await env.DB.prepare(`UPDATE prepaid_alert_observations SET
      settings_version=?5,is_below=?6,cycle=?7,triggered_on=?8,
      is_above=?9,above_cycle=?10,above_triggered_on=?11,
      lower_active=?12,upper_active=?13,
      lower_threshold_jpy=?14,upper_threshold_jpy=?15
      WHERE household_id=?1 AND recipient_user_id=?2
        AND account_scope=?3 AND card_key=?4
        AND settings_version=?16 AND is_below=?17 AND cycle=?18
        AND is_above=?19 AND above_cycle=?20`)
    .bind(...params,next.settings_version,next.is_below,next.cycle,next.triggered_on,
      next.is_above,next.above_cycle,next.above_triggered_on,next.lower_active,
      next.upper_active,next.lower_threshold_jpy,next.upper_threshold_jpy,
      before.settings_version,before.is_below,before.cycle,
      before.is_above,before.above_cycle).run()
  }
  // Re-read the committed state before constructing the delivery key.
  const state=await env.DB.prepare(observationQuery).bind(...params).first()
  if(!state||state.settings_version!==item.version)continue
  const hashBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',
   new TextEncoder().encode(item.scope+'|'+item.key)))
  const hash=[...hashBytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('')
  const low=await alertEvent(item,day,state,'low',hash)
  const high=await alertEvent(item,day,state,'high',hash)
  if(low)result.push(low)
  if(high)result.push(high)
 }
 return result
}
