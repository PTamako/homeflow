// Server-to-server read-only connection to kakebo_jp.
// User-approved ledger entry IDs are the only financial records stored in HomeFlow D1.
import {json,readBody} from './security.js'
import {goalPeriod} from './goal-period.js'
const dateOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x
const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x)
const ready=env=>{
  if(env.APP_ENV!=='production')return false
  if(typeof env.KAKEBO_LEDGER_SERVICE?.fetch!=='function')return false
  try{
    const u=new URL(env.KAKEBO_LEDGER_API_URL)
    return u.protocol==='https:'&&u.hostname==='kakeibo-f17.pages.dev'&&
      u.pathname==='/api/homeflow-ledger'&&!u.search&&!u.hash&&!u.username&&!u.password
  }catch{return false}
}
export function canUseLedger(env,session){return !!session&&session.role==='owner'&&ready(env)}
async function ledger(env,params){
  if(!ready(env))throw Error('integration_not_ready')
  const u=new URL(env.KAKEBO_LEDGER_API_URL)
  Object.entries(params).forEach(([k,v])=>{if(v!==null&&v!==undefined)u.searchParams.set(k,String(v))})
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),8000)
  try{
    let response
    try{
      response=await env.KAKEBO_LEDGER_SERVICE.fetch(u.toString(),{method:'GET',
        headers:{Accept:'application/json'},
        signal:controller.signal,redirect:'manual'})
    }catch(error){
      throw Error(error?.name==='AbortError'?'ledger_timeout':'ledger_network_error')
    }
    if(!response.ok){
      const problem=await response.json().catch(()=>null)
      if(response.status===401)throw Error('ledger_auth_failed')
      if(response.status===403)throw Error('ledger_access_blocked')
      if(response.status===404)throw Error('ledger_endpoint_missing')
      if(response.status===503){
        if(problem?.error==='integration_disabled')throw Error('ledger_source_token_missing')
        if(problem?.error==='ledger_read_unavailable')throw Error('ledger_source_db_unavailable')
        throw Error('ledger_source_unavailable')
      }
      throw Error('ledger_upstream_unavailable')
    }
    const data=await response.json().catch(()=>null)
    if(params.summary==='net'){
      if(!Number.isSafeInteger(data?.income)||!Number.isSafeInteger(data?.expense)||
         !Number.isSafeInteger(data?.net)||data.income-data.expense!==data.net)
        throw Error('ledger_invalid_response')
    }else if(!Array.isArray(data?.entries))throw Error('ledger_invalid_response')
    return data
  }finally{clearTimeout(timeout)}
}
async function target(db,householdId,userId,kind,id){
  if(!['trip','goal'].includes(kind)||!idOk(id))return null
  const table=kind==='trip'?'trips':'goals'
  return db.prepare('SELECT '+(kind==='goal'?'id,reserved_amount,target_amount,goal_mode,start_on,target_on':'id')+' FROM '+table+" WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)")
    .bind(id,householdId,userId).first()
}
// Per-target adjustments are optional and do not alter the ledger.
async function financeTarget(db,h,user,kind,id){
  if(!['goal','trip','shopping'].includes(kind)||!idOk(id))return null
  if(kind==='shopping')return db.prepare(
    "SELECT id,ledger_entry_id FROM shopping_items WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)")
      .bind(id,h,user).first()
  return target(db,h,user,kind,id)
}
async function savedSettings(db,h,kind,id){
  return db.prepare('SELECT adjustment_amount,period_start,period_end FROM finance_target_settings WHERE household_id=?1 AND target_type=?2 AND target_id=?3')
    .bind(h,kind,id).first()
}
const validAdjustment=n=>Number.isSafeInteger(n)&&Math.abs(n)<=100000000000
const validPeriod=(start,end)=>dateOk(start)&&dateOk(end)&&end>=start&&
  Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')<=3660*86400000
const LEDGER_ERROR_CODES=new Set([
  'ledger_auth_failed','ledger_access_blocked','ledger_endpoint_missing',
  'ledger_source_token_missing','ledger_source_db_unavailable','ledger_source_unavailable',
  'ledger_upstream_unavailable','ledger_invalid_response','ledger_timeout','ledger_network_error'
])
const financeError=error=>json({error:LEDGER_ERROR_CODES.has(error?.message)
  ?error.message:'ledger_connection_unavailable'},502)
export async function financeRoute(request,env,path,session){
  if(session.role!=='owner')return json({error:'forbidden'},403)
  const db=env.DB
  if(path==='/api/finance/status'&&request.method==='GET'){
    return json({connected:ready(env),readOnly:true,ownerOnly:true})
  }
  if(!ready(env))return json({error:'integration_not_configured'},503)
  const url=new URL(request.url),user=session.user_id,h=session.household_id
  if(path==='/api/finance/goal/net'&&request.method==='GET'){
    const id=url.searchParams.get('targetId')
    const goal=await financeTarget(db,h,user,'goal',id)
    if(!goal)return json({error:'not_found'},404)
    let start=url.searchParams.get('start'),end=url.searchParams.get('end')
    const cadence=goal.goal_mode||'once'
    const key=url.searchParams.get('periodKey')
    if(cadence!=='once'){
      const window=goalPeriod(goal,key)
      if(!window)return json({error:'invalid_range'},400)
      if(window.notStarted)return json({
        start:window.start,end:window.periodEnd,income:0,expense:0,net:0,
        readOnly:true,notStarted:true,periodKey:key
      })
      start=window.start;end=window.end
    }else if(goal.start_on&&start<goal.start_on)return json({error:'invalid_range'},400)
    if(!validPeriod(start,end))return json({error:'invalid_range'},400)
    try{
      const data=await ledger(env,{summary:'net',start,end})
      if(!Number.isSafeInteger(data.income)||!Number.isSafeInteger(data.expense)||
         !Number.isSafeInteger(data.net)||data.income-data.expense!==data.net)
        return json({error:'ledger_invalid_response'},502)
      return json({start,end,income:data.income,expense:data.expense,net:data.net,readOnly:true})
    }catch(error){return financeError(error)}
  }
  if(path==='/api/finance/settings'&&request.method==='PUT'){
    const body=await readBody(request)
    const kind=body?.type,id=body?.targetId,amount=body?.adjustmentAmount
    const item=await financeTarget(db,h,user,kind,id)
    if(!item)return json({error:'not_found'},404)
    if(kind==='goal'&&(item.goal_mode||'once')!=='once'){
      const window=goalPeriod(item,body?.periodKey)
      if(!window||!validAdjustment(amount))return json({error:'invalid_input'},400)
      await db.prepare(`INSERT INTO goal_period_adjustments
        (household_id,goal_id,period_key,adjustment_amount,updated_by,updated_at)
        VALUES(?1,?2,?3,?4,?5,CURRENT_TIMESTAMP)
        ON CONFLICT(household_id,goal_id,period_key) DO UPDATE SET
          adjustment_amount=excluded.adjustment_amount,updated_by=excluded.updated_by,
          updated_at=CURRENT_TIMESTAMP`)
        .bind(h,id,window.periodKey,amount,user).run()
      return json({ok:true,adjustmentAmount:amount,periodKey:window.periodKey,
        periodStart:window.start,periodEnd:window.periodEnd})
    }
    const start=kind==='goal'?(body?.periodStart||null):null
    const end=kind==='goal'?(body?.periodEnd||null):null
    if(!validAdjustment(amount)||Boolean(start)!==Boolean(end)||
      (start&&!validPeriod(start,end)))return json({error:'invalid_input'},400)
    await db.prepare(`INSERT INTO finance_target_settings
      (household_id,target_type,target_id,adjustment_amount,period_start,period_end,updated_by,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,CURRENT_TIMESTAMP)
      ON CONFLICT(household_id,target_type,target_id) DO UPDATE SET
      adjustment_amount=excluded.adjustment_amount,
      period_start=excluded.period_start,period_end=excluded.period_end,
      updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
      .bind(h,kind,id,amount,start,end,user).run()
    return json({ok:true,adjustmentAmount:amount,periodStart:start,periodEnd:end})
  }
  if(path==='/api/finance/settings'&&request.method==='GET'){
    const kind=url.searchParams.get('type'),id=url.searchParams.get('targetId')
    const item=await financeTarget(db,h,user,kind,id)
    if(!item)return json({error:'not_found'},404)
    if(kind==='goal'&&(item.goal_mode||'once')!=='once'){
      const window=goalPeriod(item,url.searchParams.get('periodKey'))
      if(!window)return json({error:'invalid_range'},400)
      const record=await db.prepare(`SELECT adjustment_amount FROM goal_period_adjustments
        WHERE household_id=?1 AND goal_id=?2 AND period_key=?3`)
        .bind(h,id,window.periodKey).first()
      return json({adjustmentAmount:record?.adjustment_amount||0,
        periodStart:window.start,periodEnd:window.periodEnd,
        periodKey:window.periodKey,goalMode:item.goal_mode,
        openingAmount:0,targetAmount:item.target_amount})
    }
    const saved=await savedSettings(db,h,kind,id)
    const result={adjustmentAmount:saved?.adjustment_amount||0,
      periodStart:saved?.period_start||null,periodEnd:saved?.period_end||null,
      openingAmount:kind==='goal'?item.reserved_amount||0:null,linkedAmount:null}
    if(kind==='shopping'&&item.ledger_entry_id){
      try{
        const data=await ledger(env,{ids:String(item.ledger_entry_id)})
        const entry=data.entries.find(x=>String(x.id)===String(item.ledger_entry_id))
        result.linkedAmount=entry?.type==='expense'?entry.amount:null
      }catch(error){return financeError(error)}
    }
    return json(result)
  }
  const shop=path.match(/^\/api\/finance\/shopping\/([0-9a-f-]{36})\/link$/i)
  if(shop&&(request.method==='POST'||request.method==='DELETE')){
    // Owner may verify any household-shared shopping item. Private items
    // created by other family members remain inaccessible.
    const item=await db.prepare('SELECT id,created_by,visibility,ledger_entry_id FROM shopping_items WHERE id=?1 AND household_id=?2')
      .bind(shop[1],h).first()
    if(!item)return json({error:'not_found'},404)
    if(item.created_by!==user&&item.visibility!=='household')return json({error:'forbidden'},403)
    if(request.method==='DELETE'){
      await db.prepare("UPDATE shopping_items SET ledger_entry_id=NULL,completed_at=NULL,completed_by=NULL WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)")
        .bind(item.id,h,user).run()
      return json({ok:true,unlinked:true})
    }
    const b=await readBody(request),entryId=String(b?.entryId??'')
    if(!/^[1-9]\d{0,11}$/.test(entryId))return json({error:'invalid_input'},400)
    try{
      const found=await ledger(env,{ids:entryId})
      if(!found.entries.some(x=>String(x.id)===entryId&&x.type==='expense'))
        return json({error:'entry_not_found'},404)
      await db.prepare("UPDATE shopping_items SET ledger_entry_id=?1,completed_at=?2,completed_by=?3 WHERE id=?4 AND household_id=?5 AND (visibility='household' OR created_by=?3)")
        .bind(entryId,new Date().toISOString(),user,item.id,h).run()
      return json({ok:true,linked:true,completed:true})
    }catch(error){return financeError(error)}
  }
  if(path==='/api/finance/candidates'&&request.method==='GET'){
    const start=url.searchParams.get('start'),end=url.searchParams.get('end'),cursor=url.searchParams.get('cursor')
    if(!dateOk(start)||!dateOk(end)||end<start||
       Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>90*86400000)return json({error:'invalid_range'},400)
    try{
      const data=await ledger(env,{start,end,limit:5,cursor})
      return json({entries:data.entries,nextCursor:data.nextCursor||null,readOnly:true})
    }catch(error){return financeError(error)}
  }
  if(path==='/api/finance/links'&&request.method==='GET'){
    const kind=url.searchParams.get('type'),id=url.searchParams.get('targetId')
    if(!await target(db,h,user,kind,id))return json({error:'not_found'},404)
    const {results}=await db.prepare('SELECT id,external_entry_id AS entryId FROM finance_links '+
       'WHERE household_id=?1 AND created_by=?2 AND target_type=?3 AND target_id=?4 '+
       'ORDER BY created_at DESC LIMIT 100')
       .bind(h,user,kind,id).all()
    const ids=[...new Set((results||[]).map(x=>x.entryId))]
    if(ids.length>50)return json({error:'too_many_links'},409)
    try{
      const data=ids.length?await ledger(env,{ids:ids.join(',')}):{entries:[]}
      const lookup=new Map(data.entries.map(x=>[String(x.id),x]))
      const items=(results||[]).map(x=>({linkId:x.id,entryId:x.entryId,
        entry:lookup.get(String(x.entryId))||null}))
      const total=items.reduce((a,x)=>a+(x.entry?.type==='expense'&&Number.isSafeInteger(x.entry?.amount)?x.entry.amount:0),0)
      return json({items,total,matched:items.filter(x=>x.entry).length,readOnly:true})
    }catch(error){return financeError(error)}
  }
  if(path==='/api/finance/links'&&request.method==='POST'){
    const b=await readBody(request)
    const kind=b?.type,id=b?.targetId,entryId=String(b?.entryId??'')
    if(!/^[1-9]\d{0,11}$/.test(entryId)||!await target(db,h,user,kind,id))
      return json({error:'invalid_input'},400)
    try{
      const found=await ledger(env,{ids:entryId})
      if(!found.entries.some(x=>String(x.id)===entryId&&x.type==='expense'))
        return json({error:'entry_not_found'},404)
      await db.prepare('INSERT OR IGNORE INTO finance_links '+
        '(id,household_id,created_by,target_type,target_id,external_entry_id) '+
        'VALUES(?1,?2,?3,?4,?5,?6)')
        .bind(crypto.randomUUID(),h,user,kind,id,entryId).run()
      return json({ok:true},201)
    }catch(error){return financeError(error)}
  }
  const match=path.match(/^\/api\/finance\/links\/([0-9a-f-]{36})$/)
  if(match&&request.method==='DELETE'){
    await db.prepare('DELETE FROM finance_links WHERE id=?1 AND household_id=?2 AND created_by=?3')
      .bind(match[1],h,user).run()
    return json({ok:true})
  }
  return json({error:'not_found'},404)
}
