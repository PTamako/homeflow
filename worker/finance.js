// Server-to-server read-only connection to kakebo_jp.
// User-approved ledger entry IDs are the only financial records stored in HomeFlow D1.
import {json,readBody} from './security.js'
const dateOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x
const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x)
const ready=env=>{
  if(env.APP_ENV!=='production')return false
  if(typeof env.KAKEBO_LEDGER_READ_TOKEN!=='string'||env.KAKEBO_LEDGER_READ_TOKEN.length<32)return false
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
    const response=await fetch(u.toString(),{method:'GET',
      headers:{Authorization:'Bearer '+env.KAKEBO_LEDGER_READ_TOKEN,Accept:'application/json'},
      signal:controller.signal,redirect:'error'})
    if(!response.ok)throw Error('ledger_unavailable_'+response.status)
    const data=await response.json()
    if(!Array.isArray(data.entries))throw Error('invalid_ledger_payload')
    return data
  }finally{clearTimeout(timeout)}
}
async function target(db,householdId,userId,kind,id){
  if(!['trip','goal'].includes(kind)||!idOk(id))return null
  const table=kind==='trip'?'trips':'goals'
  return db.prepare('SELECT id FROM '+table+' WHERE id=?1 AND household_id=?2 AND created_by=?3')
    .bind(id,householdId,userId).first()
}
const financeError=()=>json({error:'ledger_connection_unavailable'},502)
export async function financeRoute(request,env,path,session){
  if(session.role!=='owner')return json({error:'forbidden'},403)
  const db=env.DB
  if(path==='/api/finance/status'&&request.method==='GET'){
    return json({connected:ready(env),readOnly:true,ownerOnly:true})
  }
  if(!ready(env))return json({error:'integration_not_configured'},503)
  const url=new URL(request.url),user=session.user_id,h=session.household_id
  const shop=path.match(/^\/api\/finance\/shopping\/([0-9a-f-]{36})\/link$/i)
  if(shop&&(request.method==='POST'||request.method==='DELETE')){
    // Only the creator may attach a real expense to an existing shopping item.
    // A manually checked task is never treated as a verified purchase.
    const item=await db.prepare('SELECT id,created_by,ledger_entry_id FROM shopping_items WHERE id=?1 AND household_id=?2')
      .bind(shop[1],h).first()
    if(!item)return json({error:'not_found'},404)
    if(item.created_by!==user)return json({error:'forbidden'},403)
    if(request.method==='DELETE'){
      await db.prepare('UPDATE shopping_items SET ledger_entry_id=NULL,completed_at=NULL,completed_by=NULL WHERE id=?1 AND household_id=?2 AND created_by=?3')
        .bind(item.id,h,user).run()
      return json({ok:true,unlinked:true})
    }
    const b=await readBody(request),entryId=String(b?.entryId??'')
    if(!/^[1-9]\d{0,11}$/.test(entryId))return json({error:'invalid_input'},400)
    try{
      const found=await ledger(env,{ids:entryId})
      if(!found.entries.some(x=>String(x.id)===entryId&&x.type==='expense'))
        return json({error:'entry_not_found'},404)
      await db.prepare('UPDATE shopping_items SET ledger_entry_id=?1,completed_at=?2,completed_by=?3 WHERE id=?4 AND household_id=?5 AND created_by=?3')
        .bind(entryId,new Date().toISOString(),user,item.id,h).run()
      return json({ok:true,linked:true,completed:true})
    }catch{return financeError()}
  }
  if(path==='/api/finance/candidates'&&request.method==='GET'){
    const start=url.searchParams.get('start'),end=url.searchParams.get('end'),cursor=url.searchParams.get('cursor')
    if(!dateOk(start)||!dateOk(end)||end<start||
       Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>90*86400000)return json({error:'invalid_range'},400)
    try{
      const data=await ledger(env,{start,end,limit:50,cursor})
      return json({entries:data.entries,nextCursor:data.nextCursor||null,readOnly:true})
    }catch{return financeError()}
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
    }catch{return financeError()}
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
    }catch{return financeError()}
  }
  const match=path.match(/^\/api\/finance\/links\/([0-9a-f-]{36})$/)
  if(match&&request.method==='DELETE'){
    await db.prepare('DELETE FROM finance_links WHERE id=?1 AND household_id=?2 AND created_by=?3')
      .bind(match[1],h,user).run()
    return json({ok:true})
  }
  return json({error:'not_found'},404)
}
