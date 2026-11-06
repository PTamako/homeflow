import assert from 'node:assert/strict'
import test from 'node:test'
import {dueOn,validateRule,lastScheduledBefore} from '../worker/recurrence.js'
import {nextRoutineDue,previousRoutineDue,currentRoutinePeriod,historyCandidates} from '../worker/routine-periods.js'
import {readFileSync} from 'node:fs'

const rule=(type,anchor,config)=>({
 id:'multi-schedule',enabled:1,repeat_type:type,anchor_date:anchor,repeat_config:JSON.stringify(config)
})

test('one weekly plan generates independent Monday, Wednesday and Friday occurrences',()=>{
 const routine=rule('weekly','2026-11-01',{weekdays:[1,3,5]})
 for(const date of ['2026-11-02','2026-11-04','2026-11-06','2026-11-09'])
   assert.equal(dueOn(routine,date),true,date)
 for(const date of ['2026-10-30','2026-11-01','2026-11-03','2026-11-07'])
   assert.equal(dueOn(routine,date),false,date)
 assert.equal(nextRoutineDue(routine,'2026-11-03'),'2026-11-04')
 assert.equal(previousRoutineDue(routine,'2026-11-06'),'2026-11-04')
 assert.equal(currentRoutinePeriod(routine,'2026-11-07'),'2026-11-06')
 assert.deepEqual(historyCandidates(routine,'2026-11-10',4),[
   '2026-11-09','2026-11-06','2026-11-04','2026-11-02'
 ])
})

test('monthly 5th, 15th and 25th are distinct periods and recur next month',()=>{
 const routine=rule('monthly','2026-11-01',{mode:'day',days:[5,15,25]})
 for(const date of ['2026-11-05','2026-11-15','2026-11-25','2026-12-05'])
   assert.equal(dueOn(routine,date),true,date)
 assert.equal(dueOn(routine,'2026-11-20'),false)
 assert.equal(nextRoutineDue(routine,'2026-11-06'),'2026-11-15')
 assert.equal(nextRoutineDue(routine,'2026-11-26'),'2026-12-05')
 assert.equal(currentRoutinePeriod(routine,'2026-11-20'),'2026-11-15')
 assert.deepEqual(historyCandidates(routine,'2026-11-27',3),[
  '2026-11-25','2026-11-15','2026-11-05'
 ])
})

test('month-end clipping merges duplicate dates into a single occurrence',()=>{
 const routine=rule('monthly','2027-01-01',{mode:'day',days:[29,30,31]})
 assert.equal(dueOn(routine,'2027-01-29'),true)
 assert.equal(dueOn(routine,'2027-01-30'),true)
 assert.equal(dueOn(routine,'2027-01-31'),true)
 assert.equal(dueOn(routine,'2027-02-27'),false)
 assert.equal(dueOn(routine,'2027-02-28'),true)
 assert.equal(dueOn(routine,'2027-03-01'),false)
 assert.equal(nextRoutineDue(routine,'2027-02-01'),'2027-02-28')
 assert.equal(nextRoutineDue(routine,'2027-03-01'),'2027-03-29')
 assert.equal(lastScheduledBefore(routine,'2027-03-01'),'2027-02-28')
 assert.deepEqual(historyCandidates(routine,'2027-03-01',5),[
   '2027-02-28','2027-01-31','2027-01-30','2027-01-29'
 ])
 const leap=rule('monthly','2028-01-01',{mode:'day',days:[29,30,31]})
 assert.equal(dueOn(leap,'2028-02-29'),true)
 assert.equal(dueOn(leap,'2028-02-28'),false)
})

test('legacy monthly single-day rules stay valid and on the original dates',()=>{
 const legacy=rule('monthly','2026-01-31',{day:31})
 assert.equal(validateRule({repeatType:'monthly',repeatConfig:{day:31}}),true)
 assert.equal(dueOn(legacy,'2026-02-28'),true)
 assert.equal(nextRoutineDue(legacy,'2026-03-01'),'2026-03-31')
})

test('reject empty, out of range, malformed, or duplicated selections',()=>{
 for(const valid of [
  {repeatType:'weekly',repeatConfig:{weekdays:[0,2,4,6]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:[1,15,31]}}
 ])assert.equal(validateRule(valid),true,JSON.stringify(valid))
 for(const invalid of [
  {repeatType:'weekly',repeatConfig:{weekdays:[]}},
  {repeatType:'weekly',repeatConfig:{weekdays:[1,1]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:[]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:[5,5]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:[0]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:[32]}},
  {repeatType:'monthly',repeatConfig:{mode:'day',days:'5,15'}},
  {repeatType:'monthly',repeatConfig:{mode:'unexpected',days:[5]}}
 ])assert.equal(validateRule(invalid),false,JSON.stringify(invalid))
})

test('creation and edit UI both expose multi-select weekdays and dates',()=>{
 for(const filename of ['PlanCreator.vue','LifeItemEditor.vue']){
  const content=readFileSync(new URL('../src/components/'+filename,import.meta.url),'utf8')
  assert.match(content,/v-model="form.weekdays" type="checkbox"/)
  assert.match(content,/v-model="form.monthDays" type="checkbox"/)
  assert.match(content,/请至少选择一个日期/)
 }
 const server=readFileSync(new URL('../worker/life.js',import.meta.url),'utf8')
 assert.match(server,/Array.isArray\(input.days\)/)
})
