import {json,readBody,validDate} from './security.js'

// Only the HomeFlow Worker can call this authorization-scoped, read-only Pages endpoint.
// The shared token is a Worker Secret, not a browser-readable variable.
const BRIDGE='https://kakeibo-f17.pages.dev/api/homeflow-bridge'
const validateDate=value=>typeof value==='string'&&value.length===10&&validDate(value)
const windowOf=request=>{
  const url=new URL(request.url)
  const from=url.searchParams.get('from'),to=url.searchParams.get('to')
  if(!validateDate(from)||!validateDate(to)||from>to)return null
  const interval=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000
  if(interval>31)return null
  return {from,to}
}
const enabled=env=>env.APP_ENV==='production' && typeof env.KAKEBO_BRIDGE_TOKEN==='string' && env.KAKEBO_BRIDGE_TOKEN.length>=32
function expense(x){
  return x&&Number.isSafeInteger(x.id)&&x.id>0&&Number.isSafeInteger(x.amount)&&x.amount>0&&
    validateDate(x.date)&&typeof x.category==='string'&&typeof x.merchant==='string'
}
async function remote(env,window){
  const address=new URL(BRIDGE)
  address.searchParams.set('from',window.from)
  address.searchParams.set('to',window.to)
  let response
  try{
    response=await fetch(address.href,{
      method:'GET',
      headers:{'x-homeflow-bridge-token':env.KAKEBO_BRIDGE_TOKEN,'accept':'application/json'},
      redirect:'error',
    })
  }catch{return {error:'ledger_unreachable',status:503}}
  if(!response.ok)return {error:response.status===401?'ledger_token_invalid':'ledger_unreachable',status:503}
  const data=await response.json().catch(()=>null)
  if(!data||!Array.isArray(data.items)||data.items.length>200||data.items.some(x=>!expense(x)))
    return {error:'ledger_bad_response',status:502}
  return {data:{from:window.from,to:window.to,items:data.items.map(x=>({
    id:x.id,date:x.date,amount:x.amount,category:x.category,merchant:x.merchant
  })),truncated:!!data.truncated}}
}
const tripOf=(db,id,user)=>db.prepare(
  "SELECT id,title,created_by AS createdBy FROM trips WHERE id=?1 AND household_id=?2 AND created_by=?3")
    .bind(id,user.household_id,user.user_id).first()

export async function financeRoute(request,env,path,user){
  // This is exclusively the ledger owner's private integration, not a family-shared balance.
  if(user.role!=='owner')return json({error:'forbidden'},403)
  if(path==='/api/finance/status' && request.method==='GET')
    return json({configured:enabled(env),readOnly:true,ledger:'kakebo_jp'})
  if(!enabled(env))return json({error:'ledger_not_connected'},503)
  const m=path.match(/^\/api\/finance\/trips\/([a-f0-9-]{36})(?:\/links)?$/)
  if(!m)return json({error:'not_found'},404)
  const db=env.DB
  const trip=await tripOf(db,m[1],user)
  if(!trip)return json({error:'not_found'},404)
  const isLink=path.endsWith('/links')
  if(isLink&&request.method==='POST'){
    const body=await readBody(request)
    if(!body||!Number.isSafeInteger(body.entryId)||body.entryId<1||typeof body.linked!=='boolean')
      return json({error:'invalid_input'},400)
    if(!body.linked){
      await db.prepare("DELETE FROM finance_links WHERE household_id=?1 AND created_by=?2 AND target_type='trip' AND target_id=?3 AND external_entry_id=?4")
        .bind(user.household_id,user.user_id,trip.id,String(body.entryId)).run()
      return json({ok:true,linked:false})
    }
    // Linking requires a fresh, explicitly selected transaction from the actual ledger.
    const from=body.from,to=body.to
    const fakeRequest=new Request('https://homeflow.invalid/api/finance/trips/'+trip.id+
      '?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to))
    const window=windowOf(fakeRequest)
    if(!window)return json({error:'invalid_date_range'},400)
    const result=await remote(env,window)
    if(result.error)return json({error:result.error},result.status)
    if(!result.data.items.some(x=>x.id===body.entryId))
      return json({error:'entry_not_in_window'},404)
    await db.prepare("INSERT OR IGNORE INTO finance_links(id,household_id,created_by,target_type,target_id,external_entry_id) VALUES(?1,?2,?3,'trip',?4,?5)")
      .bind(crypto.randomUUID(),user.household_id,user.user_id,trip.id,String(body.entryId)).run()
    return json({ok:true,linked:true})
  }
  if(!isLink&&request.method==='GET'){
    const window=windowOf(request)
    if(!window)return json({error:'invalid_date_range'},400)
    const result=await remote(env,window)
    if(result.error)return json({error:result.error},result.status)
    const {results:associations=[]}=await db.prepare(
      "SELECT external_entry_id FROM finance_links WHERE household_id=?1 AND created_by=?2 AND target_type='trip' AND target_id=?3 LIMIT 1000")
      .bind(user.household_id,user.user_id,trip.id).all()
    const linked=new Set(associations.map(row=>row.external_entry_id))
    const items=result.data.items.map(x=>({...x,linked:linked.has(String(x.id))}))
    const total=items.filter(x=>x.linked).reduce((a,x)=>a+x.amount,0)
    return json({trip:{id:trip.id,title:trip.title},window,items,linkedTotal:total,
      shownTotal:items.reduce((a,x)=>a+x.amount,0),truncated:result.data.truncated,
      note:'Amounts are actual expenses from kakebo_jp. Only explicitly linked entries are counted; no transactions are copied.'})
  }
  return json({error:'method_not_allowed'},405)
}
