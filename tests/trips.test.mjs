import assert from 'node:assert/strict'
import test from 'node:test'
import {validatedTripPayload} from '../worker/trips.js'
function payload(){
  return {format:'homeflow.trip',schemaVersion:1,importSourceId:'example-trip',
    trip:{externalId:'trip-1',title:'旅行',destination:'上海',startDate:'2026-12-20',endDate:'2026-12-26',
      timeZone:'Asia/Shanghai',participants:['adult-a'],currency:'JPY',
      budget:{amount:200000,currency:'JPY',status:'estimate'},
      days:[{date:'2026-12-20',items:[{externalId:'d1-arrival',title:'酒店入住',startTime:null,endTime:null,
        category:'lodging',bookingStatus:'not_booked',place:{name:'酒店'},verification:{status:'unverified'}}]}],
      tasks:[{externalId:'task-docs',title:'护照',dueDate:null,assignee:'adult-a',visibility:'private'}]}}
}
test('valid ChatGPT HomeFlow Trip v1 passes import validation',()=>{
  assert.equal(validatedTripPayload(payload()),null)
})
test('invalid or duplicate itinerary items rejected',()=>{
  const v=payload()
  v.trip.days[0].items.push({...v.trip.days[0].items[0]})
  assert.equal(validatedTripPayload(v),'invalid_itinerary')
})
test('out-of-range dates and money rejected',()=>{
  const v=payload()
  v.trip.days[0].date='2026-12-27'
  assert.equal(validatedTripPayload(v),'invalid_day')
  const z=payload()
  z.trip.budget.amount=-1000
  assert.equal(validatedTripPayload(z),'invalid_trip')
})
test('unknown schema versions rejected',()=>{
  const v=payload();v.schemaVersion=2
  assert.equal(validatedTripPayload(v),'invalid_header')
})
