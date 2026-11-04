import {json,readBody,shortText,validDate} from './security.js'
const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)
const goodDate=x=>typeof x==='string'&&x!==''&&validDate(x)
export async function petsRoute(request,db,path,session){
 const match=path.match(/^\/api\/pets\/([0-9a-f-]{36})\/health(?:\/([0-9a-f-]{36}))?$/)
 if(!match)return json({error:'not_found'},404)
 const [profileId,recordId]=match.slice(1)
 const pet=await db.prepare(`SELECT id,display_name FROM family_profiles
   WHERE id=?1 AND household_id=?2 AND type='pet' AND archived_at IS NULL`)
   .bind(profileId,session.household_id).first()
 if(!pet)return json({error:'not_found'},404)
 const h=session.household_id,u=session.user_id
 if(!recordId&&request.method==='GET'){
   const {results}=await db.prepare(`SELECT id,record_type AS recordType,event_on AS eventOn,
     weight_grams AS weightGrams,note,next_due_on AS nextDueOn,
     created_by AS createdBy,visibility,created_at AS createdAt FROM pet_health_records
     WHERE household_id=?1 AND profile_id=?2 AND deleted_at IS NULL
     AND (visibility='household' OR created_by=?3)
     ORDER BY event_on DESC,created_at DESC LIMIT 250`).bind(h,profileId,u).all()
   return json({pet,records:results||[]})
 }
 if(!recordId&&request.method==='POST'){
   const b=await readBody(request)
   const type=b?.recordType
   const eventOn=b?.eventOn
   const weight=b?.weightGrams==null?null:Number(b.weightGrams)
   const note=shortText(b?.note,1000)
   const next=b?.nextDueOn||null
   const visibility=['private','household'].includes(b?.visibility)?b.visibility:'household'
   if(!['weight','deworm','vaccination','vet','medication','grooming','other'].includes(type)||
     !goodDate(eventOn)||(next&&!goodDate(next))||(next&&next<eventOn)||
     (weight!==null&&(!Number.isInteger(weight)||weight<=0||weight>=100000))||
     (type==='weight'&&weight===null)||note.length>1000)return json({error:'invalid_input'},400)
   const id=crypto.randomUUID(),taskId=next?crypto.randomUUID():null
   const statements=[
     db.prepare(`INSERT INTO pet_health_records
       (id,household_id,profile_id,created_by,visibility,record_type,event_on,weight_grams,note,next_due_on,linked_task_id)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
       .bind(id,h,profileId,u,visibility,type,eventOn,weight,note,next,taskId)
   ]
   if(next){
     statements.unshift(db.prepare(`INSERT INTO tasks
       (id,household_id,creator_user_id,subject_profile_id,visibility,title,due_on,notes)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
       .bind(taskId,h,u,profileId,visibility,pet.display_name+' · '+({deworm:'驱虫',vaccination:'疫苗',vet:'复诊',medication:'用药',grooming:'护理',weight:'称重',other:'健康回访'}[type]),next,note)
     )
   }
   await db.batch(statements)
   return json({ok:true,id,createdReminder:!!next},201)
 }
 if(recordId&&request.method==='DELETE'){
   const rec=await db.prepare(`SELECT created_by,linked_task_id FROM pet_health_records
     WHERE id=?1 AND household_id=?2 AND profile_id=?3 AND deleted_at IS NULL`)
     .bind(recordId,h,profileId).first()
   if(!rec)return json({error:'not_found'},404)
   if(rec.created_by!==u)return json({error:'forbidden'},403)
   // Archive health history; do not silently remove independently assigned tasks.
   await db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP
     WHERE id=?1 AND household_id=?2 AND created_by=?3`).bind(recordId,h,u).run()
   return json({ok:true,reminderRetained:!!rec.linked_task_id})
 }
 return json({error:'method_not_allowed'},405)
}
