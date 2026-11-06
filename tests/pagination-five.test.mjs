import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {listFilters} from '../worker/list-pagination.js'

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('paginated API defaults to five while retaining explicit page overrides',()=>{
  const defaultPage=listFilters('https://homeflow.invalid/api/routines?scope=active')
  assert.equal(defaultPage.limit,5)
  assert.equal(listFilters('https://homeflow.invalid/api/routines?limit=5&scope=active').limit,5)
  assert.equal(listFilters('https://homeflow.invalid/api/routines?limit=10&scope=active').limit,10)
  assert.equal(listFilters('https://homeflow.invalid/api/routines?limit=0').invalid,true)
})

test('primary paginated HomeFlow lists display five rows initially',()=>{
  const app=source('src/App.vue')
  const life=source('src/components/LifePanel.vue')
  const pet=source('src/components/PetHealthPanel.vue')
  const important=source('src/components/ImportantReminders.vue')
  const finance=source('src/components/FinancePanel.vue')
  const bridge=source('worker/finance.js')
  assert.match(app,/const listPageSize=5/)
  assert.match(app,/visibleToday=computed\(\(\)=>unifiedToday\.value\)/)
   assert.match(app,/new URLSearchParams\(\{date,category,limit:String\(listPageSize\)\}\)/)
  assert.match(app,/people\.value\.slice\(0,peopleVisibleCount\.value\)/)
  assert.match(app,/pets\.value\.slice\(0,petsVisibleCount\.value\)/)
  assert.match(life,/const pageLimit=5/)
  assert.match(life,/anniversaryVisibleCount\+=pageLimit/)
  assert.match(life,/todayAnniversaryVisibleCount\+=pageLimit/)
  assert.match(pet,/limit:'5'/)
  assert.match(important,/const pageSize=5,visibleCount=ref\(pageSize\)/)
  assert.match(finance,/const linkedPageSize=5/)
  assert.match(bridge,/ledger\(env,\{start,end,limit:5,cursor\}\)/)
})
