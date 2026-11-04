import test from 'node:test'
import assert from 'node:assert/strict'
import {dueOn,lastScheduledBefore,pendingCarryover} from '../worker/recurrence.js'
test('unfinished weekly occurrence rolls forward once and stops after completion',()=>{
 const r={repeat_type:'weekly',repeat_config:JSON.stringify({weekdays:[1]}),anchor_date:'2026-11-02'}
 assert.equal(dueOn(r,'2026-11-03'),false)
 assert.equal(lastScheduledBefore(r,'2026-11-03'),'2026-11-02')
 assert.equal(pendingCarryover(r,'2026-11-03',null),'2026-11-02')
 assert.equal(pendingCarryover(r,'2026-11-04','2026-11-03'),null)
 assert.equal(dueOn(r,'2026-11-09'),true)
})
test('monthly rollover and fixed interval preserve their original due dates',()=>{
 const monthly={repeat_type:'monthly',repeat_config:'{"day":1}',anchor_date:'2026-10-01'}
 assert.equal(pendingCarryover(monthly,'2026-11-04',null),'2026-11-01')
 assert.equal(pendingCarryover(monthly,'2026-11-05','2026-11-04'),null)
 assert.equal(dueOn(monthly,'2026-12-01'),true)
 const fixed={repeat_type:'interval',repeat_config:'{"days":3,"anchor":"fixed"}',anchor_date:'2026-11-01'}
 assert.equal(pendingCarryover(fixed,'2026-11-05',null),'2026-11-04')
 assert.equal(pendingCarryover(fixed,'2026-11-06','2026-11-05'),null)
 assert.equal(dueOn(fixed,'2026-11-07'),true)
})
test('completion interval naturally carries forward from nextDueOn',()=>{
 const r={repeat_type:'interval',repeat_config:'{"days":3,"anchor":"completion"}',
   anchor_date:'2026-11-01',next_due_on:'2026-11-04'}
 assert.equal(dueOn(r,'2026-11-05'),true)
 assert.equal(pendingCarryover(r,'2026-11-05',null),null)
})
test('workday overdue does not leak into Saturday, Sunday or holidays',()=>{
 const r={repeat_type:'weekly',
   repeat_config:JSON.stringify({weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}),
   anchor_date:'2026-11-06'}
 assert.equal(pendingCarryover(r,'2026-11-07',null),null)
 assert.equal(pendingCarryover(r,'2026-11-08',null),null)
 assert.equal(dueOn(r,'2026-11-09'),true)
 assert.equal(dueOn(r,'2026-11-23'),false) // Japanese Labor Thanksgiving Day
 assert.equal(pendingCarryover(r,'2026-11-23',null),null)
})
