import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('plan tabs fetch only selected category plus dependent goals for wishes',()=>{
  assert.match(source,/if\(type==='routine'\)return \['routines','tasks'\]/)
  assert.match(source,/if\(type==='wish'\)return \['wishes','goals'\]/)
  assert.match(source,/if\(type==='shopping'\)return \['shopping'\]/)
  assert.match(source,/if\(type==='goal'\)return \['goals'\]/)
  assert.match(source,/if\(type==='trip'\)return \['trips'\]/)
  assert.match(source,/const kinds=planRequestKinds\(selected\)/)
  assert.match(source,/@click="selectPlanType\(tab\.id as PlanType\)"/)
  assert.match(source,/const paths=kinds\.map\(kind=>listPath\(kind\)\)/)
  assert.match(source,/const pageLimit=5/)
})

test('All replaces the duplicate task tab without hiding task and routine entries',()=>{
 const filterSection=source.slice(source.indexOf('aria-label="按计划类型筛选"'),
   source.indexOf('class="archive-toolbar"'))
 assert.ok(filterSection.includes("{id:'all',label:'全部'}"))
 assert.ok(!filterSection.includes("{id:'routine',label:'任务'}"))
 assert.ok(filterSection.includes("{id:'unscheduled',label:'待安排'}"))
 assert.match(source,/planType\.value=unscheduled\?'unscheduled':kind==='routine'\?'all':kind/)
 assert.match(source,/if\(type==='task'\|\|type==='routine'\)planType\.value='all'/)
 assert.match(source,/planType==='all'\|\|planType==='routine'\|\|planType==='unscheduled'/)
 assert.match(source,/return \['wishes','goals','shopping','trips','routines','tasks'\]/)
})

test('Today loads only history for visible current goal and wish IDs, never the whole household archive',()=>{
 const source=readFileSync(new URL('../worker/plan-today.js',import.meta.url),'utf8')
 assert.match(source,/const goalIds=\(sourceBatch\[2\]\.results\|\|\[\]\)\.map/)
 assert.match(source,/const wishIds=\(sourceBatch\[1\]\.results\|\|\[\]\)\.map/)
 assert.match(source,/plan_id IN/)
 assert.match(source,/goal_id IN/)
 assert.doesNotMatch(source,/ORDER BY completed_at DESC LIMIT 5000/)
 assert.doesNotMatch(source,/AND status IN \('met','shortfall'\) LIMIT 5000/)
})
