// Virtual household reward allowance for wishes with linked one-time savings goals.
// These credits are NOT Kakebo transactions, bank deposits or points themselves.
// Only fully funded pooled orders count; cancelled/unfunded orders contribute zero.
// Values are snapshotted at redemption and remain unaffected by later shop edits.
export const goalRewardCreditSql=(household,goal)=>`(
  COALESCE((SELECT SUM(r.goal_credit_yen)
    FROM reward_redemptions r
    WHERE r.household_id=${household} AND r.credited_goal_id=${goal}),0)
  + COALESCE((SELECT SUM(o.goal_credit_yen)
    FROM reward_group_orders o
    WHERE o.household_id=${household} AND o.credited_goal_id=${goal}
      AND o.status IN ('requested','fulfilled')),0)
)`

export async function goalRewardCreditAmount(db,household,goal){
 const row=await db.prepare(`SELECT ${goalRewardCreditSql('?1','?2')} AS amount`)
   .bind(household,goal).first()
 return Number(row?.amount||0)
}
