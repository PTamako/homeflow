import {iso,json,readBody,shortText,validDate} from './security.js'
import {listFilters,monthWindow} from './list-pagination.js'
import {jstToday} from './routine-periods.js'
import {actionWindow,actionDue} from './today-actions.js'
import {readTodayRows} from './today-source-read.js'
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
// A Today row is a dated VIEW of a task/plan, not the source record.
// Validate the key's shape before using its source type in an allowlisted SQL table.
function parseTodayItemKey(key){
  if(typeof key!=='string'||key.length>140)return null
  const parts=key.split(':')
  const isPlan=parts[0]==='plan'
  const kind=isPlan?parts[1]:parts[0]
  const uuid=isPlan?parts[2]:parts[1]
  const extra=isPlan?parts[3]:parts[2]
  const table={task:'tasks',routine:'routines',shopping:'shopping_items',
    wish:'wishes',goal:'goals',trip:'trips'}[kind]
  if(!table||!/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(uuid||'')||
    !/^[0-9a-f-]{36}$/i.test(uuid||''))return null
  if(isPlan){
    if(parts.length!==3&&parts.length!==4)return null
    if(!['shopping','wish','goal','trip'].includes(kind))return null
    if(extra!==undefined&&!/^(?:once|\d{4}(?:-\d{2})?)$/.test(extra))return null
  }else if(kind==='task'){
    if(parts.length!==2)return null
  }else if(kind==='routine'){
    if(parts.length!==3||(extra!==''&&!/^\d{4}-\d{2}-\d{2}$/.test(extra)))return null
  }else return null
  return {table,id:uuid,ownerColumn:kind==='task'?'creator_user_id':'created_by'}
}
export async function tasksRoute(request,db,path,session,onComplete=null,options={}) {
  const household=session.household_id,who=session.user_id
  if(path==='/api/tasks/today/dismiss'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    const body=await readBody(request)
    const parsed=parseTodayItemKey(body?.itemKey)
    if(!parsed||body?.date!==jstToday())return json({error:'invalid_input'},400)
    const {table,id,ownerColumn}=parsed
    // Same visibility boundary as Today source lists; hiding is user-private.
    const source=await db.prepare('SELECT 1 FROM '+table+
      " WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR "+
      ownerColumn+'=?3) LIMIT 1')
      .bind(id,household,who).first()
    if(!source)return json({error:'not_found'},404)
    await db.prepare(`INSERT OR IGNORE INTO today_dismissals
      (household_id,user_id,view_on,item_key) VALUES(?1,?2,?3,?4)`)
      .bind(household,who,body.date,body.itemKey).run()
    return json({ok:true})
  }
  if(path==='/api/tasks/trash' && request.method==='GET'){
    const params=new URL(request.url).searchParams
    const limit=params.has('limit')?Number(params.get('limit')):5
    const raw=params.get('cursor')||''
    if(!Number.isInteger(limit)||limit<1||limit>30||raw.length>120)
      return json({error:'invalid_input'},400)
    const args=[household,who],clauses=['household_id=?1','creator_user_id=?2','deleted_at IS NOT NULL']
    if(raw){
      const split=raw.lastIndexOf('|'),time=raw.slice(0,split),id=raw.slice(split+1)
      if(split<10||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(time)||
        !/^[a-f0-9-]{36}$/i.test(id))return json({error:'invalid_cursor'},400)
      clauses.push('(deleted_at<?3 OR (deleted_at=?4 AND id<?5))')
      args.push(time,time,id)
    }
    const sql='SELECT id,title,deleted_at AS deletedAt,due_on AS dueOn '+
      'FROM tasks WHERE '+clauses.join(' AND ')+
      ' ORDER BY deleted_at DESC,id DESC LIMIT ?'+(args.length+1)
    const {results}=await db.prepare(sql).bind(...args,limit+1).all()
    const all=results||[],items=all.slice(0,limit),last=items.at(-1)
    return json({items,nextCursor:all.length>limit&&last?last.deletedAt+'|'+last.id:null})
  }
  const restore=path.match(/^\/api\/tasks\/([a-f0-9-]{36})\/restore$/i)
  if(restore){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    const stamp=iso()
    const result=await db.prepare('UPDATE tasks SET deleted_at=NULL,updated_at=?1 '+
      'WHERE id=?2 AND household_id=?3 AND creator_user_id=?4 AND deleted_at IS NOT NULL')
      .bind(stamp,restore[1],household,who).run()
    if(!result.meta?.changes)return json({error:'not_found'},404)
    return json({ok:true,restored:true})
  }
  if(path==='/api/tasks' && request.method==='GET'){
    // Plans and history use bounded keyset pages; no COUNT(*) or deep OFFSET scans.
    const filters=listFilters(request.url)
    if(filters?.invalid)return json({error:'invalid_input'},400)
    if(filters){
      const dueSort=filters.scope==='active'&&new URL(request.url).searchParams.get('order')==='due'
      const column=filters.scope==='history'?'completed_at':'created_at'
      const sortColumn=dueSort?"COALESCE(due_on,'9999-12-31')":column
      const where=["household_id=?1","deleted_at IS NULL",
        "(visibility='household' OR creator_user_id=?2)"]
      const args=[household,who]
      if(filters.scope==='active')where.push("completed_at IS NULL")
      if(filters.scope==='unscheduled')where.push('completed_at IS NULL AND due_on IS NULL')
      if(filters.scope==='history')where.push("completed_at IS NOT NULL")
      const window=monthWindow(filters.year,filters.month)
      if(window){
        where.push(column+'>=?'+(args.length+1)+' AND '+column+'<?'+(args.length+2))
        args.push(window.start,window.end)
      }
      if(filters.cursor){
        where.push('('+sortColumn+(dueSort?'>':'<')+'?'+(args.length+1)+' OR ('+
          sortColumn+'=?'+(args.length+2)+' AND id'+(dueSort?'>':'<')+'?'+(args.length+3)+'))')
        args.push(filters.cursor.date,filters.cursor.date,filters.cursor.id)
      }
      const sql=`SELECT id,title,notes,visibility,due_on AS dueOn,
        creator_user_id AS creatorUserId,assignee_user_id AS assigneeUserId,
        subject_profile_id AS subjectProfileId,health_record_type AS healthRecordType,
        completed_at AS completedAt,remind_enabled AS remindEnabled,
        created_at AS createdAt,updated_at AS updatedAt FROM tasks
        WHERE `+where.join(' AND ')+' ORDER BY '+sortColumn+(dueSort?' ASC,id ASC':' DESC,id DESC')+' LIMIT ?'+(args.length+1)
      const {results}=await db.prepare(sql).bind(...args,filters.limit+1).all()
      const rows=results||[],items=rows.slice(0,filters.limit),last=items[items.length-1]
      return json({items,nextCursor:rows.length>filters.limit&&last?
        (dueSort?last.dueOn||'9999-12-31':filters.scope==='history'?last.completedAt:last.createdAt)+'|'+last.id:null})
    }
    const url=new URL(request.url)
    const mode=url.searchParams.get('status')||'open'
    if(!['open','done','all'].includes(mode))return json({error:'invalid_status'},400)
    const today=url.searchParams.get('today')
    const showHistory=url.searchParams.get('showHistory')==='1'
    if(today!==null&&!validDate(today))return json({error:'invalid_date'},400)
    if(today==='')return json({error:'invalid_date'},400)
    const tomorrow=today?new Date(Date.parse(today+'T00:00:00+09:00')+86400000).toISOString():null
    const todayStart=today?new Date(today+'T00:00:00+09:00').toISOString():null
    const sourceSql=`SELECT id,title,notes,visibility,due_on AS dueOn,
      creator_user_id AS creatorUserId,assignee_user_id AS assigneeUserId,
      subject_profile_id AS subjectProfileId,health_record_type AS healthRecordType,
      completed_at AS completedAt,
      completed_by AS completedBy,remind_enabled AS remindEnabled,created_at AS createdAt,updated_at AS updatedAt
      FROM tasks WHERE household_id=?1 AND deleted_at IS NULL
        AND (visibility='household' OR creator_user_id=?2)
        AND (?3='all' OR (?3='open' AND completed_at IS NULL)
          OR (?3='done' AND completed_at IS NOT NULL))
        AND (?4 IS NULL OR
          (completed_at IS NULL AND due_on IS NOT NULL AND (due_on=?4 OR
            id IN (SELECT source_id FROM today_plan_actions WHERE household_id=?1
              AND kind='task' AND action='postponed' AND postponed_to=?4))) OR
          (completed_at IS NOT NULL AND (?7=1 OR (completed_at>=?5 AND completed_at<?6))))`
    const bindings=[household,who,mode,today,todayStart,tomorrow,showHistory?1:0]
    const {results}=options.fullToday&&today
      ? {results:await readTodayRows(db,sourceSql,bindings)}
      : await db.prepare(sourceSql+` ORDER BY CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,
          CASE WHEN due_on IS NULL THEN 1 ELSE 0 END,due_on,created_at DESC LIMIT 250`)
        .bind(...bindings).all()
    // No overdue task rolls into Today automatically. Manual target dates are
    // displayed once, and explicit skips remain only in the history log.
    const actions=today?await actionWindow(db,household,today):[]
    const listed=(results||[]).filter(row=>row.completedAt||
      !today||actionDue('task',row.id,row.dueOn,today,actions))
      .map(row=>row.completedAt||!today?row:{...row,dueOn:today})
    // The new Today screen never dismisses entries implicitly. Keep legacy
    // dismissal lookup opt-in for old clients, avoiding a D1 read every day.
    let hiddenTodayKeys=[]
    if(today&&url.searchParams.get('legacyDismissals')==='1'){
      const hidden=await db.prepare(`SELECT item_key FROM today_dismissals
        WHERE household_id=?1 AND user_id=?2 AND view_on=?3 LIMIT 250`)
        .bind(household,who,today).all()
      hiddenTodayKeys=(hidden.results||[]).map(row=>row.item_key)
    }
    return json({tasks:listed,hiddenTodayKeys})
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
  if(request.method==='GET'){
    return json({task:{id:task.id,title:task.title,notes:task.notes,
      dueOn:task.due_on,visibility:task.visibility,
      creatorUserId:task.creator_user_id,assigneeUserId:task.assignee_user_id,
      subjectProfileId:task.subject_profile_id,healthRecordType:task.health_record_type,
      completedAt:task.completed_at,remindEnabled:task.remind_enabled,
      updatedAt:task.updated_at}})
  }
  if(request.method==='PATCH'){
    const b=await readBody(request)
    if(!b)return json({error:'invalid_input'},400)
    // Completing a shared task is allowed to both members. Editing belongs to creator.
    if(Object.prototype.hasOwnProperty.call(b,'completed')){
      if(typeof b.completed!=='boolean')return json({error:'invalid_input'},400)
      // Only a state transition creates or archives a record. Replays and
      // multi-device taps are idempotent, and writes share one D1 transaction.
      if(task.assignee_user_id&&task.assignee_user_id!==who&&task.creator_user_id!==who)
        return json({error:'forbidden'},403)
      if(Boolean(task.completed_at)===b.completed)return json({ok:true,unchanged:true})
      const stamp=iso(),date=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
      const update=db.prepare(`UPDATE tasks SET completed_at=?1,completed_by=?2,updated_at=?3
        WHERE id=?4 AND household_id=?5 AND deleted_at IS NULL
          AND (visibility='household' OR creator_user_id=?2)
          AND ${b.completed?'completed_at IS NULL':'completed_at IS NOT NULL'}`)
        .bind(b.completed?stamp:null,b.completed?who:null,stamp,task.id,household)
      let changed=0
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
        const results=await db.batch([update,care])
        changed=Number(results?.[0]?.meta?.changes||0)
      }else if(!b.completed){
        const archive=db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP
          WHERE household_id=?1 AND source_task_id=?2 AND deleted_at IS NULL`)
          .bind(household,task.id)
        const results=await db.batch([update,archive])
        changed=Number(results?.[0]?.meta?.changes||0)
      }else{
        const result=await update.run()
        changed=Number(result?.meta?.changes||0)
      }
      if(!changed)return json({ok:true,unchanged:true})
      if(b.completed)onComplete?.({kind:'task',id:task.id,title:task.title,
        creatorId:task.creator_user_id,assigneeId:task.assignee_user_id,
        visibility:task.visibility,completedAt:stamp})
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
