import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const start=life.indexOf('<template v-for="g in goals"')
const end=life.indexOf('<p v-if="!goals.length',start)
const row=life.slice(start,end)

test('savings goal uses one full width info column, with finance action in its footer',()=>{
 assert.ok(start>=0&&end>start)
 assert.match(row,/<div class="life-row goal-plan-row">/)
 assert.match(row,/<div class="life-details">/)
 assert.match(row,/<div class="goal-row-footer">/)
 const footer=row.slice(row.indexOf('class="goal-row-footer"'),row.indexOf('</div>',row.indexOf('class="goal-row-footer"')))
 assert.match(row,/<div class="goal-title-row">[\s\S]*?<StatusBadge :code="g\.start_on/)
 assert.doesNotMatch(footer,/<StatusBadge/)
 assert.match(footer,/class="goal-dates"/)
 assert.match(footer,/class="goal-finance-action"/)
 assert.match(footer,/@click="toggleFinance\('goal',g\.id\)"/)
 assert.doesNotMatch(row,/class="life-link" @click="toggleFinance\('goal',g\.id\)"/)
 assert.match(life,/\.goal-plan-row\{display:block!important/)
 assert.match(life,/\.goal-plan-row>\.life-details\{width:100%/)
 assert.match(life,/\.goal-row-footer\{display:flex;align-items:center;justify-content:space-between/)
})

test('wish association stays visually light, full accessibility and per-goal navigation',()=>{
 assert.match(row,/<small class="goal-amount-line">/)
 assert.match(row,/<button v-if="g\.wish_id" type="button" class="goal-wish-link"/)
 assert.match(row,/@click="emit\('openPlans','wish',String\(g\.wish_id\)\)"/)
 assert.match(life,/\.goal-plan-row \.goal-wish-link\{display:inline-flex/)
 assert.match(life,/background:transparent;color:var\(--hf-success-text\)/)
 assert.match(life,/min-height:32px;padding:0 2px/)
 assert.doesNotMatch(row,/<small v-if="g\.wish_id">/)
})

test('savings actions keep mobile-friendly touch targets without large pill buttons',()=>{
 assert.match(life,/\.goal-plan-row \.goal-finance-action\{display:inline-flex/)
 assert.match(life,/min-height:32px;padding:0 2px;border:0;border-radius:7px/)
 assert.match(life,/background:transparent;color:var\(--ui-brand,#357b5c\)/)
 assert.match(life,/@media\(max-width:380px\)/)
 assert.match(row,/:aria-label="'查看“'\+g\.title\+'”的账目与调整额'"/)
 assert.match(row,/<SwipeActions :id="g\.id" scope="goals"/)
 assert.match(row,/@edit="edit\('goals',g\)" @delete="removeItem\('goals',g\)"/)
})


test('goal status footer has compact visual spacing while retaining 44px tappable actions',()=>{
 assert.match(life,/\.goal-plan-row\{display:block!important;[^}]*padding:8px 0 2px!important\}/)
 assert.match(life,/\.goal-row-footer\{[^}]*margin-top:0\}/)
 assert.match(life,/\.goal-plan-row :is\(\.goal-wish-link,\.goal-finance-action\)::before\{[^}]*inset:-6px -3px/)
 assert.match(life,/\.goal-plan-row \.goal-wish-link\{[^}]*min-height:32px/)
 assert.match(life,/\.goal-plan-row \.goal-finance-action\{[^}]*min-height:32px/)
})
