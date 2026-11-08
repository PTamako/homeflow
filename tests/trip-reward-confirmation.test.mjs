import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {tripDurationDays,longTripNeedsConfirmation,tripPointsPerPerson,longTripWarning}
 from '../src/trip-reward-confirmation.mjs'

test('travel rewards include start and end dates and do not cap earned points',()=>{
 assert.equal(tripDurationDays('2026-11-01','2026-11-01'),1)
 assert.equal(tripDurationDays('2026-11-01','2026-11-30'),30)
 assert.equal(tripDurationDays('2026-11-01','2026-12-01'),31)
 assert.equal(tripDurationDays('2025-01-01','2025-12-31'),365)
 assert.equal(tripDurationDays('2024-02-28','2024-03-01'),3)
 assert.equal(tripDurationDays('2026-12-31','2026-01-01'),0)
 assert.equal(tripDurationDays('bad','2026-01-01'),0)
 assert.equal(tripPointsPerPerson(31),310)
 assert.equal(tripPointsPerPerson(365),3650)
})
test('a second confirmation appears only for trips over 30 days',()=>{
 assert.equal(longTripNeedsConfirmation(1),false)
 assert.equal(longTripNeedsConfirmation(30),false)
 assert.equal(longTripNeedsConfirmation(31),true)
 assert.equal(longTripNeedsConfirmation(365),true)
 assert.match(longTripWarning(31),/31 天/)
 assert.match(longTripWarning(31),/310 积分/)
 assert.match(longTripWarning(31),/再次检查旅行日期/)
})
test('both completion paths guard long trips and pass acknowledgement to API',()=>{
 const list=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const editor=readFileSync(new URL('../src/components/LifeItemEditor.vue',import.meta.url),'utf8')
 const server=readFileSync(new URL('../worker/trips.js',import.meta.url),'utf8')
 for(const file of [list,editor]){
  assert.match(file,/longTripNeedsConfirmation\(days\)/)
  assert.match(file,/confirm\(longTripWarning\(days\)\)/)
  assert.match(file,/longTripConfirmed:true/)
 }
 assert.match(server,/trip\.status!=='completed'/)
 assert.match(server,/days>30&&b\.longTripConfirmed!==true/)
 assert.match(server,/trip_long_confirmation_required/)
})
