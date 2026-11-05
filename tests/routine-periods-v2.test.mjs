import assert from 'node:assert/strict'
import test from 'node:test'
import {nextRoutineDue,previousRoutineDue,currentRoutinePeriod,nextEarlyPeriod,
  historyCandidates,isClosedRoutinePeriod} from '../worker/routine-periods.js'

function rule(type,anchor,config,more={}){
 return {id:'rule',enabled:1,repeat_type:type,anchor_date:anchor,repeat_config:JSON.stringify(config),...more}
}
test('weekly next occurrence stays on the chosen weekday after an early completion',()=>{
 const sunday=rule('weekly','2026-11-01',{weekdays:[0]})
 assert.equal(nextRoutineDue(sunday,'2026-11-05'),'2026-11-08')
 assert.equal(nextEarlyPeriod(sunday,'2026-11-05'),'2026-11-08')
 assert.equal(currentRoutinePeriod(sunday,'2026-11-08'),'2026-11-08')
 assert.equal(nextRoutineDue(sunday,'2026-11-09'),'2026-11-15')
 assert.deepEqual(historyCandidates(sunday,'2026-11-16',3),['2026-11-15','2026-11-08','2026-11-01'])
 assert.equal(isClosedRoutinePeriod(sunday,'2026-11-08','2026-11-15'),true)
 assert.equal(isClosedRoutinePeriod(sunday,'2026-11-15','2026-11-15'),false)
})
test('daily cannot pre-complete, but workday can complete the next workday',()=>{
 const daily=rule('daily','2026-11-01',{})
 const workday=rule('weekly','2026-11-01',{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true})
 assert.equal(nextEarlyPeriod(daily,'2026-11-05'),null)
 assert.equal(nextEarlyPeriod(workday,'2026-11-05'),null, 'current workday must be handled first')
 assert.equal(nextRoutineDue(workday,'2026-11-07'),'2026-11-09')
 assert.equal(nextEarlyPeriod(workday,'2026-11-07'),'2026-11-09')
})
test('monthly day 31 executes on February last day',()=>{
 const monthly=rule('monthly','2026-01-31',{day:31})
 assert.equal(nextRoutineDue(monthly,'2026-02-01'),'2026-02-28')
 assert.equal(currentRoutinePeriod(monthly,'2026-03-01'),'2026-02-28')
 assert.equal(nextRoutineDue(monthly,'2026-03-01'),'2026-03-31')
})
test('completion anchored interval has one due period at a time',()=>{
 const r=rule('interval','2026-08-26',{days:90,anchor:'completion'})
 assert.equal(nextRoutineDue(r,'2026-11-05'),'2026-11-24')
 assert.equal(nextEarlyPeriod(r,'2026-11-05'),'2026-11-24')
 assert.equal(currentRoutinePeriod(r,'2026-11-25'),'2026-11-24')
 assert.equal(previousRoutineDue(r,'2026-11-25'),null)
 const after={...r,next_due_on:'2027-02-03'}
 assert.equal(currentRoutinePeriod(after,'2026-11-25'),null)
 assert.equal(nextRoutineDue(after,'2026-11-25'),'2027-02-03')
})
test('fixed intervals preserve their original grid and archived missed periods',()=>{
 const r=rule('interval','2026-08-26',{days:90,anchor:'fixed'})
 assert.equal(nextRoutineDue(r,'2026-11-05'),'2026-11-24')
 assert.equal(nextEarlyPeriod(r,'2026-11-05'),'2026-11-24')
 assert.equal(nextRoutineDue(r,'2026-11-25'),'2027-02-22')
 assert.equal(isClosedRoutinePeriod(r,'2026-11-24','2027-02-22'),true)
})
