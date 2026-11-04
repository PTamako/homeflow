import {iso,json,readBody,sha256,shortText,validDate} from './security.js'
import {listFilters,monthWindow} from './list-pagination.js'
const idOk=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(x)
const textOk=(x,n=500)=>typeof x==='string'&&x.length>0&&x.length<=n
const dateOk=x=>typeof x==='string'&&x!==''&&validDate(x)
const amountOk=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000000000
const list=(x,max)=>Array.isArray(x)&&x.length<=max
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
function validatedTripPayload(p){
  if(!object(p)||p.format!=='homeflow.trip'||p.schemaVersion!==1||!idOk(p.importSourceId)||!object(p.trip))return 'invalid_header'
  const t=p.trip
  if(!idOk(t.externalId)||!textOk(t.title)||!textOk(t.destination)||!dateOk(t.startDate)||!dateOk(t.endDate)||
    t.startDate>t.endDate||!textOk(t.timeZone,80)||!list(t.participants,20)||!t.participants.length||
    !t.participants.every(idOk)||!/^[A-Z]{3}$/.test(t.currency)||!object(t.budget)||!amountOk(t.budget.amount)||
    t.budget.currency!==t.currency||!['estimate','confirmed'].includes(t.budget.status)||!list(t.days,120)||!t.days.length)return 'invalid_trip'
  const collections=[['tasks',500],['packingLists',100],['bookings',100],['reminders',300]]
  for(const [key,max] of collections)if(t[key]!==undefined&&!list(t[key],max))return 'invalid_'+key
  const seen=new Set()
  for(const day of t.days){
    if(!object(day)||!dateOk(day.date)||day.date<t.startDate||day.date>t.endDate||!list(day.items,100))return 'invalid_day'
    for(const e of day.items){
      if(!object(e)||!idOk(e.externalId)||!textOk(e.title)||seen.has(e.externalId)||
        e.startTime!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.startTime)||
        e.endTime!=null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.endTime)||
        !object(e.place)||!textOk(e.place.name)||!['transport','lodging','sightseeing','meal','shopping','activity','other'].includes(e.category)||
        !['not_booked','pending','booked','cancelled'].includes(e.bookingStatus)||
        !object(e.verification)||!['unverified','verified','needs_recheck'].includes(e.verification.status))return 'invalid_itinerary'
      seen.add(e.externalId)
    }
  }
  const taskIds=new Set()
  for(const task of t.tasks||[]){
    if(!object(task)||!idOk(task.externalId)||!textOk(task.title)||taskIds.has(task.externalId)||
      task.dueDate!==null&&task.dueDate!==undefined&&!dateOk(task.dueDate)||
      !idOk(task.assignee)||!['private','household','selected_members'].includes(task.visibility))return 'invalid_task'
    taskIds.add(task.externalId)
  }
  for(const p of t.packingLists||[]){
    if(!object(p)||!idOk(p.externalId)||!idOk(p.owner)||!list(p.items,300))return 'invalid_packing'
    for(const item of p.items)if(!object(item)||!idOk(item.externalId)||!textOk(item.label)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>999)return 'invalid_packing'
  }
  for(const booking of t.bookings||[])if(!object(booking)||!idOk(booking.externalId)||!textOk(booking.title)||
    !['flight','train','hotel','activity','restaurant','other'].includes(booking.kind)||
    !['not_booked','pending','booked','cancelled'].includes(booking.status))return 'invalid_booking'
  for(const reminder of t.reminders||[])if(!object(reminder)||!idOk(reminder.externalId)||!idOk(reminder.target)||
    !Number.isInteger(reminder.offsetDays)||Math.abs(reminder.offsetDays)>365)return 'invalid_reminder'
  return null
}
export {validatedTripPayload}
// For shared trips, the imported plan can contain creator-only preparations.
// Filter on the server: never rely on the UI to hide sensitive items.
export function visiblePlan(original,creator){
  if(!original||creator)return original
  const plan=structuredClone(original)
  const trip=plan.trip
  if(!trip)return plan
  trip.tasks=(trip.tasks||[]).filter(t=>t.visibility==='household')
  trip.packingLists=(trip.packingLists||[]).filter(l=>l.visibility!=='private'&&l.visibility!=='selected_members')
  trip.bookings=(trip.bookings||[]).filter(b=>b.visibility!=='private'&&b.visibility!=='selected_members')
  const visibleIds=new Set([
    ...(trip.days||[]).flatMap(d=>d.items||[]).map(x=>x.externalId),
    ...trip.tasks.map(t=>t.externalId),
    ...trip.packingLists.flatMap(l=>l.items||[]).map(x=>x.externalId),
  ])
  trip.reminders=(trip.reminders||[]).filter(r=>visibleIds.has(r.target))
  return plan
}

export async function tripsRoute(request,db,path,session){
  const bpath=path.split('/').filter(Boolean)
  const id=bpath[2]
  const h=session.household_id,u=session.user_id
  if(path==='/api/trips'&&request.method==='GET'){
    const filters=listFilters(request.url)
    if(filters?.invalid)return json({error:'invalid_input'},400)
    if(filters){
      const sort='COALESCE(start_on,created_at)'
      const clauses=["household_id=?1","(visibility='household' OR created_by=?2)"]
      const args=[h,u]
      // A past end date does not mean the trip was actually completed:
      // unfinished travel follow-ups must remain findable under active plans.
      if(filters.scope==='active')
        clauses.push("status NOT IN ('completed','cancelled')")
      else if(filters.scope==='history')
        clauses.push("status IN ('completed','cancelled')")
      const window=monthWindow(filters.year,filters.month)
      if(window){
        const n=args.length+1
        clauses.push(sort+'>=?'+n+' AND '+sort+'<?'+(n+1))
        args.push(window.start,window.end)
      }
      if(filters.cursor){
        const n=args.length+1
        clauses.push('('+sort+'<?'+n+' OR ('+sort+'=?'+(n+1)+' AND id<?'+(n+2)+'))')
        args.push(filters.cursor.date,filters.cursor.date,filters.cursor.id)
      }
      const sql=`SELECT id,wish_id AS wishId,title,destination,start_on AS startOn,
        end_on AS endOn,budget_amount AS budgetAmount,currency,status,visibility,created_by AS createdBy,
        import_source_key AS importSourceKey,updated_at AS updatedAt,COALESCE(start_on,created_at) AS sortDate
        FROM trips WHERE `+clauses.join(' AND ')+' ORDER BY '+sort+' DESC,id DESC LIMIT ?'+(args.length+1)
      const {results}=await db.prepare(sql).bind(...args,filters.limit+1).all()
      const rows=results||[],items=rows.slice(0,filters.limit),last=items[items.length-1]
      return json({items,nextCursor:rows.length>filters.limit&&last?last.sortDate+'|'+last.id:null})
    }
    const {results}=await db.prepare(`SELECT id,wish_id AS wishId,title,destination,start_on AS startOn,
        end_on AS endOn,budget_amount AS budgetAmount,currency,status,visibility,created_by AS createdBy,import_source_key AS importSourceKey,updated_at AS updatedAt
        FROM trips WHERE household_id=?1 AND (visibility='household' OR created_by=?2)
        ORDER BY COALESCE(start_on,created_at) DESC LIMIT 150`).bind(h,u).all()
    return json({items:results||[]})
  }
  if(path==='/api/trips'&&request.method==='POST'){
    // A regular trip can be created from the plan hub without requiring a
    // complete import JSON. Its itinerary may be added later.
    const b=await readBody(request)
    const title=shortText(b?.title,150)
    const destination=shortText(b?.destination||'',300)
    const start=b?.startDate||null,end=b?.endDate||null
    const budget=b?.budgetAmount??0
    const visibility=['private','household'].includes(b?.visibility)?b.visibility:'household'
    if(!title||(start&&!dateOk(start))||(end&&!dateOk(end))||
       (start&&end&&start>end)||!amountOk(budget))return json({error:'invalid_input'},400)
    const newId=crypto.randomUUID()
    await db.prepare(`INSERT INTO trips
      (id,household_id,created_by,visibility,title,destination,start_on,end_on,budget_amount,currency,status)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'JPY','planning')`)
      .bind(newId,h,u,visibility,title,destination,start,end,budget).run()
    return json({ok:true,id:newId},201)
  }
  if(path==='/api/trips/import'&&request.method==='POST'){
    const len=Number(request.headers.get('content-length')||0)
    if(len>300000)return json({error:'import_too_large'},413)
    const source=await request.text()
    if(source.length>300000)return json({error:'import_too_large'},413)
    let body
    try{body=JSON.parse(source)}catch{return json({error:'invalid_json'},400)}
    const payload=body?.payload
    if(!payload)return json({error:'invalid_json'},400)
    const issue=validatedTripPayload(payload)
    if(issue)return json({error:issue},400)
    const hash=await sha256(JSON.stringify(payload))
    const matching=await db.prepare(`SELECT id,created_by,visibility,import_hash FROM trips
      WHERE household_id=?1 AND import_source_key=?2`).bind(h,payload.importSourceId).first()
    // A trip created from a wish can be populated by an imported plan without losing wish_id.
    const targetId=body.targetTripId||null
    if(targetId&&!/^[0-9a-f-]{36}$/.test(targetId))return json({error:'invalid_input'},400)
    const target=targetId?await db.prepare(`SELECT id,created_by,visibility,import_hash FROM trips
      WHERE household_id=?1 AND id=?2`).bind(h,targetId).first():null
    if(targetId&&!target)return json({error:'not_found'},404)
    if(target&&matching&&matching.id!==target.id)return json({error:'import_source_already_linked'},409)
    const current=target||matching
    const summary={days:payload.trip.days.length,itineraryItems:payload.trip.days.reduce((n,d)=>n+d.items.length,0),
      tasks:(payload.trip.tasks||[]).length,packing:(payload.trip.packingLists||[]).reduce((n,l)=>n+l.items.length,0),
      bookings:(payload.trip.bookings||[]).length}
    if(body.preview===true)return json({ok:true,preview:true,changes:current?current.import_hash===hash?'unchanged':'update':'new',summary})
    if(current && current.created_by!==u)return json({error:'forbidden'},403)
    if(current && current.import_hash===hash)return json({ok:true,id:current.id,unchanged:true})
    if(current && body.confirmReplace!==true)return json({error:'confirm_replace_required',summary},409)
    const data=payload.trip
    if(current){
      await db.prepare(`UPDATE trips SET title=?1,destination=?2,start_on=?3,end_on=?4,
        timezone=?5,budget_amount=?6,currency=?7,plan_json=?8,import_hash=?9,import_source_key=?10,updated_at=?11
        WHERE id=?12 AND household_id=?13 AND created_by=?14`)
      .bind(data.title,data.destination,data.startDate,data.endDate,data.timeZone,
        data.budget.amount,data.currency,JSON.stringify(payload),hash,payload.importSourceId,iso(),current.id,h,u).run()
      return json({ok:true,id:current.id,updated:true,preservedProgress:true})
    }
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO trips(id,household_id,created_by,visibility,title,destination,
      start_on,end_on,timezone,budget_amount,currency,import_source_key,import_hash,plan_json)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`)
    .bind(id,h,u,body.visibility==='household'?'household':'private',data.title,data.destination,
      data.startDate,data.endDate,data.timeZone,data.budget.amount,data.currency,payload.importSourceId,hash,JSON.stringify(payload)).run()
    return json({ok:true,id,created:true},201)
  }
  const convert=path.match(/^\/api\/wishes\/([0-9a-f-]{36})\/start-trip$/)
  if(convert&&request.method==='POST'){
    const wish=await db.prepare(`SELECT id,title,visibility,estimated_amount,currency,created_by
      FROM wishes WHERE id=?1 AND household_id=?2 AND created_by=?3 AND wish_type='trip'`)
      .bind(convert[1],h,u).first()
    if(!wish)return json({error:'not_found'},404)
    const existing=await db.prepare('SELECT id FROM trips WHERE wish_id=?1 AND household_id=?2').bind(wish.id,h).first()
    if(existing)return json({ok:true,id:existing.id,alreadyConverted:true})
    const body=await readBody(request)
    const dest=shortText(body?.destination,300)
    const title=shortText(body?.title||wish.title,150)
    const start=body?.startDate||null,end=body?.endDate||null
    if(!title||!dest||(start&&!dateOk(start))||(end&&!dateOk(end))||(start&&end&&start>end))return json({error:'invalid_input'},400)
    const id=crypto.randomUUID()
    try{
      await db.batch([
        db.prepare(`INSERT INTO trips(id,household_id,created_by,visibility,wish_id,title,destination,start_on,end_on,budget_amount,currency)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
          .bind(id,h,u,wish.visibility,wish.id,title,dest,start,end,wish.estimated_amount,wish.currency),
        db.prepare(`UPDATE wishes SET status='planning',updated_at=?1 WHERE id=?2 AND household_id=?3 AND created_by=?4`)
          .bind(iso(),wish.id,h,u)
      ])
      return json({ok:true,id,created:true},201)
    }catch{return json({error:'conflict_or_expired'},409)}
  }
  if(id&&!/^[0-9a-f-]{36}$/.test(id))return json({error:'invalid_input'},400)
  if(id){
    const trip=await db.prepare(`SELECT * FROM trips WHERE id=?1 AND household_id=?2 AND
      (visibility='household' OR created_by=?3)`).bind(id,h,u).first()
    if(!trip)return json({error:'not_found'},404)
    if(bpath[3]==='progress'&&request.method==='POST'){
      const body=await readBody(request)
      if(!body||!idOk(body.itemId)||typeof body.completed!=='boolean')return json({error:'invalid_input'},400)
      const plan=visiblePlan(trip.plan_json?JSON.parse(trip.plan_json):null,trip.created_by===u)
      const ids=new Set([...(plan?.trip?.days||[]).flatMap(d=>d.items||[]).map(x=>x.externalId),
        ...(plan?.trip?.tasks||[]).map(x=>x.externalId),
        ...(plan?.trip?.packingLists||[]).flatMap(p=>p.items||[]).map(x=>x.externalId)])
      if(!ids.has(body.itemId))return json({error:'not_found'},404)
      await db.prepare(`INSERT INTO trip_progress(trip_id,item_id,completed_at,completed_by)
        VALUES(?1,?2,?3,?4)
        ON CONFLICT(trip_id,item_id) DO UPDATE SET completed_at=excluded.completed_at,completed_by=excluded.completed_by`)
        .bind(id,body.itemId,body.completed?iso():null,body.completed?u:null).run()
      return json({ok:true})
    }
    if(request.method==='GET'){
      const plan=visiblePlan(trip.plan_json?JSON.parse(trip.plan_json):null,trip.created_by===u)
      const allowed=plan?.trip?new Set([
        ...(plan.trip.days||[]).flatMap(d=>d.items||[]).map(x=>x.externalId),
        ...(plan.trip.tasks||[]).map(x=>x.externalId),
        ...(plan.trip.packingLists||[]).flatMap(l=>l.items||[]).map(x=>x.externalId)
      ]):null
      const {results}=await db.prepare('SELECT item_id AS itemId,completed_at AS completedAt FROM trip_progress WHERE trip_id=?1').bind(id).all()
      return json({trip:{id:trip.id,title:trip.title,destination:trip.destination,startOn:trip.start_on,
        endOn:trip.end_on,budgetAmount:trip.budget_amount,currency:trip.currency,status:trip.status,
        visibility:trip.visibility,createdBy:trip.created_by,plan},progress:allowed?(results||[]).filter(r=>allowed.has(r.itemId)):[]})
    }
    if(bpath[3]==='items'&&bpath[4]&&['PATCH','DELETE'].includes(request.method)){
      if(trip.created_by!==u)return json({error:'forbidden'},403)
      const ext=bpath[4]
      if(!idOk(ext)||!trip.plan_json)return json({error:'not_found'},404)
      let plan
      try{plan=JSON.parse(trip.plan_json)}catch{return json({error:'invalid_saved_plan'},409)}
      const sources=[
        ...(plan.trip?.days||[]).map(x=>x.items||[]),
        plan.trip?.tasks||[],
        ...(plan.trip?.packingLists||[]).map(x=>x.items||[]),
        plan.trip?.bookings||[]
      ]
      let found=null,collection=null
      for(const arr of sources)for(const row of arr)if(row.externalId===ext){found=row;collection=arr;break}
      if(!found||!collection)return json({error:'not_found'},404)
      if(request.method==='DELETE'){
        collection.splice(collection.indexOf(found),1)
      }else{
        const body=await readBody(request)
        const value=shortText(body?.title,150)
        if(!value||value.length>150)return json({error:'invalid_input'},400)
        if('label' in found)found.label=value
        else found.title=value
        if(body.quantity!==undefined&&'quantity' in found){
          if(!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>9999)return json({error:'invalid_input'},400)
          found.quantity=body.quantity
        }
      }
      const raw=JSON.stringify(plan)
      const hash=await sha256(raw)
      await db.batch([
        db.prepare('UPDATE trips SET plan_json=?1,import_hash=?2,updated_at=?3 WHERE id=?4 AND household_id=?5 AND created_by=?6')
          .bind(raw,hash,iso(),id,h,u),
        ...(request.method==='DELETE'?[db.prepare('DELETE FROM trip_progress WHERE trip_id=?1 AND item_id=?2').bind(id,ext)]:[])
      ])
      return json({ok:true,removed:request.method==='DELETE'})
    }
    if(request.method==='PATCH'){
      if(trip.created_by!==u)return json({error:'forbidden'},403)
      const b=await readBody(request)
      if(b?.expectedUpdatedAt&&b.expectedUpdatedAt!==trip.updated_at)
        return json({error:'trip_edit_conflict',currentUpdatedAt:trip.updated_at},409)
      if(!['planning','active','completed','cancelled'].includes(b?.status))return json({error:'invalid_input'},400)
      const title=b.title===undefined?trip.title:shortText(b.title,150)
      const destination=b.destination===undefined?trip.destination:shortText(b.destination,300)
      const start=b.startDate===undefined?trip.start_on:(b.startDate||null)
      const end=b.endDate===undefined?trip.end_on:(b.endDate||null)
      const budget=b.budgetAmount===undefined?trip.budget_amount:b.budgetAmount
      if(!title||(b.destination!==undefined&&typeof b.destination!=='string')||
         (start&&!dateOk(start))||(end&&!dateOk(end))||(start&&end&&start>end)||
         !Number.isSafeInteger(budget)||budget<0||budget>100000000000)
        return json({error:'invalid_input'},400)
      let plan=trip.plan_json,hash=trip.import_hash
      if(plan){
        try{
          const p=JSON.parse(plan)
          p.trip.title=title;p.trip.destination=destination
          if(start)p.trip.startDate=start
          if(end)p.trip.endDate=end
          p.trip.budget.amount=budget
          plan=JSON.stringify(p);hash=await sha256(plan)
        }catch{return json({error:'invalid_saved_plan'},409)}
      }
      const timestamp=iso()
      const updated=await db.prepare(`UPDATE trips SET title=?1,destination=?2,start_on=?3,end_on=?4,budget_amount=?5,
        status=?6,plan_json=?7,import_hash=?8,updated_at=?9
        WHERE id=?10 AND household_id=?11 AND created_by=?12 AND updated_at=?13`)
        .bind(title,destination,start,end,budget,b.status,plan,hash,timestamp,id,h,u,trip.updated_at).run()
      if(!updated.meta?.changes)return json({error:'trip_edit_conflict'},409)
      if(trip.wish_id&&b.status==='completed'){
        await db.prepare("UPDATE wishes SET status='completed',updated_at=?1 WHERE id=?2 AND household_id=?3")
          .bind(timestamp,trip.wish_id,h).run()
      }
      return json({ok:true})
    }
    if(request.method==='DELETE'){
      if(trip.created_by!==u)return json({error:'forbidden'},403)
      await db.batch([
        db.prepare('DELETE FROM finance_links WHERE household_id=?1 AND target_type=?2 AND target_id=?3').bind(h,'trip',id),
        db.prepare('DELETE FROM trips WHERE id=?1 AND household_id=?2 AND created_by=?3').bind(id,h,u)
      ])
      return json({ok:true})
    }
  }
  return json({error:'not_found'},404)
}
