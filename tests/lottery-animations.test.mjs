import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const board=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const visual=readFileSync(new URL('../src/components/LotteryCelebration.vue',import.meta.url),'utf8')

test('full-screen lottery animation is shown only for a successful draw and lasts three seconds',()=>{
 assert.match(board,/const LOTTERY_RESULT_DURATION_MS=3000/)
 assert.match(board,/const result=await fetchJSON\('\/lottery\/draw','POST',\{requestId\}\)/)
 assert.match(board,/showLotteryResult\(result\.draw\)/)
 assert.match(board,/setTimeout\(\(\)=>\{lotteryLastDraw\.value=null;lotteryResultTimer=null\}/)
 assert.match(board,/clearTimeout\(lotteryResultTimer\)/)
 assert.match(board,/<LotteryCelebration :draw="lotteryLastDraw"\/>/)
 assert.doesNotMatch(board,/<div v-if="lotteryLastDraw" class="lottery-result"/)
})

test('lottery celebrates all six outcomes with distinct effects including a spectacular top 1% double',()=>{
 for(const kind of ['empty','five','ten','twenty','fifty','double'])
  assert.ok(visual.includes("case '"+kind+"'"),kind+' has result copy')
 assert.match(visual,/props\.draw\?\.kind==='double'\?'jackpot'/)
 assert.match(visual,/props\.draw\?\.kind==='fifty'\|\|props\.draw\?\.kind==='twenty'\?'rare'/)
 assert.match(visual,/mode==='jackpot'\?60:mode==='rare'\?44:32/)
 assert.match(visual,/lottery-fx--empty/)
 assert.match(visual,/lottery-fx--jackpot/)
 assert.match(visual,/@keyframes lottery-fx-loser/)
 assert.match(visual,/@keyframes lottery-fx-fall/)
 assert.match(visual,/@keyframes lottery-fx-rich/)
 assert.match(visual,/@keyframes lottery-fx-halo/)
 assert.match(visual,/class="lottery-fx-confetti"/)
 assert.match(visual,/class="lottery-fx-rain"/)
})

test('visual overlay supports small-screen and reduced-motion users without blocking controls',()=>{
 assert.match(visual,/<Teleport to="body">/)
 assert.match(visual,/position:fixed;inset:0;z-index:13000/)
 assert.match(visual,/pointer-events:none/)
 assert.match(visual,/safe-area-inset-top/)
 assert.match(visual,/prefers-reduced-motion:reduce/)
 assert.match(visual,/role="status" aria-live="polite"/)
 assert.match(board,/lottery-box--rolling/)
 assert.match(board,/if\(props\.active&&expanded\.value&&view\.value==='lottery'&&props\.userId===drawingUser\)/)
 assert.match(board,/function closeDetails\(\)\{\n clearLotteryResult\(\)/)
 assert.match(board,/onBeforeUnmount\(\(\)=>\{[\s\S]*?clearLotteryResult\(\)/)
})
