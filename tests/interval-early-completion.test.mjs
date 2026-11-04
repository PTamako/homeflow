import assert from 'node:assert/strict'
import test from 'node:test'
import {addDays,canCompleteEarly,dueOn,lastScheduledBefore,pendingCarryover} from '../worker/recurrence.js'

const interval=(start,days,anchor='completion',next=null)=>({
  enabled:1,anchor_date:start,repeat_type:'interval',next_due_on:next,
  repeat_config:JSON.stringify({days,anchor})
})

test('first 90-day treatment is not due on its baseline or on Nov 4',()=>{
  const r=interval('2026-08-26',90)
  assert.equal(addDays('2026-08-26',90),'2026-11-24')
  assert.equal(dueOn(r,'2026-08-26'),false)
  assert.equal(dueOn(r,'2026-11-04'),false)
  assert.equal(dueOn(r,'2026-11-23'),false)
  assert.equal(dueOn(r,'2026-11-24'),true)
  assert.equal(dueOn(r,'2026-11-25'),true)
  assert.equal(pendingCarryover(r,'2026-11-04',null),null)
})

test('external 60-day treatment is not due before Dec 3',()=>{
  const r=interval('2026-10-04',60)
  assert.equal(addDays('2026-10-04',60),'2026-12-03')
  assert.equal(dueOn(r,'2026-11-04'),false)
  assert.equal(dueOn(r,'2026-12-02'),false)
  assert.equal(dueOn(r,'2026-12-03'),true)
})

test('early completion shifts only the next occurrence and is not immediately due again',()=>{
  const r=interval('2026-08-26',90)
  assert.equal(canCompleteEarly(r,'2026-11-04'),true)
  const after=interval('2026-08-26',90,'completion',addDays('2026-11-04',90))
  assert.equal(after.next_due_on,'2027-02-02')
  assert.equal(dueOn(after,'2026-11-05'),false)
  assert.equal(dueOn(after,'2027-02-01'),false)
  assert.equal(dueOn(after,'2027-02-02'),true)
  assert.equal(canCompleteEarly(after,'2026-11-05'),true)
  assert.equal(canCompleteEarly(after,'2027-02-02'),false)
  assert.equal(canCompleteEarly({...after,enabled:0},'2026-11-05'),false)
  assert.equal(canCompleteEarly(interval('2026-12-01',60),'2026-11-04'),false)
  assert.equal(canCompleteEarly(interval('2026-08-26',90,'fixed'),'2026-11-04'),false)
})

test('fixed intervals do not create overdue baseline occurrence',()=>{
  const r=interval('2026-08-26',90,'fixed')
  assert.equal(dueOn(r,'2026-08-26'),false)
  assert.equal(lastScheduledBefore(r,'2026-11-04'),null)
  assert.equal(pendingCarryover(r,'2026-11-04',null),null)
  assert.equal(dueOn(r,'2026-11-24'),true)
  assert.equal(lastScheduledBefore(r,'2026-11-25'),'2026-11-24')
  assert.equal(pendingCarryover(r,'2026-11-25',null),'2026-11-24')
  assert.equal(pendingCarryover(r,'2026-11-25','2026-11-24'),null)
})
