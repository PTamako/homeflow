import test from 'node:test'
import assert from 'node:assert/strict'
import {listFilters,monthWindow} from '../worker/list-pagination.js'
import {readFileSync} from 'node:fs'

test('paging controls validate scopes, bounded limit, year-month and opaque cursor',()=>{
 assert.equal(listFilters('https://x.test/api/memories'),null)
 assert.equal(listFilters('https://x.test/api/memories?limit=6').limit,6)
 assert.equal(listFilters('https://x.test/api/memories?limit=0').invalid,true)
 assert.equal(listFilters('https://x.test/api/memories?limit=31').invalid,true)
 assert.equal(listFilters('https://x.test/api/memories?month=09').invalid,true)
 assert.equal(listFilters('https://x.test/api/memories?scope=unknown').invalid,true)
 assert.deepEqual(monthWindow('2026','12'),{start:'2026-12-01',end:'2027-01-01'})
 assert.deepEqual(monthWindow('2026',''),{start:'2026-01-01',end:'2027-01-01'})
 const uuid='00000000-0000-4000-8000-000000000001'
 const value=encodeURIComponent('2026-11-04|'+uuid)
 assert.deepEqual(listFilters('https://x.test/?limit=5&cursor='+value).cursor,
   {date:'2026-11-04',id:uuid})
})
test('timeline and family archive controls are accessible and paginated',()=>{
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const pet=readFileSync(new URL('../src/components/PetHealthPanel.vue',import.meta.url),'utf8')
 assert.ok(life.includes('计划记录筛选'))
 assert.ok(life.includes('纪念日历史年份'))
 assert.ok(life.includes("loadMore('anniversaries')"))
 assert.ok(life.includes('回忆年份'))
 assert.ok(life.includes('loadMore('))
 assert.ok(life.includes('listCursors.memories'))
 assert.ok(life.includes("upcomingAnniversaries"))
 assert.ok(pet.includes('宠物护理记录年份'))
 assert.ok(pet.includes('nextCursor'))
 assert.ok(pet.includes('加载更多护理记录'))
})
