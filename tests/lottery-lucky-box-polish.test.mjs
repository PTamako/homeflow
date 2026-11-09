import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const panel=source.slice(source.indexOf('<template>'),source.lastIndexOf('</template>'))
const box=panel.slice(panel.indexOf('class="lottery-box"'),panel.indexOf('class="lottery-panel"'))
const css=source.slice(source.indexOf('.lottery-box{'),source.indexOf('.lottery-panel{'))

test('lucky box is a richly detailed mint-and-gold 3D chest instead of the old flat gift glyph',()=>{
 assert.match(box,/class="lottery-chest"/)
 for(const part of ['lottery-chest-top','lottery-chest-front','lottery-chest-bow--left',
  'lottery-chest-bow--right','lottery-chest-slot','lottery-chest-ribbon','lottery-chest-seal'])
  assert.ok(box.includes(part),part)
 assert.doesNotMatch(box,/<AppIcon name="gift"/)
 assert.match(box,/class="lottery-box-label">好运箱/)
 assert.match(box,/class="lottery-box-subtitle">试试今天的好运/)
 assert.match(css,/linear-gradient\(145deg,#f4fff8/)
 assert.match(css,/lottery-chest-ribbon/)
 assert.match(css,/lottery-box-label\{[\s\S]*?border:1px solid #deb86d/)
})

test('box idles with restrained glow and four twinkling stars, then visibly shakes when drawing',()=>{
 assert.equal((box.match(/lottery-box-spark--(one|two|three|four)/g)||[]).length,4)
 assert.match(box,/:class="\{'lottery-box--rolling':busy/)
 for(const key of ['lottery-box-breathe','lottery-chest-float','lottery-box-twinkle',
  'lottery-box-shuffle','lottery-chest-roll','lottery-box-glint']){
  assert.ok(css.includes('@keyframes '+key),key+' must have animation')
 }
 assert.match(css,/\.lottery-box--rolling \.lottery-chest\{animation:/)
})

test('jackpot turns the chest gold without affecting drawing logic or the existing three-second overlay',()=>{
 assert.match(box,/'lottery-box--jackpot':lotteryLastDraw\?\.kind==='double'/)
 assert.match(css,/\.lottery-box--jackpot\{[\s\S]*?background:linear-gradient\(140deg,#fff9dc/)
 assert.match(css,/\.lottery-box--jackpot \.lottery-chest\{[\s\S]*?animation:/)
 assert.match(source,/const LOTTERY_RESULT_DURATION_MS=3000/)
 assert.match(source,/<LotteryCelebration :draw="lotteryLastDraw"\/>/)
 assert.match(source,/fetchJSON\('\/lottery\/draw','POST',\{requestId,ticketCouponId\}\)/)
})

test('lucky box remains compact on narrow iPhones and respects reduced-motion preferences',()=>{
 assert.match(css,/@media\(max-width:360px\)/)
 assert.match(css,/\.lottery-box\{flex-basis:96px;height:132px/)
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/)
 assert.match(css,/\.lottery-chest,\.lottery-box--rolling,\.lottery-box--jackpot\{animation:none!important\}/)
 assert.match(css,/\.lottery-box:after\{display:none\}/)
 assert.doesNotMatch(box,/v-on:click|@click/)
})
