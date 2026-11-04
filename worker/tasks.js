import {iso,json,readBody,shortText,validDate} from './security.js'
function validated(body,session) {
  const title=shortText(body?.title,150),notes=shortText(body?.notes??'',1000)
  const visibility=body?.visibility
  const dueOn=body?.dueOn??null
  const assignee=body?.assigneeUserId||null
  const subject=body?.subjectProfileId||null
  const care=body?.healthRecordType
  const reminder=body?.remindEnabled===undefined?null:body.remindEnabled
  if(reminder!==null&&typeof reminder!=='boolean')return null
  if(care!==undefined&&care!==null&&!['deworm','vaccination','vet','medication','grooming','other'].includes(care))return null
  if(!title||title.length>150||notes.length>1000||!['private','household'].includes(visibility) ||
    !validDate(dueOn)|| (visibility==='private' && assignee && assignee!==session.user_id)) return null
  if(assignee && (typeof assignee!=='string'||assignee.length>60))return null
  if(subject && (typeof subject!=='string'||subject.length>60))return null
  return {title,notes,visibility,dueOn:dueOn||null,assignee,subject,care,reminder}
}
async function validateRefs(db,session,data) {
  if(data.assignee){
    const a=await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2')
      .bind(session.household_id,data.assignee).first()
    if(!a)return false
  }
  if(data.subject) {
    const p=await db.prepare('SELECT type FROM family_profiles WHERE id=?1 AND household_id=?2 AND archived_at IS NULL')
      .bind(data.subject,session.household_id).first()
    if(!p || (data.care&&p.type!=='pet'))return false
    // A linked pet automatically logs daily care unless the user explicitly opts out.
    if(p.type==='pet'&&data.care===undefined)data.care='other'
  }else{
    if(data.care)return false
    data.care=null
  }
  if(data.care===undefined)data.care=null
  return true
}
export async function tasksRoute(request,db,path,session) {
  const household=session.household_id,who=session.user_id
  if(path==='/api/tasks' && request.method==='GET'){
    const url=new URL(request.url)
    const mode=url.searchParams.get('status')||'open'
    if(!['open','done','all'].includes(mode))return json({error:'invalid_status'},400)
    const {results}=await db.prepare(`SELECT id,title,notes,visibility,due_on AS dueOn,
      creator_user_id AS creatorUserId,assignee_user_id AS assigneeUserId,
      subject_profile_id AS subjectProfileId,health_record_type AS healthRecordType,
      completed_at AS completedAt,
      completed_by AS completedBy,remind_enabled AS remindEnabled,created_at AS createdAt,updated_at AS updatedAt
      FROM tasks WHERE household_id=?1 AND deleted_at IS NULL
        AND (visibility='household' OR creator_user_id=?2)
        AND (?3='all' OR (?3='open' AND completed_at IS NULL)
          OR (?3='done' AND completed_at IS NOT NULL))
      ORDER BY CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,
        CASE WHEN due_on IS NULL THEN 1 ELSE 0 END,due_on,created_at DESC
      LIMIT 250`).bind(household,who,mode).all()
    return json({tasks:results||[]})
  }
  if(path==='/api/tasks' && request.method==='POST'){
    const body=await readBody(request)
    const data=validated(body,session)
    if(!data||!await validateRefs(db,session,data))return json({error:'invalid_input'},400)
    const reqId=body?.clientRequestId||null
    if(reqId && (typeof reqId!=='string'||!/^[0-9a-f-]{36}$/.test(reqId)))return json({error:'invalid_request_id'},400)
    const id=crypto.randomUUID()
    const result=await db.prepare(`INSERT OR IGNORE INTO tasks
      (id,household_id,creator_user_id,assignee_user_id,subject_profile_id,visibility,title,notes,due_on,client_request_id,health_record_type,remind_enabled)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`)
      .bind(id,household,who,data.assignee,data.subject,data.visibility,data.title,data.notes,data.dueOn,reqId,data.care,data.reminder===false?0:1).run()
    if(!result.meta?.changes && reqId){
      const found=await db.prepare('SELECT id FROM tasks WHERE household_id=?1 AND creator_user_id=?2 AND client_request_id=?3')
        .bind(household,who,reqId).first()
      if(found)return json({ok:true,id:found.id,replayed:true})
    }
    if(!result.meta?.changes)return json({error:'task_creation_conflict'},409)
    return json({ok:true,id},201)
  }
  const match=path.match(/^\/api\/tasks\/([0-9a-f-]{36})$/)
  if(!match)return json({error:'not_found'},404)
  const task=await db.prepare(`SELECT * FROM tasks WHERE id=?1 AND household_id=?2
    AND deleted_at IS NULL AND (visibility='household' OR creator_user_id=?3)`)
    .bind(match[1],household,who).first()
  if(!task)return json({error:'not_found'},404)
  if(request.method==='PATCH'){
    const b=await readBody(request)
    if(!b)return json({error:'invalid_input'},400)
    // Completing a shared task is allowed to both members. Editing belongs to creator.
    if(Object.prototype.hasOwnProperty.call(b,'completed')){
      if(typeof b.completed!=='boolean')return json({error:'invalid_input'},400)
      // Only a state transition creates or archives a record. Replays and
      // multi-device taps are idempotent, and writes share one D1 transaction.
      if(Boolean(task.completed_at)===b.completed)return json({ok:true,unchanged:true})
      const stamp=iso(),date=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
      const update=db.prepare(`UPDATE tasks SET completed_at=?1,completed_by=?2,updated_at=?3
        WHERE id=?4 AND household_id=?5 AND deleted_at IS NULL
          AND (visibility='household' OR creator_user_id=?2)
          AND ${b.completed?'completed_at IS NULL':'completed_at IS NOT NULL'}`)
        .bind(b.completed?stamp:null,b.completed?who:null,stamp,task.id,household)
      if(b.completed && task.subject_profile_id && task.health_record_type){
        const care=db.prepare(`INSERT INTO pet_health_records
          (id,household_id,profile_id,created_by,visibility,record_type,event_on,note,source_task_id)
          SELECT ?1,t.household_id,t.subject_profile_id,?2,t.visibility,
            t.health_record_type,?3,t.title,t.id
          FROM tasks t JOIN family_profiles p ON p.id=t.subject_profile_id AND p.household_id=t.household_id
          WHERE t.id=?4 AND t.household_id=?5 AND t.completed_at=?6
            AND t.deleted_at IS NULL AND p.type='pet' AND p.archived_at IS NULL
          ON CONFLICT(source_task_id) DO UPDATE SET deleted_at=NULL`)
          .bind(crypto.randomUUID(),who,date,task.id,household,stamp)
        await db.batch([update,care])
      }else if(!b.completed){
        const archive=db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP
          WHERE household_id=?1 AND source_task_id=?2 AND deleted_at IS NULL`)
          .bind(household,task.id)
        await db.batch([update,archive])
      }else await update.run()
      return json({ok:true})
    }
    if(task.creator_user_id!==who)return json({error:'forbidden'},403)
    const data=validated(b,session)
    if(data && data.care===undefined && data.subject===task.subject_profile_id)
      data.care=task.health_record_type
    if(!data||!await validateRefs(db,session,data))return json({error:'invalid_input'},400)
    if(b.expectedUpdatedAt && b.expectedUpdatedAt!==task.updated_at)
      return json({error:'task_edit_conflict',currentUpdatedAt:task.updated_at},409)
    const result=await db.prepare(`UPDATE tasks SET title=?1,notes=?2,visibility=?3,
      due_on=?4,assignee_user_id=?5,subject_profile_id=?6,
      health_record_type=?7,remind_enabled=COALESCE(?8,remind_enabled),updated_at=?9
      WHERE id=?10 AND household_id=?11 AND creator_user_id=?12 AND deleted_at IS NULL
        AND updated_at=?13`)
      .bind(data.title,data.notes,data.visibility,data.dueOn,data.assignee,data.subject,data.care,data.reminder===null?null:data.reminder?1:0,iso(),task.id,household,who,task.updated_at).run()
    if(!result.meta?.changes)return json({error:'task_edit_conflict'},409)
    return json({ok:true})
  }
  if(request.method==='DELETE'){
    if(task.creator_user_id!==who)return json({error:'forbidden'},403)
    await db.prepare(`UPDATE tasks SET deleted_at=?1,updated_at=?1
      WHERE id=?2 AND household_id=?3 AND creator_user_id=?4 AND deleted_at IS NULL`)
      .bind(iso(),task.id,household,who).run()
    return json({ok:true})
  }
  return json({error:'method_not_allowed'},405)
}
