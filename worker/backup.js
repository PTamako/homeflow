import {json} from './security.js'
const definitions=[
  ['familyProfiles', "SELECT id,type,display_name,birthday,relation,adopted_on,weight_grams,notes FROM family_profiles WHERE household_id=?1 AND archived_at IS NULL LIMIT 250"],
  ['tasks',"SELECT id,title,notes,visibility,due_on,completed_at,created_at FROM tasks WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR creator_user_id=?2) LIMIT 1000"],
  ['anniversaries',"SELECT * FROM anniversaries WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 500"],
  ['routines',"SELECT * FROM routines WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 500"],
  ['wishes',"SELECT * FROM wishes WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 500"],
  ['trips',"SELECT * FROM trips WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 100"],
  ['goals',"SELECT * FROM goals WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 250"],
  ['shopping',"SELECT * FROM shopping_items WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 500"],
  ['todayPlanActions',"SELECT kind,source_id,original_on,title,action,postponed_to,acted_at "+
    "FROM today_plan_actions WHERE household_id=?1 AND acted_by=?2 ORDER BY acted_at DESC LIMIT 500"],
  ['memories',"SELECT * FROM memories WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 500"],
  ['petHealth',"SELECT * FROM pet_health_records WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2) LIMIT 1000"]
]
export async function backupRoute(request,db,session){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const args=definitions.map(([key,sql])=>{
    // A sentinel row detects truncation. Never call an incomplete file a backup.
    const p=db.prepare(sql.replace(/LIMIT (\d+)$/,(_,cap)=>'LIMIT '+(Number(cap)+1)))
    return key==='familyProfiles'?p.bind(session.household_id):p.bind(session.household_id,session.user_id)
  })
  const result=await db.batch(args)
  const truncated=definitions.flatMap(([key,sql],i)=>{
    const cap=Number(sql.match(/LIMIT (\d+)$/)?.[1]||0)
    return (result[i]?.results||[]).length>cap?[key]:[]
  })
  if(truncated.length)return json({error:'export_pagination_required',datasets:truncated,
    message:'简易 JSON 导出记录已超过数量上限，请使用管理页的完整分页 ZIP 备份'},413)
  const records={}
  definitions.forEach(([key],i)=>{records[key]=result[i]?.results||[]})
  return json({format:'homeflow.export',schemaVersion:1,exportedAt:new Date().toISOString(),
    note:'数据按当前用户权限导出。照片文件、登录密码、会话和财务明细不包含；目前不提供自动恢复。',
    records},200,{'content-disposition':'attachment; filename="homeflow-backup.json"'})
}
