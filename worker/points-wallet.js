// Annual wallets reset at midnight January 1, Asia/Tokyo, without deleting history.
export const pointYearStartSql="datetime('now','+9 hours','start of year','-9 hours')"
export const pointYearPredicate=column=>`datetime(${column})>=${pointYearStartSql}`

// Single SQL wallet expression shared by shop checkout and task reward reservations.
// h and u are internal SQL bind placeholders, not user input.
export function householdWalletSql(h,u,from=null,to=null){
 const inPeriod=column=>from&&to?`datetime(${column})>=datetime(${from}) AND datetime(${column})<datetime(${to})`:pointYearPredicate(column)
 const sum=sql=>`COALESCE((SELECT SUM(${sql}),0)`
 const earned=sum(`c.points) FROM completion_points c WHERE c.household_id=${h} AND c.earner_user_id=${u} AND c.visibility='household' AND ${inPeriod('c.earned_at')}`)
 const adjust=sum(`a.delta) FROM completion_point_adjustments a WHERE a.household_id=${h} AND a.earner_user_id=${u} AND a.visibility='household' AND ${inPeriod('a.earned_at')}`)
 const jointBase=sum(`j.points) FROM dual_completion_splits j WHERE j.household_id=${h} AND j.user_id=${u} AND j.visibility='household' AND ${inPeriod('j.earned_at')}`)
 const shopping=sum(`s.points) FROM shopping_completion_points s WHERE s.household_id=${h} AND s.earner_user_id=${u} AND s.visibility='household' AND ${inPeriod('s.earned_at')}`)
 const shoppingSplit=sum(`j.points) FROM shopping_joint_credits j WHERE j.household_id=${h} AND j.user_id=${u} AND j.visibility='household' AND ${inPeriod('j.earned_at')}`)
 const weekly=sum(`w.points) FROM weekly_challenge_awards w WHERE w.household_id=${h} AND w.user_id=${u} AND ${inPeriod('w.awarded_at')}`)
 const savings=sum(`gr.points) FROM goal_completion_rewards gr WHERE gr.household_id=${h} AND gr.user_id=${u} AND ${inPeriod('gr.awarded_at')}`)
 const trips=sum(`tr.points) FROM trip_completion_rewards tr WHERE tr.household_id=${h} AND tr.user_id=${u} AND tr.visibility='household' AND ${inPeriod('tr.awarded_at')}`)
 const achievements=sum(`ma.points) FROM monthly_achievement_credits ma WHERE ma.household_id=${h} AND ma.user_id=${u} AND ${from&&to?`ma.month_on>=strftime('%Y-01',${from},'+9 hours') AND ma.month_on<strftime('%Y-01',${to},'+9 hours')`:`ma.month_on>=strftime('%Y-01','now','+9 hours')`}`)
 const incoming=sum(`t.bonus_points) FROM tasks t WHERE t.household_id=${h} AND t.assignee_user_id=${u} AND t.second_assignee_user_id IS NULL AND t.completed_by=${u} AND t.creator_user_id<>${u} AND t.visibility='household' AND t.deleted_at IS NULL AND t.completed_at IS NOT NULL AND ${inPeriod('t.created_at')}`)
 const outgoing=sum(`t.bonus_points) FROM tasks t WHERE t.household_id=${h} AND t.creator_user_id=${u} AND t.second_assignee_user_id IS NULL AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>${u} AND t.visibility='household' AND t.deleted_at IS NULL AND (t.completed_at IS NULL OR t.completed_by=t.assignee_user_id) AND ${inPeriod('t.created_at')}`)
 const duoTaskIn=sum(`t.bonus_points/2.0) FROM tasks t
   WHERE t.household_id=${h} AND t.second_assignee_user_id IS NOT NULL
    AND ${u} IN (t.assignee_user_id,t.second_assignee_user_id)
    AND t.completed_at IS NOT NULL
    AND t.completed_by IN (t.assignee_user_id,t.second_assignee_user_id)
    AND t.visibility='household' AND t.deleted_at IS NULL AND ${inPeriod('t.created_at')}`)
 const duoTaskOut=sum(`t.bonus_points) FROM tasks t
   WHERE t.household_id=${h} AND t.second_assignee_user_id IS NOT NULL
    AND t.creator_user_id=${u} AND t.visibility='household' AND t.deleted_at IS NULL
    AND (t.completed_at IS NULL OR
      t.completed_by IN(t.assignee_user_id,t.second_assignee_user_id)) AND ${inPeriod('t.created_at')}`)
 const routineIncoming=sum(`a.bonus_points) FROM routine_occurrence_assignments a
   JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
   JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
   WHERE a.household_id=${h} AND a.assignee_user_id=${u} AND a.second_assignee_user_id IS NULL
     AND m.completed_at IS NOT NULL AND m.completed_by=${u}
     AND r.created_by<>${u} AND r.visibility='household' AND r.deleted_at IS NULL AND ${inPeriod('a.created_at')}`)
 const routineOutgoing=sum(`a.bonus_points) FROM routine_occurrence_assignments a
   JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
   LEFT JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
   WHERE a.household_id=${h} AND r.created_by=${u}
     AND a.assignee_user_id<>${u} AND a.second_assignee_user_id IS NULL AND r.visibility='household' AND r.deleted_at IS NULL
     AND ((m.completed_at IS NULL AND m.skipped_at IS NULL)
       OR (m.completed_at IS NOT NULL AND m.completed_by=a.assignee_user_id)) AND ${inPeriod('a.created_at')}`)
 const duoRoutineIn=sum(`a.bonus_points/2.0) FROM routine_occurrence_assignments a
   JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
   JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
   WHERE a.household_id=${h} AND a.second_assignee_user_id IS NOT NULL
    AND ${u} IN(a.assignee_user_id,a.second_assignee_user_id)
    AND m.completed_at IS NOT NULL
    AND m.completed_by IN(a.assignee_user_id,a.second_assignee_user_id)
    AND r.visibility='household' AND r.deleted_at IS NULL AND ${inPeriod('a.created_at')}`)
 const duoRoutineOut=sum(`a.bonus_points) FROM routine_occurrence_assignments a
   JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
   LEFT JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
   WHERE a.household_id=${h} AND a.second_assignee_user_id IS NOT NULL
    AND r.created_by=${u} AND r.visibility='household' AND r.deleted_at IS NULL
    AND ((m.completed_at IS NULL AND m.skipped_at IS NULL)
      OR (m.completed_at IS NOT NULL
       AND m.completed_by IN(a.assignee_user_id,a.second_assignee_user_id))) AND ${inPeriod('a.created_at')}`)
 const lotteryWinnings=sum(`l.prize_points) FROM household_lottery_draws l WHERE l.household_id=${h} AND l.user_id=${u} AND ${inPeriod('l.created_at')}`)
 const lotteryCosts=sum(`l.cost_points) FROM household_lottery_draws l WHERE l.household_id=${h} AND l.user_id=${u} AND ${inPeriod('l.created_at')}`)
 const direct=sum(`r.points_spent) FROM reward_redemptions r WHERE r.household_id=${h} AND r.redeemed_by=${u} AND ${inPeriod('r.created_at')}`)
 const group=sum(`c.points) FROM reward_group_contributions c JOIN reward_group_orders g ON g.id=c.order_id WHERE c.household_id=${h} AND c.user_id=${u} AND (g.status<>'cancelled'${from&&to?` OR datetime(g.cancelled_at)>=datetime(${to})`:''}) AND ${inPeriod('c.created_at')}`)
 return `(${earned} + ${adjust} + ${jointBase} + ${shopping} + ${shoppingSplit} + ${weekly} + ${savings} + ${trips} + ${achievements} + ${incoming} + ${routineIncoming} + ${duoTaskIn} + ${duoRoutineIn} - ${outgoing} - ${routineOutgoing} - ${duoTaskOut} - ${duoRoutineOut} - ${direct} - ${group} + ${lotteryWinnings} - ${lotteryCosts})`
}
