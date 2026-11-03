import assert from 'node:assert/strict'
import test from 'node:test'
import {daysBetween,dueOn,nextAnniversary,validateRule} from '../worker/recurrence.js'
test('daily and weekly routines',()=>{
 assert.equal(dueOn({anchor_date:'2026-11-01',repeat_type:'daily',repeat_config:'{}'},'2026-11-06'),true)
 assert.equal(dueOn({anchor_date:'2026-11-01',repeat_type:'weekly',repeat_config:'{"weekdays":[0]}'},'2026-11-08'),true)
 assert.equal(dueOn({anchor_date:'2026-11-01',repeat_type:'weekly',repeat_config:'{"weekdays":[0]}'},'2026-11-09'),false)
})
test('interval and monthly',()=>{
 assert.equal(daysBetween('2026-11-01','2026-11-04'),3)
 assert.equal(dueOn({anchor_date:'2026-11-01',repeat_type:'interval',repeat_config:'{"days":3}'},'2026-11-04'),true)
 assert.equal(dueOn({anchor_date:'2026-11-01',repeat_type:'monthly',repeat_config:'{"day":20}'},'2026-11-20'),true)
})
test('yearly birthday and month ends',()=>{
 assert.equal(nextAnniversary('2024-02-29','yearly','2027-02-01'),'2027-02-28')
 assert.equal(nextAnniversary('2024-01-31','monthly','2026-02-01'),'2026-02-28')
 assert.equal(nextAnniversary('2024-01-01','once','2026-01-02'),null)
})
test('reject malformed recurrence configuration',()=>{
 assert.equal(validateRule({repeatType:'interval',repeatConfig:{days:0}}),false)
 assert.equal(validateRule({repeatType:'weekly',repeatConfig:{weekdays:[9]}}),false)
})
