import {json,readBody,shortText,validDate} from './security.js'
import {listFilters,monthWindow} from './list-pagination.js'
const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)
const goodDate=x=>typeof x==='string'&&x!==''&&validDate(x)
const reminderLabels={deworm:'驱虫',vaccination:'疫苗',vet:'复诊',medication:'用药',grooming:'护理',weight:'称重',other:'健康回访'}
const reminderTitle=(name,type)=>name+' · '+reminderLabels[type]
const linkedTaskWasGenerated=(task,record,name)=>!!task&&task.deleted_at===null&&
 task.completed_at===null&&task.assignee_user_id===null&&
 task.title===reminderTitle(name,record.record_type)&&
 (task.notes||'')===(record.note||'')&&task.due_on===record.next_due_on
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
   const filters=listFilters(request.url)
   if(filters?.invalid)return json({error:'invalid_input'},400)
   if(filters){
     const clauses=["household_id=?1","profile_id=?2","deleted_at IS NULL",
       "(visibility='household' OR created_by=?3)"]
     const args=[h,profileId,u]
     const window=monthWindow(filters.year,filters.month)
     if(window){
       clauses.push('event_on>=?4 AND event_on<?5')
       args.push(window.start,window.end)
     }
     if(filters.cursor){
       const n=args.length+1
       clauses.push('(event_on<?'+n+' OR (event_on=?'+(n+1)+' AND id<?'+(n+2)+'))')
       args.push(filters.cursor.date,filters.cursor.date,filters.cursor.id)
     }
     const sql='SELECT id,record_type AS recordType,event_on AS eventOn,'+
       'weight_grams AS weightGrams,note,next_due_on AS nextDueOn,'+
       'created_by AS createdBy,visibility,created_at AS createdAt,'+
       'source_routine_id AS sourceRoutineId,source_task_id AS sourceTaskId FROM pet_health_records WHERE '+
       clauses.join(' AND ')+' ORDER BY event_on DESC,id DESC LIMIT ?'+(args.length+1)
     const {results}=await db.prepare(sql).bind(...args,filters.limit+1).all()
     const records=(results||[]).slice(0,filters.limit)
     const last=records[records.length-1]
     return json({pet,records,nextCursor:(results||[]).length>filters.limit&&last?
       last.eventOn+'|'+last.id:null})
   }
   const {results}=await db.prepare(`SELECT id,record_type AS recordType,event_on AS eventOn,
     weight_grams AS weightGrams,note,next_due_on AS nextDueOn,
     created_by AS createdBy,visibility,created_at AS createdAt,
     source_routine_id AS sourceRoutineId,source_task_id AS sourceTaskId FROM pet_health_records
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
       .bind(taskId,h,u,profileId,visibility,reminderTitle(pet.display_name,type),next,note)
     )
   }
   await db.batch(statements)
   return json({ok:true,id,createdReminder:!!next},201)
 }
 if(recordId&&['PATCH','DELETE'].includes(request.method)){
   const rec=await db.prepare(`SELECT id,created_by,linked_task_id,record_type,note,next_due_on FROM pet_health_records
     WHERE id=?1 AND household_id=?2 AND profile_id=?3 AND deleted_at IS NULL`)
     .bind(recordId,h,profileId).first()
   if(!rec)return json({error:'not_found'},404)
   if(rec.created_by!==u)return json({error:'forbidden'},403)
   // Never overwrite an independently edited or completed task.
   const task=rec.linked_task_id?await db.prepare(`SELECT id,title,notes,due_on,assignee_user_id,completed_at,deleted_at
     FROM tasks WHERE id=?1 AND household_id=?2 AND creator_user_id=?3`)
     .bind(rec.linked_task_id,h,u).first():null
   const ownedReminder=linkedTaskWasGenerated(task,rec,pet.display_name)
   const oldId=rec.linked_task_id
   const stamp=new Date().toISOString()
   if(request.method==='DELETE'){
     const statements=[db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP,linked_task_id=NULL
       WHERE id=?1 AND household_id=?2 AND created_by=?3`).bind(recordId,h,u)]
     if(ownedReminder)statements.push(db.prepare(`UPDATE tasks SET deleted_at=?1,updated_at=?1
       WHERE id=?2 AND household_id=?3 AND creator_user_id=?4 AND completed_at IS NULL AND deleted_at IS NULL`)
       .bind(stamp,oldId,h,u))
     await db.batch(statements)
     return json({ok:true,reminderRetained:!!oldId&&!ownedReminder})
   }
   const b=await readBody(request)
   const type=b?.recordType,eventOn=b?.eventOn,next=b?.nextDueOn||null
   const weight=b?.weightGrams==null?null:Number(b.weightGrams)
   const note=shortText(b?.note,1000)
   const visibility=['private','household'].includes(b?.visibility)?b.visibility:'household'
   if(!['weight','deworm','vaccination','vet','medication','grooming','other'].includes(type)||
      !goodDate(eventOn)||(next&&!goodDate(next))||(next&&next<eventOn)||
      (weight!==null&&(!Number.isInteger(weight)||weight<=0||weight>=100000))||
      (type==='weight'&&weight===null)||note.length>1000)return json({error:'invalid_input'},400)
   const newId=next&&(!oldId||!ownedReminder)?crypto.randomUUID():null
   const linkedId=newId||(next&&ownedReminder?oldId:null)
   const statements=[db.prepare(`UPDATE pet_health_records SET visibility=?1,record_type=?2,event_on=?3,
     weight_grams=?4,note=?5,next_due_on=?6,linked_task_id=?7
     WHERE id=?8 AND household_id=?9 AND created_by=?10`)
     .bind(visibility,type,eventOn,weight,note,next,linkedId,recordId,h,u)]
   if(ownedReminder){
     if(next){
       statements.push(db.prepare(`UPDATE tasks SET title=?1,due_on=?2,notes=?3,visibility=?4,updated_at=?5
         WHERE id=?6 AND household_id=?7 AND creator_user_id=?8 AND completed_at IS NULL AND deleted_at IS NULL`)
         .bind(reminderTitle(pet.display_name,type),next,note,visibility,stamp,oldId,h,u))
     }else{
       statements.push(db.prepare(`UPDATE tasks SET deleted_at=?1,updated_at=?1
         WHERE id=?2 AND household_id=?3 AND creator_user_id=?4 AND completed_at IS NULL AND deleted_at IS NULL`)
         .bind(stamp,oldId,h,u))
     }
   }
   if(newId)statements.push(db.prepare(`INSERT INTO tasks
     (id,household_id,creator_user_id,subject_profile_id,visibility,title,due_on,notes)
     VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
     .bind(newId,h,u,profileId,visibility,reminderTitle(pet.display_name,type),next,note))
   await db.batch(statements)
   return json({ok:true,reminderUpdated:!!linkedId,
     reminderDetached:!!oldId&&!ownedReminder,createdReminder:!!newId})
 }
 return json({error:'method_not_allowed'},405)
}
