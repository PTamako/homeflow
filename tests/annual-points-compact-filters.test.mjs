import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const src=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const section=src.slice(src.indexOf('<template v-if="view===\'history\'">'),src.indexOf('<div class="annual-ledger">'))
const filter=section.slice(section.indexOf('<div class="annual-filters"'))

test('phone shows year, month and more-filters trigger on a single compact row',()=>{
 const header=filter.slice(0,filter.indexOf('</div>'))
 assert.deepEqual([...header.matchAll(/<label>([^\n]+)/g)].map(m=>m[1]),['年份','月份'])
 assert.equal((header.match(/<select /g)||[]).length,2)
 assert.match(header,/class="annual-extra-trigger"/)
 assert.match(header,/@click="openHistoryFilters"/)
 assert.match(src,/\.annual-filters\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,\.85fr\) minmax\(0,1\.3fr\);gap:8px;align-items:end\}/)
 assert.match(src,/\.annual-filters select\{display:block;box-sizing:border-box;width:100%;min-width:0;max-width:100%/)
 assert.match(src,/@media\(max-width:360px\)\{\.annual-filters\{gap:5px\}/)
})

test('separate year picker and month picker permit any available year and full-year choice',()=>{
 assert.match(section,/:value="historyYear" aria-label="积分历史年份"/)
 assert.match(section,/<option v-for="year in availableYears"/)
 assert.match(section,/:value="historyMonth" aria-label="积分历史月份"/)
 assert.match(section,/<option value="">全年<\/option>/)
 assert.match(section,/<option v-for="month in historyMonths"/)
 assert.match(src,/const historyMonths=Array\.from\(\{length:12\}/)
 assert.doesNotMatch(src,/:value="historyPeriod"/)
 assert.doesNotMatch(src,/function chooseHistoryPeriod/)
})

test('member and category live together in bottom sheet with staged changes',()=>{
 assert.match(section,/<EditBottomSheet v-if="historyFilterOpen" title="筛选积分明细"/)
 assert.match(section,/v-model="draftHistoryMember"/)
 assert.match(section,/v-model="draftHistoryCategory"/)
 assert.match(section,/<option value="">全部成员<\/option>/)
 assert.match(section,/<option value="all">全部分类<\/option>/)
 assert.match(section,/@click="resetHistoryFilterDraft"/)
 assert.match(section,/@submit\.prevent="applyHistoryFilters"/)
 assert.match(src,/draftHistoryMember\.value=historyMember\.value/)
 assert.match(src,/draftHistoryCategory\.value=historyCategory\.value/)
 assert.match(src,/void goToHistory\(1,historyYear\.value,draftHistoryMember\.value,draftHistoryCategory\.value\)/)
 assert.match(src,/const historyMoreCount=computed\(\(\)=>Number\(!!historyMember\.value\)\+Number\(historyCategory\.value!=='all'\)\)/)
 assert.match(section,/:class="\{selected:historyMoreCount>0\}"/)
})

test('server pagination, totals and existing category/member combinations are preserved',()=>{
 assert.match(src,/historyPage\.value=page;historyYear\.value=year;historyMember\.value=member/)
 assert.match(src,/historyCategory\.value=category;historyMonth\.value=month/)
 assert.match(src,/history\.value\.monthFilter===historyMonth\.value/)
 assert.match(src,/const historyPath=\(\)=>'\/points\/history\?year='\+historyYear\.value\+/)
 assert.match(src,/'&month='\+encodeURIComponent\(historyMonth\.value\)/)
 assert.match(section,/@change="goToHistory\(1,Number\(\(\$event\.target as HTMLSelectElement\)\.value\)\)"/)
 assert.match(section,/@change="goToHistory\(1,historyYear,historyMember,historyCategory,\(\$event\.target as HTMLSelectElement\)\.value\)"/)
})

test('year and month controls appear below annual member cards and expiration note, above the ledger',()=>{
 const heading=section.indexOf('<b>年度积分明细</b>')
 const cards=section.indexOf('class="annual-members"')
 const note=section.indexOf('class="annual-note"')
 const filters=section.indexOf('class="annual-filters"')
 assert.ok(heading>=0&&cards>heading&&note>cards&&filters>note,
  'summary cards and annual expiry note must precede the filter controls')
 assert.ok(src.indexOf('<div class="annual-ledger">')>src.indexOf('class="annual-filters"'),
  'filters belong immediately above the transaction ledger')
 assert.equal((section.match(/class="annual-filters"/g)||[]).length,1)
 assert.doesNotMatch(section.slice(section.indexOf('<div class="annual-history-head">'),
   section.indexOf('</div>',section.indexOf('<div class="annual-history-head">'))),/annual-filters/)
})
