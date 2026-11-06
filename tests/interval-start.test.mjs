import assert from 'node:assert/strict'
import test from 'node:test'
import {canCompleteEarly,dueOn,lastScheduledBefore} from '../worker/recurrence.js'
import {currentRoutinePeriod,historyCandidates,nextEarlyPeriod,nextRoutineDue,
  previousRoutineDue} from '../worker/routine-periods.js'

test('fixed 10-day interval starts on the selected first date, not ten days later',()=>{
  const rule={anchor_date:'2026-11-08',repeat_type:'interval',
    repeat_config:'{"days":10,"anchor":"fixed"}',enabled:1}
  assert.equal(dueOn(rule,'2026-11-06'),false)
  assert.equal(dueOn(rule,'2026-11-08'),true)
  assert.equal(dueOn(rule,'2026-11-18'),true)
  assert.equal(dueOn(rule,'2026-11-28'),true)
  assert.equal(dueOn(rule,'2026-11-09'),false)
  assert.equal(nextRoutineDue(rule,'2026-11-06'),'2026-11-08')
  assert.equal(nextRoutineDue(rule,'2026-11-08'),'2026-11-08')
  assert.equal(nextRoutineDue(rule,'2026-11-09'),'2026-11-18')
  assert.equal(nextRoutineDue(rule,'2026-11-19'),'2026-11-28')
  assert.equal(currentRoutinePeriod(rule,'2026-11-06'),null)
  assert.equal(currentRoutinePeriod(rule,'2026-11-08'),'2026-11-08')
  assert.equal(lastScheduledBefore(rule,'2026-11-09'),'2026-11-08')
  assert.equal(previousRoutineDue(rule,'2026-11-18'),'2026-11-08')
  assert.equal(nextEarlyPeriod(rule,'2026-11-06'),null)
  assert.equal(nextEarlyPeriod(rule,'2026-11-09'),'2026-11-18')
  assert.deepEqual(historyCandidates(rule,'2026-12-01',5),
    ['2026-11-28','2026-11-18','2026-11-08'])
})

test('completion-based interval also starts on selected date, then follows last action',()=>{
  const rule={anchor_date:'2026-11-08',repeat_type:'interval',
    repeat_config:'{"days":10,"anchor":"completion"}',enabled:1}
  assert.equal(nextRoutineDue(rule,'2026-11-06'),'2026-11-08')
  assert.equal(dueOn(rule,'2026-11-08'),true)
  assert.equal(currentRoutinePeriod(rule,'2026-11-08'),'2026-11-08')
  assert.equal(canCompleteEarly(rule,'2026-11-06'),false)
  assert.equal(canCompleteEarly(rule,'2026-11-08'),false)
  assert.equal(nextEarlyPeriod(rule,'2026-11-06'),null)
  const completed={...rule,next_due_on:'2026-11-18'}
  assert.equal(nextRoutineDue(completed,'2026-11-09'),'2026-11-18')
  assert.equal(dueOn(completed,'2026-11-09'),false)
  assert.equal(dueOn(completed,'2026-11-18'),true)
  assert.equal(canCompleteEarly(completed,'2026-11-10'),true)
  assert.equal(currentRoutinePeriod(completed,'2026-11-18'),'2026-11-18')
  assert.deepEqual(historyCandidates(rule,'2026-12-01',5),[])
})

test('fixed interval with a one-day cadence includes its first day and next day',()=>{
  const rule={anchor_date:'2026-11-08',repeat_type:'interval',
    repeat_config:'{"days":1,"anchor":"fixed"}',enabled:1}
  assert.equal(nextRoutineDue(rule,'2026-11-06'),'2026-11-08')
  assert.equal(nextRoutineDue(rule,'2026-11-08'),'2026-11-08')
  assert.equal(nextRoutineDue(rule,'2026-11-09'),'2026-11-09')
  assert.equal(currentRoutinePeriod(rule,'2026-11-09'),'2026-11-09')
})
