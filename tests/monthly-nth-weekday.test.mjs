import assert from 'node:assert/strict'
import test from 'node:test'
import {dueOn,validateRule,pendingCarryover,lastScheduledBefore} from '../worker/recurrence.js'
import {nextRoutineDue,previousRoutineDue,currentRoutinePeriod,nextEarlyPeriod,
 historyCandidates,isClosedRoutinePeriod} from '../worker/routine-periods.js'
import {readFileSync} from 'node:fs'

const monthly=(start,config)=>({
 id:'monthly-test',enabled:1,repeat_type:'monthly',anchor_date:start,
 repeat_config:JSON.stringify(config)
})
const trash=monthly('2026-11-06',{mode:'weekday',weekday:2,weekNumbers:[2,4]})

test('every second and fourth Tuesday: no first, third, or fifth Tuesday',()=>{
 const due=['2026-11-10','2026-11-24','2026-12-08','2026-12-22','2027-01-12','2027-01-26']
 for(const date of due)assert.equal(dueOn(trash,date),true,date)
 for(const date of ['2026-11-03','2026-11-17','2026-12-01','2026-12-15',
   '2026-12-29','2026-11-11'])assert.equal(dueOn(trash,date),false,date)
 assert.equal(nextRoutineDue(trash,'2026-11-06'),'2026-11-10')
 assert.equal(nextRoutineDue(trash,'2026-11-11'),'2026-11-24')
 assert.equal(nextRoutineDue(trash,'2026-11-25'),'2026-12-08')
 assert.equal(nextEarlyPeriod(trash,'2026-11-06'),'2026-11-10')
 assert.equal(currentRoutinePeriod(trash,'2026-11-11'),'2026-11-10')
 assert.equal(currentRoutinePeriod(trash,'2026-11-25'),'2026-11-24')
 assert.equal(previousRoutineDue(trash,'2026-12-01'),'2026-11-24')
 assert.deepEqual(historyCandidates(trash,'2026-12-10',4),
  ['2026-12-08','2026-11-24','2026-11-10'])
 assert.equal(isClosedRoutinePeriod(trash,'2026-11-10','2026-11-24'),true)
 assert.equal(isClosedRoutinePeriod(trash,'2026-11-24','2026-11-24'),false)
})

test('second and fourth remain separate periods even when previous one rolls over',()=>{
 assert.equal(pendingCarryover(trash,'2026-11-11',null),'2026-11-10')
 assert.equal(pendingCarryover(trash,'2026-11-11','2026-11-10'),null)
 assert.equal(pendingCarryover(trash,'2026-11-25','2026-11-10'),'2026-11-24')
 assert.equal(pendingCarryover(trash,'2026-12-01','2026-11-24'),null)
})

test('sparse fifth weekdays exist only in months with a fifth occurrence',()=>{
 const fifth=monthly('2026-03-01',{mode:'weekday',weekday:2,weekNumbers:[5]})
 assert.equal(dueOn(fifth,'2026-03-31'),true)
 assert.equal(dueOn(fifth,'2026-04-28'),false)
 assert.equal(dueOn(fifth,'2026-05-26'),false)
 assert.equal(dueOn(fifth,'2026-06-30'),true)
 assert.equal(nextRoutineDue(fifth,'2026-04-01'),'2026-06-30')
 assert.equal(lastScheduledBefore(fifth,'2026-06-01'),'2026-03-31')
 assert.equal(currentRoutinePeriod(fifth,'2026-06-01'),'2026-03-31')
 assert.equal(nextRoutineDue(fifth,'2026-06-01'),'2026-06-30')
})

test('legacy monthly date 31 still uses month end, and malformed new rules are rejected',()=>{
 const old=monthly('2026-01-31',{day:31})
 assert.equal(dueOn(old,'2026-02-28'),true)
 assert.equal(dueOn(old,'2026-03-31'),true)
 assert.equal(validateRule({repeatType:'monthly',repeatConfig:{day:31}}),true)
 assert.equal(validateRule({repeatType:'monthly',repeatConfig:{
   mode:'weekday',weekday:2,weekNumbers:[2,4]}}),true)
 for(const config of [
  {mode:'weekday',weekday:7,weekNumbers:[2]},
  {mode:'weekday',weekday:2,weekNumbers:[]},
  {mode:'weekday',weekday:2,weekNumbers:[2,2]},
  {mode:'weekday',weekday:2,weekNumbers:[0]},
  {mode:'weekday',weekday:2,weekNumbers:[6]},
  {mode:'weekday',weekday:2,weekNumbers:'2,4'},
  {mode:'unexpected',day:10}
 ])assert.equal(validateRule({repeatType:'monthly',repeatConfig:config}),false,
  JSON.stringify(config))
})

test('create/edit plan UI includes date or multi-select nth weekday without a second plan',()=>{
 const create=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 const edit=readFileSync(new URL('../src/components/LifeItemEditor.vue',import.meta.url),'utf8')
 const list=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 for(const s of [create,edit]){
  assert.match(s,/value="weekday">指定第几个星期几/)
  assert.match(s,/v-model="form.monthWeekNumbers" type="checkbox"/)
  assert.match(s,/v-model.number="form.monthWeekday"/)
  assert.match(s,/monthWeekNumbers:\[2,4\]|monthWeekNumbers:Array.isArray/)
 }
 assert.match(create,/value="day">指定日期/)
 assert.match(create,/v-model="form.monthDays" type="checkbox"/)
 assert.match(edit,/v-model="form.monthDays" type="checkbox"/)
 assert.match(list,/config.mode==='weekday'/)
 assert.match(list,/weekNumbers\|\|\[\]/)
})
