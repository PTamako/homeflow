// The recurring rule is untouched. Each dated occurrence can be assigned once
// and its optional bounty is reserved atomically from the creator's household wallet.
import {json,readBody,iso,validDate} from './security.js'
import {currentRoutinePeriod,nextRoutineDue,jstToday,routineConfig} from './routine-periods.js'
import {isJapaneseWorkday} from './jp-holidays.js'
import {householdWalletSql} from './points-wallet.js'

const dated=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&validDate(x)
function scheduled(rule,day){
 if(day<rule.anchor_date)return false
 if(routineConfig(rule).excludeJapaneseHolidays&&!isJapaneseWorkday(day))return false
 return currentRoutinePeriod(rule,day)===day || nextRoutineDue(rule,day)===day
}
export async function routineAssignmentRoute(request,db,session,id,options={}){
 if(!id||!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405)
 const rule=await db.prepare(`SELECT * FROM routines WHERE household_id=?1 AND id=?2
     AND deleted_at IS NULL AND enabled=1 AND (visibility='household' OR created_by=?3)`)
   .bind(session.household_id,id,session.user_id).first()
 if(!rule)return json({error:'not_found'},404)
 const body=request.method==='POST'?await readBody(request):null
 const date=request.method==='GET'?new URL(request.url).searchParams.get('on'):body?.periodOn
 if(!dated(date)||!scheduled(rule,date))return json({error:'invalid_period'},400)
 const existing=await db.prepare(`SELECT assignee_user_id AS assigneeUserId,
   second_assignee_user_id AS secondAssigneeUserId,bonus_points AS bonusPoints
   FROM routine_occurrence_assignments WHERE household_id=?1 AND routine_id=?2 AND occurrence_on=?3`)
   .bind(session.household_id,id,date).first()
 if(request.method==='GET')return json({periodOn:date,assignment:existing||null})
 if(rule.created_by!==session.user_id||rule.visibility!=='household')
   return json({error:'forbidden'},403)
 if(date<jstToday())return json({error:'period_expired'},409)
 const mark=await db.prepare(`SELECT completed_at,skipped_at FROM routine_marks
   WHERE routine_id=?1 AND occurrence_on=?2`).bind(id,date).first()
 if(mark?.completed_at||mark?.skipped_at)return json({error:'period_already_resolved'},409)
 const assignee=body?.assigneeUserId||null,second=body?.secondAssigneeUserId||null,
   bonus=body?.bonusPoints??0
 if(!assignee){
   if(second||bonus!==0)return json({error:'invalid_bonus'},400)
   if(!existing)return json({ok:true,unchanged:true,periodOn:date,assignment:null})
   const cleared=await db.prepare(`DELETE FROM routine_occurrence_assignments
     WHERE household_id=?1 AND routine_id=?2 AND occurrence_on=?3
     AND NOT EXISTS(SELECT 1 FROM routine_marks WHERE routine_id=?2 AND occurrence_on=?3
      AND (completed_at IS NOT NULL OR skipped_at IS NOT NULL))`)
     .bind(session.household_id,id,date).run()
   if(!Number(cleared.meta?.changes))return json({error:'period_already_resolved'},409)
   return json({ok:true,periodOn:date,assignment:null})
 }
 if(typeof assignee!=='string'||assignee.length>60||
     second&&(typeof second!=='string'||second.length>60||second===assignee))
     return json({error:'invalid_assignee'},400)
 const other=assignee!==session.user_id||!!second&&second!==session.user_id
 if((other&&(!Number.isSafeInteger(bonus)||bonus<1||bonus>10000))||
    (!other&&bonus!==0))
   return json({error:'positive_integer_bonus_required'},400)
 if(second){
   const secondary=await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2')
     .bind(session.household_id,second).first()
   if(!secondary)return json({error:'recipient_not_in_household'},404)
 }
 const member=await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2')
   .bind(session.household_id,assignee).first()
 if(!member)return json({error:'recipient_not_in_household'},404)
 if(existing?.assigneeUserId===assignee&&existing?.secondAssigneeUserId===second&&
   Number(existing.bonusPoints)===bonus)
   return json({ok:true,unchanged:true,periodOn:date,assignment:existing})
 const stamp=iso()
 // D1 evaluates the wallet balance and old reservation in the very same SQL write;
 // two concurrent requests cannot both spend the same unreserved credits.
 const result=await db.prepare(`INSERT INTO routine_occurrence_assignments
   (household_id,routine_id,occurrence_on,assignee_user_id,bonus_points,created_at,updated_at,second_assignee_user_id)
   SELECT ?1,?3,?4,?5,?6,?7,?7,?8
   WHERE ?6<=${householdWalletSql('?1','?2')}
     +COALESCE((SELECT a.bonus_points FROM routine_occurrence_assignments a
       WHERE a.household_id=?1 AND a.routine_id=?3 AND a.occurrence_on=?4
         AND (a.assignee_user_id<>?2 OR a.second_assignee_user_id IS NOT NULL)),0)
     AND EXISTS(SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?5)
     AND (?8 IS NULL OR EXISTS(SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?8))
     AND NOT EXISTS(SELECT 1 FROM routine_marks WHERE routine_id=?3 AND occurrence_on=?4
        AND (completed_at IS NOT NULL OR skipped_at IS NOT NULL))
   ON CONFLICT(routine_id,occurrence_on) DO UPDATE SET
     assignee_user_id=excluded.assignee_user_id,
     second_assignee_user_id=excluded.second_assignee_user_id,
     bonus_points=excluded.bonus_points,updated_at=excluded.updated_at`)
   .bind(session.household_id,session.user_id,id,date,assignee,bonus,stamp,second).run()
 if(!Number(result.meta?.changes))return json({error:'insufficient_points_or_period_resolved'},409)
 if(other)options.onAssigned?.({kind:'routine',id,periodOn:date})
 return json({ok:true,periodOn:date,assignment:{assigneeUserId:assignee,secondAssigneeUserId:second,bonusPoints:bonus}})
}
