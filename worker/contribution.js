import {pointYearPredicate} from './points-wallet.js'
// Contribution is the lifetime/monthly net of HOUSEHOLD points actually awarded.
// Unlike a spendable wallet, it excludes purchases, lottery and uncompleted bounty
// reservations. Completion/undo, reassignment, removal and visibility changes
// are reflected by the underlying source rows; no second mutable ledger is used.
//
// h/u/from/to are trusted SQL expressions/placeholders supplied by pointsRoute,
// never unvalidated user data or SQL identifiers.
export function contributionAssignmentDeltaSql(h,u,from=null,to=null){
  const period=column=>from&&to?` AND ${column}>=${from} AND ${column}<${to}`:''
  const task=`COALESCE((SELECT SUM(
    (CASE WHEN t.second_assignee_user_id IS NOT NULL
      THEN CASE WHEN ${u} IN(t.assignee_user_id,t.second_assignee_user_id)
        THEN t.bonus_points/2.0 ELSE 0 END
      ELSE CASE WHEN t.assignee_user_id=${u}
        THEN t.bonus_points ELSE 0 END END)
      -CASE WHEN t.creator_user_id=${u} THEN t.bonus_points ELSE 0 END
    ) FROM tasks t
    WHERE t.household_id=${h} AND t.visibility='household'
      AND t.deleted_at IS NULL AND t.bonus_points>0 AND t.completed_at IS NOT NULL
       AND ${pointYearPredicate('t.completed_at')}
      AND t.completed_by IN(t.assignee_user_id,t.second_assignee_user_id)
      AND (${u}=t.creator_user_id OR ${u} IN(t.assignee_user_id,t.second_assignee_user_id))
      ${period('t.completed_at')}),0)`
  const routine=`COALESCE((SELECT SUM(
    (CASE WHEN a.second_assignee_user_id IS NOT NULL
      THEN CASE WHEN ${u} IN(a.assignee_user_id,a.second_assignee_user_id)
        THEN a.bonus_points/2.0 ELSE 0 END
      ELSE CASE WHEN a.assignee_user_id=${u}
        THEN a.bonus_points ELSE 0 END END)
      -CASE WHEN r.created_by=${u} THEN a.bonus_points ELSE 0 END
    ) FROM routine_occurrence_assignments a
    JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
    JOIN routine_marks m ON m.routine_id=a.routine_id
      AND m.occurrence_on=a.occurrence_on
    WHERE a.household_id=${h} AND r.visibility='household'
      AND r.deleted_at IS NULL AND a.bonus_points>0 AND m.completed_at IS NOT NULL
       AND ${pointYearPredicate('m.completed_at')}
      AND m.completed_by IN(a.assignee_user_id,a.second_assignee_user_id)
      AND (${u}=r.created_by OR ${u} IN(a.assignee_user_id,a.second_assignee_user_id))
      ${period('m.completed_at')}),0)`
  return `(${task}+${routine})`
}
export function contributionWeeklySql(h,u,from=null,to=null){
  return `COALESCE((SELECT SUM(w.points) FROM weekly_challenge_awards w
    WHERE w.household_id=${h} AND w.user_id=${u} AND ${pointYearPredicate('w.awarded_at')}${
      from&&to?` AND w.awarded_at>=${from} AND w.awarded_at<${to}`:''}),0)`
}
