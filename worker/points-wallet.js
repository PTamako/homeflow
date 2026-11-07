// Single SQL wallet expression shared by shop checkout and task reward reservations.
// h and u are internal SQL bind placeholders, not user input.
export function householdWalletSql(h,u){
 const sum=sql=>`COALESCE((SELECT SUM(${sql}),0)`
 const earned=sum(`c.points) FROM completion_points c WHERE c.household_id=${h} AND c.earner_user_id=${u} AND c.visibility='household'`)
 const adjust=sum(`a.delta) FROM completion_point_adjustments a WHERE a.household_id=${h} AND a.earner_user_id=${u} AND a.visibility='household'`)
 const shopping=sum(`s.points) FROM shopping_completion_points s WHERE s.household_id=${h} AND s.earner_user_id=${u} AND s.visibility='household'`)
 const weekly=sum(`w.points) FROM weekly_challenge_awards w WHERE w.household_id=${h} AND w.user_id=${u}`)
 const incoming=sum(`t.bonus_points) FROM tasks t WHERE t.household_id=${h} AND t.assignee_user_id=${u} AND t.completed_by=${u} AND t.creator_user_id<>${u} AND t.visibility='household' AND t.deleted_at IS NULL AND t.completed_at IS NOT NULL`)
 const outgoing=sum(`t.bonus_points) FROM tasks t WHERE t.household_id=${h} AND t.creator_user_id=${u} AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>${u} AND t.visibility='household' AND t.deleted_at IS NULL AND (t.completed_at IS NULL OR t.completed_by=t.assignee_user_id)`)
 const direct=sum(`r.points_spent) FROM reward_redemptions r WHERE r.household_id=${h} AND r.redeemed_by=${u}`)
 const group=sum(`c.points) FROM reward_group_contributions c JOIN reward_group_orders g ON g.id=c.order_id WHERE c.household_id=${h} AND c.user_id=${u} AND g.status<>'cancelled'`)
 return `(${earned} + ${adjust} + ${shopping} + ${weekly} + ${incoming} - ${outgoing} - ${direct} - ${group})`
}
