import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const rule=selector=>{
  const escaped=selector.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&')
  const match=source.match(new RegExp(escaped+'\\s*\\{([^}]*)\\}'))
  assert.ok(match,'Missing CSS rule '+selector)
  return match[1]
}

test('lottery history rows are fixed-height compact items, independent of prize result',()=>{
 const board=rule('.points-board')
 const expanded=rule('.points-expanded')
 const history=rule('.lottery-history')
 const list=rule('.lottery-history-list')
 const row=rule('.lottery-history-row')
 const detail=rule('.lottery-history-detail')
 const result=rule('.lottery-history-row>span')
 assert.ok(board.includes('align-content:start'))
 assert.ok(expanded.includes('align-content:start'))
 assert.ok(history.includes('display:block'))
 assert.ok(history.includes('align-self:start'))
 assert.ok(list.includes('display:flex'))
 assert.ok(list.includes('flex-direction:column'))
 assert.ok(list.includes('gap:0'))
 assert.ok(row.includes('display:flex'))
 assert.ok(!row.includes('display:grid'))
 assert.ok(row.includes('height:54px'))
 assert.ok(row.includes('min-height:54px'))
 assert.ok(row.includes('max-height:54px'))
 assert.ok(row.includes('margin:0'))
 assert.ok(detail.includes('flex:1 1 auto'))
 assert.ok(result.includes('white-space:nowrap'))
 assert.ok(result.includes('text-overflow:ellipsis'))
 assert.ok(source.includes('<ul v-else class="lottery-history-list"'))
 assert.ok(source.includes('<li v-for="record in lottery.history"'))
 assert.ok(source.includes('class="lottery-history-row"'))
})

test('lottery history uses five-item server pages and mobile previous/next controls',()=>{
 assert.match(source,/const lotteryPage=ref\(1\)/)
 assert.match(source,/fetchJSON\('\/lottery\?page='\+page\)/)
 assert.match(source,/lottery\.historyTotalPages>1/)
 assert.match(source,/@click="goToLotteryPage\(lotteryPage-1\)"/)
 assert.match(source,/@click="goToLotteryPage\(lotteryPage\+1\)"/)
 assert.match(source,/每页 5 条/)
 assert.match(source,/lotteryPage<=1\|\|lotteryPageBusy\|\|busy/)
 assert.match(source,/lotteryPage>=lottery\.historyTotalPages\|\|lotteryPageBusy\|\|busy/)
 assert.match(source,/resetLotteryPagination\(\)/)
 assert.match(source,/lotteryPageError/)
})
