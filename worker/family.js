import {json,readBody,shortText,validDate} from './security.js'
const nameOK=x=>x && x.length<=60
const canEdit=(session,profile)=>session.role==='owner' || profile.member_user_id===session.user_id || (!profile.member_user_id && session.role==='owner')
const sanitize=body=>{
  const name=shortText(body?.displayName,60)
  const type=body?.type
  const birthday=body?.birthday??null, adoptedOn=body?.adoptedOn??null
  const relation=shortText(body?.relation,40)
  const weight=body?.weightGrams==null||body.weightGrams===''?null:Number(body.weightGrams)
  const notes=shortText(body?.notes,500)
  if(!nameOK(name)||!['person','pet'].includes(type)||!validDate(birthday)||!validDate(adoptedOn)||
    (weight!==null && (!Number.isInteger(weight)||weight<=0||weight>=100000)) ||
    notes.length>500 || relation.length>40) return null
  return {name,type,birthday:birthday||null,adoptedOn:adoptedOn||null,weight,notes,relation}
}
export async function familyRoute(request,db,path,session) {
  const household=session.household_id
  if(path==='/api/family' && request.method==='GET') {
    const [profiles,members]=await db.batch([
      db.prepare(`SELECT id,member_user_id AS memberUserId,type,display_name AS displayName,birthday,
        relation,adopted_on AS adoptedOn,weight_grams AS weightGrams,notes
        FROM family_profiles WHERE household_id=?1 AND archived_at IS NULL ORDER BY created_at,id LIMIT 100`).bind(household),
      db.prepare(`SELECT u.id,u.login_name AS loginName,m.role FROM household_members m
       JOIN users u ON u.id=m.user_id WHERE m.household_id=?1 LIMIT 10`).bind(household)
    ])
    return json({profiles:profiles.results||[],members:members.results||[],household:{id:household,name:session.household_name}})
  }
  if(path==='/api/family/profiles' && request.method==='POST') {
    if(session.role!=='owner')return json({error:'forbidden'},403)
    const b=sanitize(await readBody(request))
    if(!b)return json({error:'invalid_input'},400)
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO family_profiles
      (id,household_id,type,display_name,birthday,relation,adopted_on,weight_grams,notes)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind(id,household,b.type,b.name,b.birthday,b.relation,b.adoptedOn,b.weight,b.notes).run()
    return json({ok:true,id},201)
  }
  const match=path.match(/^\/api\/family\/profiles\/([0-9a-f-]{36})$/)
  if(!match)return json({error:'not_found'},404)
  const profile=await db.prepare('SELECT id,member_user_id,type FROM family_profiles WHERE id=?1 AND household_id=?2 AND archived_at IS NULL')
    .bind(match[1],household).first()
  if(!profile)return json({error:'not_found'},404)
  if(!canEdit(session,profile))return json({error:'forbidden'},403)
  if(request.method==='PATCH') {
    const input=await readBody(request)
    const type=input?.type||profile.type
    const b=sanitize({...input,type})
    if(!b || type!==profile.type)return json({error:'invalid_input'},400)
    await db.prepare(`UPDATE family_profiles SET display_name=?1,birthday=?2,relation=?3,
      adopted_on=?4,weight_grams=?5,notes=?6 WHERE id=?7 AND household_id=?8 AND archived_at IS NULL`)
      .bind(b.name,b.birthday,b.relation,b.adoptedOn,b.weight,b.notes,profile.id,household).run()
    return json({ok:true})
  }
  if(request.method==='DELETE'){
    if(profile.member_user_id)return json({error:'linked_profile_cannot_delete'},409)
    await db.prepare("UPDATE family_profiles SET archived_at=CURRENT_TIMESTAMP WHERE id=?1 AND household_id=?2")
      .bind(profile.id,household).run()
    return json({ok:true})
  }
  return json({error:'method_not_allowed'},405)
}
