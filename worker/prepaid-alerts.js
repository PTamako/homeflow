// Personal prepaid wallet low-balance reminders: read only via the existing
// internal Kakeibo Service Binding. A grantee is never a notification recipient.
const scopes=new Set(['legacy','member'])
const validItem=item=>item&&scopes.has(item.scope)&&
  typeof item.key==='string'&&item.key.length>0&&item.key.length<=160&&
  typeof item.name==='string'&&item.name.length>0&&item.name.length<=80&&
  Number.isSafeInteger(item.balance)&&
  Number.isSafeInteger(item.thresholdJpy)&&item.thresholdJpy>=0&&item.thresholdJpy<=100000000&&
  Number.isSafeInteger(item.version)&&item.version>=1

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
  const below=item.balance<=item.thresholdJpy
  const query=`SELECT settings_version,is_below,cycle,triggered_on
     FROM prepaid_alert_observations
     WHERE household_id=?1 AND recipient_user_id=?2 AND account_scope=?3 AND card_key=?4`
  const params=[member.household_id,member.user_id,item.scope,item.key]
  const before=await env.DB.prepare(query).bind(...params).first()
  if(!before){
   await env.DB.prepare(`INSERT OR IGNORE INTO prepaid_alert_observations
     (household_id,recipient_user_id,account_scope,card_key,settings_version,is_below,cycle,triggered_on)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
     .bind(...params,item.version,below?1:0,below?1:0,below?day:null).run()
  }else if(before.settings_version!==item.version||before.is_below!==(below?1:0)){
   // Compare old revision and cycle so concurrent Cron retries cannot increment twice.
   const nextCycle=Number(before.cycle)+(below?1:0)
   await env.DB.prepare(`UPDATE prepaid_alert_observations
      SET settings_version=?5,is_below=?6,cycle=?7,triggered_on=?8
      WHERE household_id=?1 AND recipient_user_id=?2 AND account_scope=?3 AND card_key=?4
        AND settings_version=?9 AND is_below=?10 AND cycle=?11`)
     .bind(...params,item.version,below?1:0,nextCycle,below?day:null,
       before.settings_version,before.is_below,before.cycle).run()
  }
  // Until midnight, repeat the same EVENT for safely retryable delivery,
  // not a new alert. The existing inbox and per-device claims de-duplicate it.
  const state=await env.DB.prepare(query).bind(...params).first()
  if(!below||state?.is_below!==1||state.settings_version!==item.version||
    state.triggered_on!==day||!Number.isSafeInteger(state.cycle)||state.cycle<1)continue
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(item.scope+'|'+item.key)))
  const hash=[...digest.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join('')
  const money=n=>'¥'+n.toLocaleString('ja-JP')
  result.push({
   kind:'system',
   id:'prepaid-low-balance-'+item.scope+'-'+hash+'-'+state.cycle,
   dueOn:day,daysBefore:0,
   title:item.name+' · 余额不足',
   message:'当前余额 '+money(item.balance)+'，预警金额 '+money(item.thresholdJpy)+'。请检查是否需要充值。',
   priority:'normal'
  })
 }
 return result
}
