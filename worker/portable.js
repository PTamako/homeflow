// Account-scoped portable JSON export and non-destructive incremental restore.
// Export only data CREATED by the requesting user; each family login backs up privately.
// A restore cannot replace records that already exist, steal ownership, or create new accounts.
import {json,validDate} from './security.js'
const ID=/^[0-9a-f-]{36}$/i
const id=x=>typeof x==='string'&&ID.test(x)
const date=x=>typeof x==='string'&&x.length===10&&validDate(x)
const vis=x=>x==='private'?'private':'household'
const str=(x,max)=>typeof x==='string'&&x.length<=max?x:null
const amount=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000000000
const profilesSQL="SELECT id,type,display_name,birthday,relation,adopted_on,weight_grams,notes FROM family_profiles "+
  "WHERE household_id=?1 AND member_user_id IS NULL AND archived_at IS NULL ORDER BY created_at LIMIT 501"
const queries=[
  ['familyProfiles',profilesSQL,'family'],
  ['wishes',"SELECT * FROM wishes WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['trips',"SELECT * FROM trips WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['goals',"SELECT * FROM goals WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['tasks',"SELECT * FROM tasks WHERE household_id=?1 AND creator_user_id=?2 AND deleted_at IS NULL ORDER BY created_at LIMIT 501"],
  ['anniversaries',"SELECT * FROM anniversaries WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['routines',"SELECT * FROM routines WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['shopping',"SELECT * FROM shopping_items WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['memories',"SELECT * FROM memories WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['petHealth',"SELECT * FROM pet_health_records WHERE household_id=?1 AND created_by=?2 AND deleted_at IS NULL ORDER BY created_at LIMIT 501"],
  ['routineMarks',"SELECT m.* FROM routine_marks m JOIN routines r ON r.id=m.routine_id "+
    "WHERE r.household_id=?1 AND r.created_by=?2 ORDER BY m.occurrence_on LIMIT 501"],
  ['tripProgress',"SELECT p.* FROM trip_progress p JOIN trips t ON t.id=p.trip_id "+
    "WHERE t.household_id=?1 AND t.created_by=?2 ORDER BY p.item_id LIMIT 501"],
  ['financeLinks',"SELECT id,target_type,target_id,external_entry_id FROM finance_links "+
    "WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"]
]
export const RESTORE_ORDER=queries.map(([key])=>key)
const exportMax=500
const allowed=new Set(RESTORE_ORDER)
function normalized(key,r,h,u) {
  if(!r||typeof r!=='object'||Array.isArray(r))return null
  const common=key==='routineMarks'||key==='tripProgress'?null:id(r.id)
  if(common===false)return null
  const v=vis(r.visibility)
  switch(key){
    case 'familyProfiles':
      if(!['pet','person'].includes(r.type)||str(r.display_name,60)===null||!r.display_name.trim()||
         (r.birthday&&!date(r.birthday))||(r.adopted_on&&!date(r.adopted_on))||
         (r.weight_grams!=null&&(!Number.isInteger(r.weight_grams)||r.weight_grams<1||r.weight_grams>=100000))||
         str(r.notes||'',500)===null||str(r.relation||'',40)===null)return null
      return ["INSERT OR IGNORE INTO family_profiles(id,household_id,type,display_name,birthday,relation,adopted_on,weight_grams,notes) "+
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        [r.id,h,r.type,r.display_name,r.birthday||null,r.relation||'',r.adopted_on||null,r.weight_grams??null,r.notes||'']]
    case 'wishes':
      if(str(r.title,150)===null||!r.title||!['trip','purchase','activity','other'].includes(r.wish_type)||
         !['wished','planning','active','completed','cancelled'].includes(r.status)||
         !amount(r.estimated_amount)||str(r.note||'',2000)===null)return null
      return ["INSERT OR IGNORE INTO wishes(id,household_id,created_by,visibility,title,wish_type,status,estimated_amount,currency,note) "+
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'JPY',?9)",
        [r.id,h,u,v,r.title,r.wish_type,r.status,r.estimated_amount,r.note||'']]
    case 'trips':
      if(!str(r.title,150)||str(r.destination||'',300)===null||(r.start_on&&!date(r.start_on))||
         (r.end_on&&!date(r.end_on))||!amount(r.budget_amount)||
         !['planning','active','completed','cancelled'].includes(r.status)||
         (r.plan_json!=null&&str(r.plan_json,160000)===null))return null
      return ["INSERT OR IGNORE INTO trips(id,household_id,created_by,visibility,wish_id,title,destination,start_on,end_on,"+
        "timezone,budget_amount,currency,status,import_source_key,import_hash,plan_json) "+
        "VALUES(?1,?2,?3,?4,(SELECT id FROM wishes WHERE id=?5 AND household_id=?2 AND created_by=?3),"+
        "?6,?7,?8,?9,?10,?11,'JPY',?12,?13,?14,?15)",
        [r.id,h,u,v,id(r.wish_id)?r.wish_id:null,r.title,r.destination||'',r.start_on||null,r.end_on||null,
         str(r.timezone,70)||'Asia/Tokyo',r.budget_amount,r.status||'planning',r.import_source_key||null,
         r.import_hash||null,r.plan_json||null]]
    case 'goals':
      if(!str(r.title,150)||!Number.isSafeInteger(r.target_amount)||r.target_amount<1||
         !amount(r.reserved_amount)||(r.target_on&&!date(r.target_on)))return null
      return ["INSERT OR IGNORE INTO goals(id,household_id,created_by,visibility,wish_id,title,target_amount,reserved_amount,currency,target_on) "+
        "VALUES(?1,?2,?3,?4,(SELECT id FROM wishes WHERE id=?5 AND household_id=?2 AND created_by=?3),?6,?7,?8,'JPY',?9)",
        [r.id,h,u,v,id(r.wish_id)?r.wish_id:null,r.title,r.target_amount,r.reserved_amount,r.target_on||null]]
    case 'tasks':
      if(!str(r.title,150)||str(r.notes||'',1000)===null||(r.due_on&&!date(r.due_on)))return null
      return ["INSERT OR IGNORE INTO tasks(id,household_id,creator_user_id,visibility,title,notes,due_on,completed_at,"+
         "completed_by,subject_profile_id,client_request_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,"+
         "(SELECT id FROM family_profiles WHERE id=?10 AND household_id=?2),?11)",
        [r.id,h,u,v,r.title,r.notes||'',r.due_on||null,r.completed_at||null,r.completed_at?u:null,
         id(r.subject_profile_id)?r.subject_profile_id:null,id(r.client_request_id)?r.client_request_id:null]]
    case 'anniversaries':
      if(!str(r.title,150)||!date(r.event_date)||!['once','yearly','monthly'].includes(r.repeat_mode))return null
      return ["INSERT OR IGNORE INTO anniversaries(id,household_id,created_by,visibility,title,event_date,repeat_mode,advance_days_json,note,subject_profile_id) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,(SELECT id FROM family_profiles WHERE id=?10 AND household_id=?2))",
         [r.id,h,u,v,r.title,r.event_date,r.repeat_mode,str(r.advance_days_json,100)||'[7,1,0]',
          str(r.note,1000)||'',id(r.subject_profile_id)?r.subject_profile_id:null]]
    case 'routines':
      if(!str(r.title,150)||!date(r.anchor_date)||
         !['daily','weekly','monthly','interval'].includes(r.repeat_type)||
         str(r.repeat_config,1200)===null||(r.next_due_on&&!date(r.next_due_on)))return null
      return ["INSERT OR IGNORE INTO routines(id,household_id,created_by,visibility,title,repeat_type,repeat_config,anchor_date,enabled,next_due_on,subject_profile_id,health_record_type) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,(SELECT id FROM family_profiles WHERE id=?11 AND household_id=?2),?12)",
         [r.id,h,u,v,r.title,r.repeat_type,r.repeat_config,r.anchor_date,r.enabled===0?0:1,
          r.next_due_on||null,id(r.subject_profile_id)?r.subject_profile_id:null,
          ['deworm','vaccination','vet','medication','grooming','other'].includes(r.health_record_type)?r.health_record_type:null]]
    case 'shopping':
      if(!str(r.title,150)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>9999)return null
      return ["INSERT OR IGNORE INTO shopping_items(id,household_id,created_by,visibility,title,quantity,completed_at,completed_by) "+
          "VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
          [r.id,h,u,v,r.title,r.quantity,r.completed_at||null,r.completed_at?u:null]]
    case 'memories':
      if(!str(r.title,150)||str(r.story||'',8000)===null||!date(r.happened_on))return null
      return ["INSERT OR IGNORE INTO memories(id,household_id,created_by,visibility,title,story,happened_on,linked_type,linked_id) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
         [r.id,h,u,v,r.title,r.story||'',r.happened_on,
          ['trip','wish','profile','anniversary'].includes(r.linked_type)?r.linked_type:null,
          id(r.linked_id)?r.linked_id:null]]
    case 'petHealth':
      if(!id(r.profile_id)||!['weight','deworm','vaccination','vet','medication','grooming','other'].includes(r.record_type)||
         !date(r.event_on)||(r.next_due_on&&!date(r.next_due_on))||
         (r.weight_grams!=null&&(!Number.isInteger(r.weight_grams)||r.weight_grams<=0||r.weight_grams>=100000))||
         str(r.note||'',1000)===null)return null
      return ["INSERT OR IGNORE INTO pet_health_records(id,household_id,profile_id,created_by,visibility,record_type,event_on,weight_grams,note,next_due_on,source_routine_id,source_occurrence_on) "+
         "SELECT ?1,?2,p.id,?4,?5,?6,?7,?8,?9,?10,rt.id,CASE WHEN rt.id IS NOT NULL THEN ?12 ELSE NULL END "+
         "FROM family_profiles p LEFT JOIN routines rt ON rt.id=?11 AND rt.household_id=?2 AND rt.created_by=?4 "+
         "WHERE p.id=?3 AND p.household_id=?2 AND p.type='pet'",
         [r.id,h,r.profile_id,u,v,r.record_type,r.event_on,r.weight_grams??null,r.note||'',r.next_due_on||null,
          id(r.source_routine_id)&&date(r.source_occurrence_on)?r.source_routine_id:null,
          date(r.source_occurrence_on)?r.source_occurrence_on:null]]
    case 'routineMarks':
      if(!id(r.routine_id)||!date(r.occurrence_on))return null
      return ["INSERT OR IGNORE INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by,skipped_at) "+
         "SELECT r.id,?2,?3,?4,?5 FROM routines r WHERE r.id=?1 AND r.household_id=?6 AND r.created_by=?7",
         [r.routine_id,r.occurrence_on,r.completed_at||null,r.completed_at?u:null,r.skipped_at||null,h,u]]
    case 'tripProgress':
      if(!id(r.trip_id)||!str(r.item_id,100)||!r.item_id)return null
      return ["INSERT OR IGNORE INTO trip_progress(trip_id,item_id,completed_at,completed_by) "+
        "SELECT t.id,?2,?3,?4 FROM trips t WHERE t.id=?1 AND t.household_id=?5 AND t.created_by=?6",
        [r.trip_id,r.item_id,r.completed_at||null,r.completed_at?u:null,h,u]]
    case 'financeLinks':
      if(!['trip','goal'].includes(r.target_type)||!id(r.target_id)||!id(r.id)||
         !/^[1-9]\d{0,11}$/.test(String(r.external_entry_id)))return null
      const table=r.target_type==='trip'?'trips':'goals'
      return ["INSERT OR IGNORE INTO finance_links(id,household_id,created_by,target_type,target_id,external_entry_id) "+
        "SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM "+table+" WHERE id=?5 AND household_id=?2 AND created_by=?3)",
        [r.id,h,u,r.target_type,r.target_id,String(r.external_entry_id)]]
    default:return null
  }
}
export async function portableRoute(request,db,path,session){
  const household=session.household_id,user=session.user_id
  if(path==='/api/portable'&&request.method==='GET'){
    const statements=queries.map(([key,sql,tag])=>{
      const q=db.prepare(sql)
      return tag==='family'?q.bind(household):q.bind(household,user)
    })
    const out=await db.batch(statements)
    const records={}
    queries.forEach(([key],i)=>{records[key]=out[i]?.results||[]})
    if(Object.values(records).some(items=>items.length>exportMax))
      return json({error:'export_pagination_required',maxPerDataset:exportMax},413)
    return json({format:'homeflow.portable',schemaVersion:1,
      exportedAt:new Date().toISOString(),records,
      note:'每位登录用户分别备份本人创建的记录。已绑定账号的成员资料和私人照片不包含在此 JSON，需要使用设备上的照片 ZIP 备份。',
      restoration:'non_destructive_insert_only'})
  }
  if(path==='/api/portable/restore'&&request.method==='POST'){
    const bytes=Number(request.headers.get('content-length')||0)
    if(bytes>100000)return json({error:'restore_chunk_too_large'},413)
    const raw=await request.text()
    if(raw.length>100000)return json({error:'restore_chunk_too_large'},413)
    let body
    try{body=JSON.parse(raw)}catch{return json({error:'invalid_json'},400)}
    const kind=body?.dataset,items=body?.items
    if(!allowed.has(kind)||!Array.isArray(items)||!items.length||items.length>25)
      return json({error:'invalid_restore_batch'},400)
    const instructions=items.map(r=>normalized(kind,r,household,user))
    if(instructions.some(x=>!x))return json({error:'invalid_restore_record'},400)
    if(body.preview===true)return json({ok:true,dataset:kind,valid:items.length,readOnly:true})
    if(body.confirm!==true)return json({error:'confirmation_required'},409)
    try{
      const changes=await db.batch(instructions.map(([sql,args])=>db.prepare(sql).bind(...args)))
      return json({ok:true,dataset:kind,submitted:items.length,
        inserted:changes.reduce((n,x)=>n+Number(x.meta?.changes||0),0)})
    }catch{return json({error:'restore_batch_failed_no_changes_applied'},409)}
  }
  return json({error:'not_found'},404)
}
