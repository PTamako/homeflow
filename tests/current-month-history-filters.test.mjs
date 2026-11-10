import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {jstMonthWindow,jstYearWindow,pointsHistoryRoute} from '../worker/points-history.js'

test('plan History defaults to the current JST year and month; both selectors stay visible',()=>{
 const src=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(src,/const planYear=ref\(today\(\)\.slice\(0,4\)\),planMonth=ref\(today\(\)\.slice\(5,7\)\)/)
 assert.match(src,/v-if="planScope==='history'" class="archive-date-filters plan-history-date-filters"/)
 assert.match(src,/select v-model="planYear" aria-label="历史记录年份"/)
 assert.match(src,/select v-model="planMonth" :disabled="!planYear" aria-label="历史记录月份"/)
 assert.match(src,/<option value="">全部年份<\/option>/)
 assert.match(src,/<option value="">全年<\/option>/)
 assert.match(src,/watch\(\[planScope,planYear,planMonth,planOutcome\],\(\)=>\{if\(props\.mode==='plans'\)void fetchMode\(\)\}\)/)
})

test('annual point history defaults to JST year/month, retains separate annual total cards',()=>{
 const src=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
 assert.match(src,/const historyMonth=ref\(String\(new Date\(Date\.now\(\)\+9\*3600000\)\.getUTCMonth\(\)\+1\)\.padStart\(2,'0'\)\)/)
 assert.match(src,/history\.value\.monthFilter===historyMonth\.value/)
 assert.match(src,/month='\+encodeURIComponent\(historyMonth\.value\)/)
 assert.match(src,/aria-label="积分历史月份"/)
 assert.match(src,/value="">全年<\/option>/)
})

test('JST month boundaries handle December, January and leap February',()=>{
 assert.deepEqual(jstMonthWindow(2026,11),{
  start:'2026-10-31T15:00:00.000Z',end:'2026-11-30T15:00:00.000Z'})
 assert.deepEqual(jstMonthWindow(2026,12),{
  start:'2026-11-30T15:00:00.000Z',end:'2026-12-31T15:00:00.000Z'})
 assert.deepEqual(jstMonthWindow(2027,1),{
  start:'2026-12-31T15:00:00.000Z',end:'2027-01-31T15:00:00.000Z'})
 assert.deepEqual(jstMonthWindow(2028,2),{
  start:'2028-01-31T15:00:00.000Z',end:'2028-02-29T15:00:00.000Z'})
})

test('yearly point totals stay annual but ledger queries and counts use selected month',async()=>{
 const bindings=[]
 const db={prepare(sql){return {bind(...args){
  bindings.push({sql,args})
  return {all:async()=>({results:[]}),first:async()=>({total:0})}
 }}}}
 const current=new Date(Date.now()+9*3600000).getUTCFullYear()
 const session={household_id:'h',user_id:'u'}
 const request=month=>new Request('https://homeflow.invalid/api/points/history?year='+current+
  '&month='+month+'&page=1')
 const result=await pointsHistoryRoute(request('11'),db,session)
 assert.equal(result.status,200)
 const payload=await result.json()
 assert.equal(payload.monthFilter,'11')
 assert.equal(payload.year,current)
 assert.equal(payload.total,0)
 assert.equal(bindings.length,4)
 const year=jstYearWindow(current),month=jstMonthWindow(current,11)
 assert.deepEqual(bindings.slice(0,2).map(x=>x.args.slice(1,3)),[
  [year.start,year.end],[year.start,year.end]])
 assert.deepEqual(bindings.slice(2).map(x=>x.args.slice(1,3)),[
  [month.start,month.end],[month.start,month.end]])
 const bad=await pointsHistoryRoute(request('13'),db,session)
 assert.equal(bad.status,400)
 const all=await pointsHistoryRoute(request(''),db,session)
 assert.equal((await all.json()).monthFilter,'')
 assert.deepEqual(bindings.slice(6).map(x=>x.args.slice(1,3)),[
  [year.start,year.end],[year.start,year.end]])
})
