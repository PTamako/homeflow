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
const signed=x=>Number.isSafeInteger(x)&&Math.abs(x)<=100000000000
const optionalDate=x=>x===undefined||x===null||x===''||date(x)
const optionalDeletion=x=>x==null||x===''||(typeof x==='string'&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x))
const profilesSQL="SELECT id,type,display_name,birthday,relation,adopted_on,weight_grams,notes FROM family_profiles "+
  "WHERE household_id=?1 AND member_user_id IS NULL AND archived_at IS NULL ORDER BY created_at LIMIT 501"
const queries=[
  ['familyProfiles',profilesSQL,'family'],
  ['wishes',"SELECT * FROM wishes WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['trips',"SELECT * FROM trips WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['goals',"SELECT * FROM goals WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['tasks',"SELECT * FROM tasks WHERE household_id=?1 AND creator_user_id=?2 ORDER BY created_at LIMIT 501"],
  ['anniversaries',"SELECT * FROM anniversaries WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['routines',"SELECT * FROM routines WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['shopping',"SELECT * FROM shopping_items WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['shoppingExpenseLinks',"SELECT l.shopping_id,l.external_entry_id,l.purchase_quantity FROM shopping_expense_links l "+
    "JOIN shopping_items s ON s.id=l.shopping_id AND s.household_id=l.household_id "+
    "WHERE l.household_id=?1 AND s.created_by=?2 ORDER BY l.shopping_id,l.external_entry_id LIMIT 501"],
  ['memories',"SELECT * FROM memories WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['petHealth',"SELECT * FROM pet_health_records WHERE household_id=?1 AND created_by=?2 AND deleted_at IS NULL ORDER BY created_at LIMIT 501"],
  // Preserve explicitly assigned individual occurrences (including dual participants).
  ['routineAssignments',"SELECT a.routine_id,a.occurrence_on,a.assignee_user_id,a.second_assignee_user_id,a.bonus_points,a.created_at "+
    "FROM routine_occurrence_assignments a JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id "+
    "WHERE a.household_id=?1 AND r.created_by=?2 ORDER BY a.occurrence_on,a.routine_id LIMIT 501"],
  ['routineMarks',"SELECT m.* FROM routine_marks m JOIN routines r ON r.id=m.routine_id "+
    "WHERE r.household_id=?1 AND r.created_by=?2 ORDER BY m.occurrence_on LIMIT 501"],
  ['tripProgress',"SELECT p.* FROM trip_progress p JOIN trips t ON t.id=p.trip_id "+
    "WHERE t.household_id=?1 AND t.created_by=?2 ORDER BY p.item_id LIMIT 501"],
  ['financeLinks',"SELECT id,target_type,target_id,external_entry_id FROM finance_links "+
    "WHERE household_id=?1 AND created_by=?2 ORDER BY created_at LIMIT 501"],
  ['financeTargetSettings',"SELECT s.* FROM finance_target_settings s WHERE s.household_id=?1 AND ("+
    "(s.target_type='goal' AND EXISTS(SELECT 1 FROM goals g WHERE g.id=s.target_id AND g.household_id=s.household_id AND g.created_by=?2)) OR "+
    "(s.target_type='trip' AND EXISTS(SELECT 1 FROM trips t WHERE t.id=s.target_id AND t.household_id=s.household_id AND t.created_by=?2)) OR "+
    "(s.target_type='shopping' AND EXISTS(SELECT 1 FROM shopping_items p WHERE p.id=s.target_id AND p.household_id=s.household_id AND p.created_by=?2))) LIMIT 501"],
  ['goalPeriodAdjustments',"SELECT a.* FROM goal_period_adjustments a JOIN goals g ON g.id=a.goal_id AND g.household_id=a.household_id "+
    "WHERE a.household_id=?1 AND g.created_by=?2 LIMIT 501"],
  ['goalPeriodSettlements',"SELECT s.goal_id,s.period_key,s.period_start,s.period_end,s.target_amount,s.actual_amount,s.difference_amount,s.status,s.settled_at "+
    "FROM goal_period_settlements s JOIN goals g ON g.id=s.goal_id AND g.household_id=s.household_id "+
    "WHERE s.household_id=?1 AND g.created_by=?2 ORDER BY s.period_key LIMIT 501"],
  // New completion records must be exported with their parent plan. The
  // household AND creator checks prevent other members' private marks leaking.
  ['planCompletionMarks',`SELECT m.plan_type,m.plan_id,m.period_key,m.completed_at,m.prior_status
    FROM plan_completion_marks m WHERE m.household_id=?1 AND
    ((m.plan_type='wish' AND EXISTS(SELECT 1 FROM wishes w WHERE w.id=m.plan_id
       AND w.household_id=m.household_id AND w.created_by=?2))
     OR (m.plan_type='goal' AND EXISTS(SELECT 1 FROM goals g WHERE g.id=m.plan_id
       AND g.household_id=m.household_id AND g.created_by=?2)))
    ORDER BY m.completed_at,m.plan_type,m.plan_id,m.period_key LIMIT 501`],
  ['todayPlanActions',`SELECT a.kind,a.source_id,a.original_on,a.title,a.action,a.postponed_to,a.acted_at
    FROM today_plan_actions a WHERE a.household_id=?1 AND (
    (a.kind='task' AND EXISTS(SELECT 1 FROM tasks s WHERE s.id=a.source_id AND s.household_id=a.household_id AND s.creator_user_id=?2)) OR
    (a.kind='shopping' AND EXISTS(SELECT 1 FROM shopping_items s WHERE s.id=a.source_id AND s.household_id=a.household_id AND s.created_by=?2)) OR
    (a.kind='wish' AND EXISTS(SELECT 1 FROM wishes s WHERE s.id=a.source_id AND s.household_id=a.household_id AND s.created_by=?2)) OR
    (a.kind='goal' AND EXISTS(SELECT 1 FROM goals s WHERE s.id=a.source_id AND s.household_id=a.household_id AND s.created_by=?2)) OR
    (a.kind='trip' AND EXISTS(SELECT 1 FROM trips s WHERE s.id=a.source_id AND s.household_id=a.household_id AND s.created_by=?2)))
    ORDER BY a.acted_at,a.kind,a.source_id LIMIT 501`],
  ['reminderSnoozes',"SELECT kind,item_id,until_on FROM reminder_snoozes "+
    "WHERE household_id=?1 AND user_id=?2 ORDER BY updated_at LIMIT 501"],
  ['reminderPreferences',"SELECT advance_days,quiet_start_hour,quiet_end_hour FROM reminder_preferences "+
    "WHERE household_id=?1 AND user_id=?2 LIMIT 501"],
  ['reminderItemPreferences',"SELECT kind,item_id,advance_days,priority FROM reminder_item_preferences "+
    "WHERE household_id=?1 AND user_id=?2 ORDER BY updated_at LIMIT 501"]
]
export const RESTORE_ORDER=queries.map(([key])=>key)
const exportMax=500
const allowed=new Set(RESTORE_ORDER)
 // Audit-only records are exported as a *separate* ZIP member, never replayed
 // through portable restore: re-inserting point events would mint duplicate credit.
 // All sources are static whitelisted tables/views and household-scoped; another
 // member's private events are excluded from the requesting user's archive.
export const POINTS_AUDIT_SOURCES=[
 ['rewardItems','reward_items',"household_id=?1",'created_at,id'],
 ['rewardRedemptions','reward_redemptions',"household_id=?1",'created_at,id'],
 ['rewardGroupOrders','reward_group_orders',"household_id=?1",'created_at,id'],
 ['rewardGroupContributions','reward_group_contributions',"household_id=?1",'created_at,id'],
 ['lotteryDraws','household_lottery_draws',"household_id=?1",'created_at,id'],
 // Only the signed-in holder can export voucher use and wish-target records.
 // This is an audit-only archive, never part of the restore replay.
 ['lotteryCoupons','lottery_coupons',"household_id=?1 AND user_id=?2",'created_at,id'],
 ['rewardCouponDiscounts','reward_coupon_discounts',"household_id=?1 AND user_id=?2",'created_at,coupon_id'],
 ['completionPoints','completion_points',"household_id=?1 AND (visibility='household' OR earner_user_id=?2)",'earned_at,kind,source_id,occurrence_on'],
 ['completionAdjustments','completion_point_adjustments',"household_id=?1 AND (visibility='household' OR earner_user_id=?2)",'earned_at,kind,source_id,occurrence_on'],
 ['dualSplits','dual_completion_splits',"household_id=?1 AND (visibility='household' OR user_id=?2)",'earned_at,kind,source_id,occurrence_on,user_id'],
 ['shoppingPoints','shopping_completion_points',"household_id=?1 AND (visibility='household' OR earner_user_id=?2)",'earned_at,shopping_id'],
 ['shoppingJoint','shopping_joint_credits',"household_id=?1 AND (visibility='household' OR user_id=?2)",'earned_at,shopping_id,user_id'],
 ['weeklyChallenges','weekly_challenge_awards',"household_id=?1",'awarded_at,week_on,user_id'],
 ['goalRewards','goal_completion_rewards',"household_id=?1",'awarded_at,user_id'],
 ['tripRewards','trip_reward_events',"household_id=?1 AND (visibility='household' OR user_id=?2)",'awarded_at,id'],
 ['monthlyAchievements','monthly_achievement_credits',"household_id=?1",'month_on,user_id,badge_id']
]

function normalized(key,r,h,u) {
  if(!r||typeof r!=='object'||Array.isArray(r))return null
  const common=['routineMarks','tripProgress','financeTargetSettings','goalPeriodAdjustments','goalPeriodSettlements','planCompletionMarks','shoppingExpenseLinks','todayPlanActions','routineAssignments','reminderSnoozes','reminderPreferences','reminderItemPreferences'].includes(key)?null:id(r.id)
  if(common===false)return null
  const v=vis(r.visibility)
  if(!optionalDeletion(r.deleted_at))return null
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
         !amount(r.estimated_amount)||str(r.note||'',2000)===null||!optionalDate(r.target_on))return null
      const wishLead=[0,1,3,7].includes(r.remind_advance_days)?r.remind_advance_days:0
      const wishEnabled=r.remind_enabled===1&&!!r.target_on?1:0
      return ["INSERT OR IGNORE INTO wishes(id,household_id,created_by,visibility,title,wish_type,status,estimated_amount,currency,note,target_on,deleted_at,remind_enabled,remind_advance_days) "+
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'JPY',?9,?10,?11,?12,?13)",
        [r.id,h,u,v,r.title,r.wish_type,r.status,r.estimated_amount,r.note||'',r.target_on||null,r.deleted_at||null,wishEnabled,wishLead]]
    case 'trips':
      if(!str(r.title,150)||str(r.destination||'',300)===null||(r.start_on&&!date(r.start_on))||
         (r.end_on&&!date(r.end_on))||!amount(r.budget_amount)||
         !['planning','active','completed','cancelled'].includes(r.status)||
         (r.plan_json!=null&&str(r.plan_json,160000)===null))return null
      let participants
      try{participants=JSON.parse(r.participant_user_ids||'[]')}catch{return null}
      if(!Array.isArray(participants)||participants.length>10||!participants.every(x=>typeof x==='string'&&x.length>0&&x.length<=100))return null
      if(v==='private')participants=[u]
      else participants=[...new Set([u,...participants])]
      return ["INSERT OR IGNORE INTO trips(id,household_id,created_by,visibility,wish_id,title,destination,start_on,end_on,"+
        "timezone,budget_amount,currency,status,import_source_key,import_hash,plan_json,deleted_at,participant_user_ids) "+
        "VALUES(?1,?2,?3,?4,(SELECT id FROM wishes WHERE id=?5 AND household_id=?2 AND created_by=?3),"+
        "?6,?7,?8,?9,?10,?11,'JPY',?12,?13,?14,?15,?16,"+
        "(SELECT json_group_array(m.user_id) FROM household_members m WHERE m.household_id=?2 "+
        "AND (m.user_id=?3 OR m.user_id IN (SELECT value FROM json_each(?17)))))",
        [r.id,h,u,v,id(r.wish_id)?r.wish_id:null,r.title,r.destination||'',r.start_on||null,r.end_on||null,
         str(r.timezone,70)||'Asia/Tokyo',r.budget_amount,r.status||'planning',r.import_source_key||null,
         r.import_hash||null,r.plan_json||null,r.deleted_at||null,JSON.stringify(participants)]]
    case 'goals':
      if(!str(r.title,150)||!Number.isSafeInteger(r.target_amount)||r.target_amount<1||
         !amount(r.reserved_amount)||!optionalDate(r.target_on)||!optionalDate(r.start_on)||
         !['once','monthly','yearly'].includes(r.goal_mode||'once')||
         ((r.goal_mode==='monthly'||r.goal_mode==='yearly')&&!date(r.start_on))||
         (r.start_on&&r.target_on&&r.start_on>r.target_on))return null
      return ["INSERT OR IGNORE INTO goals(id,household_id,created_by,visibility,wish_id,title,target_amount,reserved_amount,currency,target_on,goal_mode,start_on,deleted_at) "+
        "VALUES(?1,?2,?3,?4,(SELECT id FROM wishes WHERE id=?5 AND household_id=?2 AND created_by=?3),?6,?7,?8,'JPY',?9,?10,?11,?12)",
        [r.id,h,u,v,id(r.wish_id)?r.wish_id:null,r.title,r.target_amount,r.reserved_amount,r.target_on||null,
         r.goal_mode||'once',r.start_on||null,r.deleted_at||null]]
    case 'tasks': {
      if(!str(r.title,150)||str(r.notes||'',1000)===null||!optionalDate(r.due_on))return null
      const bonus=r.bonus_points??0,first=id(r.assignee_user_id)?r.assignee_user_id:null
      const second=id(r.second_assignee_user_id)?r.second_assignee_user_id:null
      if(!Number.isSafeInteger(bonus)||bonus<0||bonus>10000||
         (second&&(!first||second===first||v!=='household'||bonus!==0))||
         (bonus>0&&(!first||first===u||v!=='household')))return null
      return ["INSERT OR IGNORE INTO tasks(id,household_id,creator_user_id,visibility,title,notes,due_on,completed_at,"+
         "completed_by,subject_profile_id,client_request_id,health_record_type,remind_enabled,assignee_user_id,deleted_at,bonus_points,second_assignee_user_id) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,"+
         "(SELECT id FROM family_profiles WHERE id=?10 AND household_id=?2),?11,?12,?13,"+
         "(SELECT user_id FROM household_members WHERE user_id=?14 AND household_id=?2),?15,?16,"+
         "(SELECT user_id FROM household_members WHERE user_id=?17 AND household_id=?2))",
        [r.id,h,u,v,r.title,r.notes||'',r.due_on||null,r.completed_at||null,r.completed_at?u:null,
         id(r.subject_profile_id)?r.subject_profile_id:null,id(r.client_request_id)?r.client_request_id:null,
         ['deworm','vaccination','vet','medication','grooming','other'].includes(r.health_record_type)?r.health_record_type:null,
         r.remind_enabled===0?0:1,first,r.deleted_at||null,bonus,second]]
    }
    case 'anniversaries':
      if(!str(r.title,150)||!date(r.event_date)||!['once','yearly','monthly'].includes(r.repeat_mode))return null
      return ["INSERT OR IGNORE INTO anniversaries(id,household_id,created_by,visibility,title,event_date,repeat_mode,advance_days_json,note,subject_profile_id,deleted_at,archived_at) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,(SELECT id FROM family_profiles WHERE id=?10 AND household_id=?2),?11,?12)",
         [r.id,h,u,v,r.title,r.event_date,r.repeat_mode,str(r.advance_days_json,100)||'[7,1,0]',
          str(r.note,1000)||'',id(r.subject_profile_id)?r.subject_profile_id:null,r.deleted_at||null,
          typeof r.archived_at==='string'&&/^\d{4}-\d\d-\d\dT/.test(r.archived_at)?r.archived_at:null]]
    case 'routines':
      if(!str(r.title,150)||!date(r.anchor_date)||
         !['daily','weekly','monthly','interval'].includes(r.repeat_type)||
         str(r.repeat_config,1200)===null||(r.next_due_on&&!date(r.next_due_on)))return null
      return ["INSERT OR IGNORE INTO routines(id,household_id,created_by,visibility,title,repeat_type,repeat_config,anchor_date,enabled,next_due_on,subject_profile_id,health_record_type,remind_enabled,assigned_to,deleted_at) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,(SELECT id FROM family_profiles WHERE id=?11 AND household_id=?2),?12,?13,"+
         "(SELECT user_id FROM household_members WHERE user_id=?14 AND household_id=?2),?15)",
         [r.id,h,u,v,r.title,r.repeat_type,r.repeat_config,r.anchor_date,r.enabled===0?0:1,
          r.next_due_on||null,id(r.subject_profile_id)?r.subject_profile_id:null,
          ['deworm','vaccination','vet','medication','grooming','other'].includes(r.health_record_type)?r.health_record_type:null,
          r.remind_enabled===0?0:1,id(r.assigned_to)?r.assigned_to:null,r.deleted_at||null]]
    case 'shopping':
      if(!str(r.title,150)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>9999||!optionalDate(r.due_on)||
         (r.ledger_entry_id!=null&&!/^[1-9]\d{0,11}$/.test(String(r.ledger_entry_id))))return null
      const first=id(r.assigned_to)?r.assigned_to:null
      const second=id(r.second_assignee_user_id)?r.second_assignee_user_id:null
      if(second&&(!first||second===first||v!=='household'))return null
      return ["INSERT OR IGNORE INTO shopping_items(id,household_id,created_by,visibility,title,quantity,completed_at,completed_by,due_on,ledger_entry_id,deleted_at,assigned_to,second_assignee_user_id) "+
          "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,"+
          "(SELECT user_id FROM household_members WHERE user_id=?12 AND household_id=?2),"+
          "(SELECT user_id FROM household_members WHERE user_id=?13 AND household_id=?2))",
          [r.id,h,u,v,r.title,r.quantity,r.completed_at||null,r.completed_at?u:null,
           r.due_on||null,r.ledger_entry_id||null,r.deleted_at||null,
           first&&(v==='household'||first===u)?first:null,second]]
    case 'memories':
      if(!str(r.title,150)||str(r.story||'',8000)===null||!date(r.happened_on))return null
      return ["INSERT OR IGNORE INTO memories(id,household_id,created_by,visibility,title,story,happened_on,linked_type,linked_id,deleted_at) "+
         "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
         [r.id,h,u,v,r.title,r.story||'',r.happened_on,
          ['trip','wish','profile','anniversary'].includes(r.linked_type)?r.linked_type:null,
          id(r.linked_id)?r.linked_id:null,r.deleted_at||null]]
    case 'petHealth':
      if(!id(r.profile_id)||!['weight','deworm','vaccination','vet','medication','grooming','other'].includes(r.record_type)||
         !date(r.event_on)||(r.next_due_on&&!date(r.next_due_on))||
         (r.weight_grams!=null&&(!Number.isInteger(r.weight_grams)||r.weight_grams<=0||r.weight_grams>=100000))||
         str(r.note||'',1000)===null)return null
      return ["INSERT OR IGNORE INTO pet_health_records(id,household_id,profile_id,created_by,visibility,record_type,event_on,weight_grams,note,next_due_on,source_routine_id,source_occurrence_on,source_task_id) "+
         "SELECT ?1,?2,p.id,?4,?5,?6,?7,?8,?9,?10,rt.id,CASE WHEN rt.id IS NOT NULL THEN ?12 ELSE NULL END,t.id "+
         "FROM family_profiles p LEFT JOIN routines rt ON rt.id=?11 AND rt.household_id=?2 AND rt.created_by=?4 "+
         "LEFT JOIN tasks t ON t.id=?13 AND t.household_id=?2 AND t.creator_user_id=?4 "+
         "WHERE p.id=?3 AND p.household_id=?2 AND p.type='pet'",
         [r.id,h,r.profile_id,u,v,r.record_type,r.event_on,r.weight_grams??null,r.note||'',r.next_due_on||null,
          id(r.source_routine_id)&&date(r.source_occurrence_on)?r.source_routine_id:null,
          date(r.source_occurrence_on)?r.source_occurrence_on:null,
          id(r.source_task_id)?r.source_task_id:null]]
    case 'routineAssignments': {
      if(!id(r.routine_id)||!date(r.occurrence_on)||!id(r.assignee_user_id)||
         !Number.isSafeInteger(r.bonus_points)||r.bonus_points<0||r.bonus_points>10000||
         (r.second_assignee_user_id!=null&&(!id(r.second_assignee_user_id)||
           r.second_assignee_user_id===r.assignee_user_id||r.bonus_points!==0)))return null
      const created=typeof r.created_at==='string'&&Number.isFinite(Date.parse(r.created_at))?
        r.created_at:new Date().toISOString()
      return ["INSERT OR IGNORE INTO routine_occurrence_assignments "+
        "(household_id,routine_id,occurrence_on,assignee_user_id,second_assignee_user_id,bonus_points,created_at) "+
        "SELECT ?1,r.id,?3,a.user_id,b.user_id,?6,?7 FROM routines r "+
        "JOIN household_members a ON a.household_id=?1 AND a.user_id=?4 "+
        "LEFT JOIN household_members b ON b.household_id=?1 AND b.user_id=?5 "+
        "WHERE r.id=?2 AND r.household_id=?1 AND r.created_by=?8 "+
        "AND (?5 IS NULL OR b.user_id IS NOT NULL)",
        [h,r.routine_id,r.occurrence_on,r.assignee_user_id,r.second_assignee_user_id||null,
          r.bonus_points,created,u]]
    }
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
    case 'financeTargetSettings': {
      if(!['trip','goal','shopping'].includes(r.target_type)||!id(r.target_id)||
         !signed(r.adjustment_amount)||!optionalDate(r.period_start)||!optionalDate(r.period_end)||
         Boolean(r.period_start)!==Boolean(r.period_end)||
         (r.period_start&&r.period_end<r.period_start))return null
      const table={trip:'trips',goal:'goals',shopping:'shopping_items'}[r.target_type]
      return ["INSERT OR IGNORE INTO finance_target_settings(household_id,target_type,target_id,adjustment_amount,period_start,period_end,updated_by) "+
        "SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(SELECT 1 FROM "+table+" WHERE id=?3 AND household_id=?1 AND created_by=?7)",
        [h,r.target_type,r.target_id,r.adjustment_amount,r.period_start||null,r.period_end||null,u]]
    }
    case 'goalPeriodAdjustments': {
      if(!id(r.goal_id)||!/^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(r.period_key||'')||
         !signed(r.adjustment_amount))return null
      return ["INSERT OR IGNORE INTO goal_period_adjustments(household_id,goal_id,period_key,adjustment_amount,updated_by) "+
        "SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM goals WHERE id=?2 AND household_id=?1 AND created_by=?5 "+
        "AND ((goal_mode='monthly' AND length(?3)=7) OR (goal_mode='yearly' AND length(?3)=4)))",
        [h,r.goal_id,r.period_key,r.adjustment_amount,u]]
    }
    case 'goalPeriodSettlements': {
      if(!id(r.goal_id)||!/^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/.test(r.period_key||'')||
        !date(r.period_start)||!date(r.period_end)||r.period_start>r.period_end||
        !amount(r.target_amount)||r.target_amount===0||
        !['pending','met','shortfall'].includes(r.status))return null
      const pending=r.status==='pending'
      if(pending&&(r.actual_amount!=null||r.difference_amount!=null||r.settled_at!=null))return null
      if(!pending&&(!signed(r.actual_amount)||!signed(r.difference_amount)||
        r.target_amount-r.actual_amount!==r.difference_amount||
        (r.status==='met')!==(r.difference_amount<=0)||
        typeof r.settled_at!=='string'||!Number.isFinite(Date.parse(r.settled_at))))return null
      return [`INSERT OR IGNORE INTO goal_period_settlements
        (household_id,goal_id,period_key,period_start,period_end,target_amount,
         actual_amount,difference_amount,status,settled_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS(
          SELECT 1 FROM goals WHERE id=?2 AND household_id=?1 AND created_by=?11
          AND ((goal_mode='monthly' AND length(?3)=7) OR
               (goal_mode='yearly' AND length(?3)=4)))`,
        [h,r.goal_id,r.period_key,r.period_start,r.period_end,r.target_amount,
          pending?null:r.actual_amount,pending?null:r.difference_amount,r.status,
          pending?null:r.settled_at,u]]
    }
    case 'shoppingExpenseLinks': {
      if(!id(r.shopping_id)||!/^[1-9]\d{0,11}$/.test(String(r.external_entry_id))||
        (r.purchase_quantity!=null&&(!Number.isInteger(r.purchase_quantity)||
          r.purchase_quantity<1||r.purchase_quantity>9999)))return null
      return ["INSERT OR IGNORE INTO shopping_expense_links "+
        "(household_id,shopping_id,external_entry_id,linked_by,purchase_quantity) "+
        "SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM shopping_items "+
        "WHERE household_id=?1 AND id=?2 AND created_by=?4)",
        [h,r.shopping_id,String(r.external_entry_id),u,r.purchase_quantity??null]]
    }
    case 'todayPlanActions': {
      if(!['task','shopping','wish','goal','trip'].includes(r.kind)||!id(r.source_id)||
         !date(r.original_on)||str(r.title,150)===null||!r.title||
         !['postponed','skipped'].includes(r.action)||
         (r.action==='postponed'&&(!date(r.postponed_to)||r.postponed_to<=r.original_on))||
         (r.action==='skipped'&&r.postponed_to!=null))return null
      const stamp=typeof r.acted_at==='string'&&
        /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(r.acted_at)
        ?r.acted_at:null
      const table={task:'tasks',shopping:'shopping_items',wish:'wishes',
        goal:'goals',trip:'trips'}[r.kind]
      const creator=r.kind==='task'?'creator_user_id':'created_by'
      // Restore only source plans owned by this account; imported actions
      // never mark a plan done or alter financial targets.
      return [`INSERT OR IGNORE INTO today_plan_actions
        (household_id,kind,source_id,original_on,title,action,postponed_to,acted_by,acted_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,COALESCE(?9,CURRENT_TIMESTAMP)
        WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=?3 AND household_id=?1 AND ${creator}=?8)`,
        [h,r.kind,r.source_id,r.original_on,r.title,r.action,r.postponed_to||null,u,stamp]]
    }
    case 'reminderPreferences': {
      if(![0,1,3,7].includes(r.advance_days))return null
      const start=r.quiet_start_hour??null,end=r.quiet_end_hour??null
      if(!((start===null&&end===null)||
        (Number.isInteger(start)&&start>=0&&start<=23&&
         Number.isInteger(end)&&end>=0&&end<=23&&start!==end)))return null
      return ["INSERT OR IGNORE INTO reminder_preferences "+
        "(household_id,user_id,advance_days,quiet_start_hour,quiet_end_hour) VALUES(?1,?2,?3,?4,?5)",
        [h,u,r.advance_days,start,end]]
    }
    case 'reminderItemPreferences': {
      if(!['task','routine','trip'].includes(r.kind)||typeof r.item_id!=='string'||
         r.item_id.length<1||r.item_id.length>200||!/[0-9]/.test(r.item_id)||
         ![0,1,3,7].includes(r.advance_days)||!['normal','important'].includes(r.priority))
        return null
      const table=r.kind==='task'?'tasks':r.kind==='routine'?'routines':'trips'
      const planId=r.kind==='trip'?r.item_id.split(':')[0]:r.item_id
      if(!id(planId))return null
      const visibility=r.kind==='task'?'creator_user_id':'created_by'
      // Private data is never imported into another account. Trip sub-items
      // require the trip to be owned by the restoring user.
      return ["INSERT OR IGNORE INTO reminder_item_preferences "+
        "(household_id,user_id,kind,item_id,advance_days,priority) "+
        "SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM "+table+
        " WHERE household_id=?1 AND id=?7 AND "+visibility+"=?2)",
        [h,u,r.kind,r.item_id,r.advance_days,r.priority,planId]]
    }
    case 'reminderSnoozes': {
      if(!['task','routine','anniversary','trip'].includes(r.kind)||
         typeof r.item_id!=='string'||r.item_id.length<1||r.item_id.length>200||
         !date(r.until_on))return null
      return ["INSERT OR IGNORE INTO reminder_snoozes "+
        "(household_id,user_id,kind,item_id,until_on) VALUES(?1,?2,?3,?4,?5)",
        [h,u,r.kind,r.item_id,r.until_on]]
    }
    case 'planCompletionMarks': {
      if(!['wish','goal'].includes(r.plan_type)||!id(r.plan_id)||
         typeof r.completed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(r.completed_at)||
         !Number.isFinite(Date.parse(r.completed_at))||
         (r.plan_type==='wish'&&
           (r.period_key!=='once'||!['wished','planning','active'].includes(r.prior_status)))||
         (r.plan_type==='goal'&&r.prior_status!=null))return null
      const table=r.plan_type==='wish'?'wishes':'goals'
      // Do not trust a backup's original completed_by identity. Only recreate
      // a mark for a plan actually owned by the importing user.
      const key=r.period_key
      if(r.plan_type==='goal'&&key!=='once'&&
         !/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(key))return null
      const modeCheck=r.plan_type==='goal'
        ? "AND ((goal_mode='once' AND ?4='once') OR "+
          "(goal_mode='monthly' AND length(?4)=7) OR "+
          "(goal_mode='yearly' AND length(?4)=4))"
        : ''
      return [`INSERT OR IGNORE INTO plan_completion_marks
        (household_id,plan_type,plan_id,period_key,completed_at,completed_by,prior_status)
        SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS(
          SELECT 1 FROM ${table} WHERE id=?3 AND household_id=?1 AND created_by=?6
          ${modeCheck})`,
        [h,r.plan_type,r.plan_id,key,r.completed_at,u,r.prior_status??null]]
    }
    default:return null
  }
}
export async function portableRoute(request,db,path,session){
  const household=session.household_id,user=session.user_id
  if(path==='/api/portable/shared-memories'&&request.method==='GET'){
    // Include family memories authored by someone else in a READ-ONLY archive.
    // Other people's ownership is never rewritten by the portable importer.
    const raw=new URL(request.url).searchParams.get('cursor')||'0'
    if(!/^(0|[1-9][0-9]{0,5})$/.test(raw)||
      Number(raw)>50000||Number(raw)%100!==0)return json({error:'invalid_export_cursor'},400)
    const offset=Number(raw)
    const {results=[]}=await db.prepare(`SELECT id,created_by,visibility,title,story,
      happened_on,linked_type,linked_id,created_at
      FROM memories WHERE household_id=?1 AND visibility='household'
        AND created_by<>?2 AND deleted_at IS NULL
      ORDER BY created_at,id LIMIT 101 OFFSET ?3`).bind(household,user,offset).all()
    return json({dataset:'sharedMemories',items:results.slice(0,100),
      nextCursor:results.length>100?String(offset+100):null,restorePolicy:'read-only'})
  }
  if(path==='/api/portable/audit'&&request.method==='GET'){
    const params=new URL(request.url).searchParams
    const key=params.get('dataset'),raw=params.get('cursor')||'0'
    const source=POINTS_AUDIT_SOURCES.find(item=>item[0]===key)
    if(!source||!/^(0|[1-9][0-9]{0,5})$/.test(raw)||
      Number(raw)>50000||Number(raw)%100!==0)return json({error:'invalid_export_cursor'},400)
    const [,table,where,order]=source
    const offset=Number(raw)
    // Page-size+1 sentinel ensures an archive never silently truncates history.
    const sql=`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT 101 OFFSET ?3`
    const args=where.includes('?2')?[household,user,offset]:[household,offset]
    const statement=db.prepare(sql)
    // When ?2 is not a user parameter, OFFSET uses ?2 rather than ?3.
    const bound=where.includes('?2')?statement.bind(...args):
      db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT 101 OFFSET ?2`)
        .bind(...args)
    const {results=[]}=await bound.all()
    const items=results.slice(0,100).map(row=>{
      // Shared redemption amounts are auditable, but another member's
      // personal linked wish title/goal ID must never escape their account.
      const otherRedemption=key==='rewardRedemptions'&&row.redeemed_by!==user
      const otherPool=key==='rewardGroupOrders'&&row.created_by!==user
      if(!otherRedemption&&!otherPool)return row
      return {...row,credited_wish_id:null,credited_goal_id:null,
        wish_title_snapshot:null}
    })
    return json({dataset:key,items,
      nextCursor:results.length>100?String(offset+100):null})
  }

  if(path==='/api/portable'&&request.method==='GET'){
    const params=new URL(request.url).searchParams
    if(params.has('dataset')){
      const key=params.get('dataset')
      const raw=params.get('cursor')||'0'
      if(!allowed.has(key)||!/^(0|[1-9][0-9]{0,5})$/.test(raw)||
         Number(raw)>50000||Number(raw)%100!==0)return json({error:'invalid_export_cursor'},400)
      const [,source,tag]=queries.find(([name])=>name===key)
      const sql=source.replace(/LIMIT 501\s*$/,'LIMIT 101 OFFSET '+Number(raw))
      const query=db.prepare(sql)
      const {results}=await (tag==='family'?query.bind(household):query.bind(household,user)).all()
      const rows=results||[]
      return json({dataset:key,items:rows.slice(0,100),
        nextCursor:rows.length>100?String(Number(raw)+100):null})
    }
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
