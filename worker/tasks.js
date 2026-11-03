import {iso,json,readBody,shortText,validDate} from './security.js'
function validated(body,session) {
  const title=shortText(body?.title,150),notes=shortText(body?.notes??'',1000)
  const visibility=body?.visibility
  const dueOn=body?.dueOn??null
  const assignee=body?.assigneeUserId||null
  const subject=body?.subjectProfileId||null
  if(!title||title.length>150||notes.length>1000||!['private','household'].includes(visibility) ||
    !validDate(dueOn)|| (visibility==='private' && assignee && assignee!==session.user_id)) return null
  if(assignee && (typeof assignee!=='string'||assignee.length>60))return null
  if(subject && (typeof subject!=='string'||subject.length>60))return null
  return {title,notes,visibility,dueOn:dueOn||null,assignee,subject}
}
async function validateRefs(db,session,data) {
  if(data.assignee){
    const a=await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2')
      .bind(session.household_id,data.assignee).first()
    if(!a)return false
  }
  if(data.subject) {
    const p=await db.prepare('SELECT 1 FROM family_profiles WHERE id=?1 AND household_id=?2 AND archived_at IS NULL')
      .bind(data.subject,session.household_id).first()
    if(!p)return false
  }
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
      subject_profile_id AS subjectProfileId,completed_at AS completedAt,
      completed_by AS completedBy,created_at AS createdAt
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
    const data=validated(await readBody(request),session)
    if(!data||!await validateRefs(db,session,data))return json({error:'invalid_input'},400)
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO tasks
      (id,household_id,creator_user_id,assignee_user_id,subject_profile_id,visibility,title,notes,due_on)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind(id,household,who,data.assignee,data.subject,data.visibility,data.title,data.notes,data.dueOn).run()
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
      await db.prepare(`UPDATE tasks SET completed_at=?1,completed_by=?2,updated_at=?3
        WHERE id=?4 AND household_id=?5 AND deleted_at IS NULL
        AND (visibility='household' OR creator_user_id=?2)`)
        .bind(b.completed?iso():null,b.completed?who:null,iso(),task.id,household).run()
      return json({ok:true})
    }
    if(task.creator_user_id!==who)return json({error:'forbidden'},403)
    const data=validated(b,session)
    if(!data||!await validateRefs(db,session,data))return json({error:'invalid_input'},400)
    await db.prepare(`UPDATE tasks SET title=?1,notes=?2,visibility=?3,
      due_on=?4,assignee_user_id=?5,subject_profile_id=?6,updated_at=?7
      WHERE id=?8 AND household_id=?9 AND creator_user_id=?10 AND deleted_at IS NULL`)
      .bind(data.title,data.notes,data.visibility,data.dueOn,data.assignee,data.subject,iso(),task.id,household,who).run()
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
