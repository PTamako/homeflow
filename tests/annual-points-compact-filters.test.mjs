import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const src=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')

test('points history displays exactly three filters in one mobile row',()=>{
 const start=src.indexOf('<div class="annual-filters">')
 const end=src.indexOf('</div>',start)
 assert.ok(start>=0&&end>start)
 const fields=src.slice(start,end)
 assert.deepEqual([...fields.matchAll(/<label>([^\n]+)/g)].map(m=>m[1]),['年月','成员','分类'])
 assert.equal((fields.match(/<select /g)||[]).length,3)
 assert.match(src,/\.annual-filters\{display:grid;grid-template-columns:minmax\(0,1\.45fr\) repeat\(2,minmax\(0,1fr\)\);gap:7px;align-items:end\}/)
 assert.match(src,/\.annual-filters select\{display:block;box-sizing:border-box;width:100%;min-width:0;max-width:100%/)
 assert.match(src,/@media\(max-width:360px\)\{\.annual-filters\{gap:5px\}/)
})

test('single period selector supports monthly and full-year choices across all years',()=>{
 const start=src.indexOf('<div class="annual-filters">')
 const end=src.indexOf('</div>',start)
 const fields=src.slice(start,end)
 assert.match(fields,/:value="historyPeriod"/)
 assert.match(fields,/aria-label="积分历史年月"/)
 assert.match(fields,/<optgroup v-for="year in availableYears"/)
 assert.match(fields,/<option :value="year\+'-all'">/)
 assert.match(fields,/<option v-for="month in historyMonths"/)
 assert.match(fields,/:value="year\+'-'\+month"/)
 assert.match(src,/const historyPeriod=computed\(\(\)=>historyYear\.value\+'-'\+\(historyMonth\.value\|\|'all'\)\)/)
 assert.match(src,/const historyMonths=Array\.from\(\{length:12\}/)
 assert.match(src,/function chooseHistoryPeriod\(period:string\)/)
 assert.match(src,/void goToHistory\(1,Number\(matched\[1\]\),historyMember\.value,historyCategory\.value,/)
 assert.match(src,/matched\[2\]==='all'\?'':matched\[2\]/)
})

test('date filter retains server-side pagination and independent member/category filters',()=>{
 assert.match(src,/historyPage\.value=page;historyYear\.value=year;historyMember\.value=member/)
 assert.match(src,/historyCategory\.value=category;historyMonth\.value=month/)
 assert.match(src,/history\.value\.monthFilter===historyMonth\.value/)
 assert.match(src,/const historyPath=\(\)=>'\/points\/history\?year='\+historyYear\.value\+/)
 assert.match(src,/'&month='\+encodeURIComponent\(historyMonth\.value\)/)
 assert.match(src,/@change="goToHistory\(1,historyYear,\(\$event\.target as HTMLSelectElement\)\.value\)"/)
 assert.match(src,/@change="goToHistory\(1,historyYear,historyMember,\(\$event\.target as HTMLSelectElement\)\.value\)"/)
})
