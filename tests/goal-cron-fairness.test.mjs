import test from 'node:test'
import assert from 'node:assert/strict'
import {rotateGoalsForDate} from '../worker/goal-settlements.js'
test('daily settlement work rotates rather than repeatedly starving later goals',()=>{
 const goals=Array.from({length:12},(_,id)=>({id}))
 const firstIds=[]
 for(let d=0;d<12;d++){
  const day=new Date(Date.parse('2026-11-01T00:00:00Z')+d*86400000).toISOString().slice(0,10)
  const order=rotateGoalsForDate(goals,day)
  assert.equal(new Set(order.map(x=>x.id)).size,12)
  firstIds.push(order[0].id)
 }
 assert.equal(new Set(firstIds).size,12)
 assert.deepEqual(rotateGoalsForDate([],'2026-11-01'),[])
})
