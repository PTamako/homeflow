import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const start=life.indexOf('<template v-for="g in goals"')
const end=life.indexOf('<p v-if="!goals.length',start)
const goal=life.slice(start,end)

test('each savings goal places linked wish inside its amount line, not a separate status row',()=>{
 assert.ok(start>0&&end>start)
 assert.match(goal,/<small class="goal-amount-line">/)
 assert.match(goal,/<span v-if="\(g\.goal_mode\|\|'once'\)===/)
 assert.match(goal,/<div class="goal-row-footer">\s*<StatusBadge :code="g\.start_on/)
 assert.match(goal,/<button v-if="g\.wish_id" type="button" class="goal-wish-link"/)
 assert.match(goal,/<AppIcon name="heart" :size="13" \/>已关联心愿/)
 assert.doesNotMatch(goal,/<small v-if="g\.wish_id">/)
})

test('linked wish affordance resolves the exact wish belonging to this goal',()=>{
 assert.match(goal,/:aria-label="'查看“'\+g\.title\+'”关联的心愿计划'"/)
 assert.match(goal,/@click="emit\('openPlans','wish',String\(g\.wish_id\)\)"/)
 assert.match(goal,/<SwipeActions :id="g\.id" scope="goals"/)
 assert.match(goal,/@edit="edit\('goals',g\)" @delete="removeItem\('goals',g\)"/)
})

test('linked wish stays in the amount line with a subtle 44px touch area',()=>{
 assert.match(life,/\.goal-amount-line\{display:flex!important;align-items:center;flex-wrap:wrap/)
 assert.match(life,/\.goal-plan-row \.goal-wish-link\{display:inline-flex;align-items:center/)
 assert.match(life,/background:transparent;color:var\(--hf-success-text\)/)
 assert.match(life,/min-height:44px;padding:0 2px/)
 assert.match(goal,/<small class="goal-amount-line">/)
})
