import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')

test('lottery tab keeps the draw card and rules, while all draw history moves to points ledger',()=>{
 assert.match(source,/class="lottery-card"/)
 assert.match(source,/class="lottery-box"/)
 assert.match(source,/查看奖池概率与规则/)
 assert.doesNotMatch(source,/近一年抽奖明细/)
 assert.doesNotMatch(source,/<li v-for="record in lottery\.history"/)
 assert.doesNotMatch(source,/goToLotteryPage|lotteryPageBusy|lotteryPageError/)
})

test('points ledger provides independent year, household member and category selectors',()=>{
 assert.match(source,/const historyCategory=ref\('all'\)/)
 assert.match(source,/category='\+encodeURIComponent\(historyCategory\.value\)/)
 for(const [value,label] of [
  ['all','全部'],['task','任务'],['shopping','购物'],['lottery','抽奖'],
  ['shop','商城'],['achievement','挑战成就'],['saving','储值旅行']
 ]){
  assert.ok(source.includes('<option value="'+value+'">'+label+'</option>'),label)
 }
 assert.match(source,/const historyMatchesFilters=computed/)
 assert.match(source,/v-for="\(entry,i\) in visibleHistoryEntries"/)
 assert.match(source,/historyMatchesFilters&&history&&history\.totalPages>1/)
 assert.match(source,/共 \{\{ history\?\.total \}\} 条 · 每页5条/)
})

test('lottery draws show timestamp, draw cost, prize and net points in one row',()=>{
 assert.match(source,/const historyTime=/)
 assert.match(source,/second:'2-digit'/)
 assert.match(source,/entry\.prizeKind/)
 assert.match(source,/entry\.ticketCost/)
 assert.match(source,/entry\.prizePoints/)
 assert.match(source,/signedPoints\(entry\.amount\)/)
 assert.match(source,/净变化/)
 assert.match(source,/categoryNames\[entry\.category\]/)
 assert.match(source,/historyMemberName\(entry\.userId\)/)
 assert.doesNotMatch(source,/class="lottery-history-list"/)
})
