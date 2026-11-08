import assert from 'node:assert/strict'
import {test} from 'node:test'
import {householdWalletSql,pointYearStartSql,pointYearPredicate} from '../worker/points-wallet.js'
import {contributionAssignmentDeltaSql,contributionWeeklySql} from '../worker/contribution.js'
import {annualPointsExpiryEvent} from '../worker/webpush.js'
import {jstNotificationDay} from '../worker/notifications.js'
import {expireOldRewardPools} from '../worker/rewards.js'
import {annualPointLedgerSql} from '../worker/points-history.js'

test('annual points are scoped to January 1 00:00 JST without wiping ledger rows',()=>{
  assert.equal(pointYearStartSql,"datetime('now','+9 hours','start of year','-9 hours')")
  const sql=householdWalletSql('?1','?2')
  // Every credit and every spend must obey the same reset date.
  for(const field of ['c.earned_at','a.earned_at','j.earned_at','s.earned_at',
    'w.awarded_at','gr.awarded_at','tr.awarded_at','t.created_at',
    'l.created_at','r.created_at']){
    assert.ok(sql.includes(pointYearPredicate(field)),field)
  }
  assert.ok(sql.includes("ma.month_on>=strftime('%Y-01','now','+9 hours')"))
  assert.ok(sql.includes(pointYearPredicate('a.created_at')))
  assert.ok(sql.includes(pointYearPredicate('c.created_at')))
  assert.doesNotMatch(sql,/DELETE\s+FROM|DROP\s+TABLE/i)
  assert.match(contributionAssignmentDeltaSql('?1','?2'),
    /datetime\(t\.completed_at\)/)
  assert.match(contributionWeeklySql('?1','?2'),/datetime\(w\.awarded_at\)/)
})

test('New Year changes at JST midnight, not UTC midnight',()=>{
  assert.equal(jstNotificationDay(Date.parse('2026-12-31T14:59:59Z')),'2026-12-31')
  assert.equal(jstNotificationDay(Date.parse('2026-12-31T15:00:00Z')),'2027-01-01')
})

test('December 31 creates an important reminder, other days do not',()=>{
  const event=annualPointsExpiryEvent('2026-12-31')
  assert.equal(event.title,'年度积分即将清零')
  assert.equal(event.message,'请在今日内用完所有积分')
  assert.equal(event.priority,'important')
  assert.equal(event.kind,'system')
  assert.equal(event.dueOn,'2026-12-31')
  assert.equal(annualPointsExpiryEvent('2027-01-01'),null)
  assert.equal(annualPointsExpiryEvent('2026-12-30'),null)
})

test('cross-year collecting orders are cancelled without refunding new-year points',async()=>{
  const commands=[]
  const db={
    prepare(sql){
      commands.push(sql)
      if(sql.includes('SELECT DISTINCT household_id'))
        return {all:async()=>({results:[{householdId:'household-1'}]})}
      return {bind:householdId=>{
        assert.equal(householdId,'household-1')
        return {run:async()=>({meta:{changes:2}})}
      }}
    }
  }
  const result=await expireOldRewardPools(db)
  assert.deepEqual(result,{expiredPools:2,changedHouseholds:['household-1']})
  assert.match(commands.join(' '),/status='cancelled'/)
  assert.match(commands.join(' '),/datetime\(created_at\)</)
  assert.doesNotMatch(commands.join(' '),/reward_group_contributions\s+SET|INSERT\s+INTO\s+completion_points/i)
})

test('D1 annual history avoids oversized compound SELECTs',()=>{
 const query=annualPointLedgerSql()
 // D1's compound SELECT limit is lower than local Node SQLite's. Nested
 // groups cap each compound at five ledger sources while keeping all sources.
 const groups=query.split(') UNION ALL SELECT * FROM (')
 assert.equal(groups.length,5)
 assert.match(query,/^SELECT \* FROM \(/)
 assert.ok(groups.every(group=>group.split(' UNION ALL ').length<=7))
 for(const source of ['completion_points','reward_redemptions','household_lottery_draws',
   'reward_group_contributions','routine_occurrence_assignments','monthly_achievement_credits']){
  assert.ok(query.includes(source),source)
 }
})
