import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const css=read('src/ui-system.css')
const main=read('src/main.ts')
const swipe=read('src/components/SwipeActions.vue')
const life=read('src/components/LifePanel.vue')
const app=read('src/App.vue')

test('mobile-first UI layer is loaded after legacy component styles',()=>{
 assert.match(main,/import '\.\/style\.css'\s*import '\.\/ui-system\.css'/)
 assert.match(css,/--ui-touch:44px/)
 for(const token of ['--ui-brand','--ui-card','--ui-line','--ui-field','--ui-radius','--ui-shadow'])
   assert.ok(css.includes(token+':'),token)
 assert.match(css,/\.shell \.life-grid\{grid-template-columns:minmax\(0,1fr\)/)
 assert.match(css,/@media\(min-width:721px\)/)
 assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/)
})

test('every form uses bounded touch-safe fields without forcing horizontal overflow',()=>{
 for(const control of ['.plan-fields','.detail-editor','.life-form','.pet-form','.task-form',
  '.profile-form','.family-message-form','.once-task-editor','.task-push-form',
  '.fields','.shopping-ledger','.search-panel']){
   assert.ok(css.includes(control),control)
 }
 assert.match(css,/min-inline-size:0/)
 assert.match(css,/max-inline-size:100%/)
 assert.match(css,/min-block-size:var\(--ui-touch\)/)
 assert.match(css,/font-size:16px/)
 assert.match(css,/\.shell :is\(\.day-option,\.monthly-week-option/)
 assert.match(css,/\.shell button\{min-height:var\(--ui-touch\)\}/)
 assert.match(css,/:focus-visible/)
 assert.match(css,/--ui-field/)
})

test('mobile lists and buttons use shared semantic hierarchy, never extra edit/delete in More',()=>{
 for(const kind of ['.life-row','.task-row','.notice-item','.reminder-item','.ledger-entry','.trash-item'])
   assert.ok(css.includes(kind),kind)
 for(const kind of ['.routine-inline-actions','.routine-more-trigger','.life-link',
   '.creator-save','.editor-save','.creator-cancel','.editor-cancel',
   '.today-category-tabs','.plan-filter-tabs','.notice-tabs','.task-list-pager'])
   assert.ok(css.includes(kind),kind)
 assert.match(css,/\.shell \.routine-more-trigger\{[\s\S]*?width:44px;height:44px/)
 assert.match(css,/\.shell \.routine-inline-actions\{[\s\S]*?border:1px solid var\(--ui-line\)/)
 assert.match(life,/activeSwipeId\.value=''/)
 assert.match(life,/@keydown\.esc\.stop="expandedTaskMenu=null"/)
 for(const menu of life.matchAll(/class="routine-inline-actions[^"]*" role="group"[\s\S]*?<\/div>/g)){
  assert.doesNotMatch(menu[0],/>编辑<\/button>|>删除<\/button>/)
 }
})

test('swipe controls have 44px affordance and accessible keyboard focus',()=>{
 assert.match(swipe,/actionWidth=computed\(\(\)=>count\.value\*72\)/)
 assert.match(swipe,/paddingRight:showTrigger\?'44px':'0px'/)
 assert.match(swipe,/height:44px;width:44px/)
 assert.match(swipe,/min-width:72px;max-width:72px/)
 assert.match(swipe,/ref="firstAction"/)
 assert.match(swipe,/ref="deleteAction"/)
 assert.match(swipe,/ref="triggerRef"/)
 assert.match(swipe,/nextTick\(\(\)=>\(firstAction\.value\|\|deleteAction\.value\)\?\.focus\(\)\)/)
 assert.match(swipe,/@keydown\.esc\.stop="closeFromKeyboard"/)
 assert.match(swipe,/touch-action:pan-y/)
 assert.match(swipe,/\.swipe-actions\{[\s\S]*?visibility:hidden/)
 assert.match(swipe,/class="stripe-edit"/)
 assert.match(swipe,/class="stripe-delete"/)
})

test('mobile search behaves as a bounded sheet and daily page retains one swipe-per-task',()=>{
 assert.match(css,/\.shell \.search-panel\{\s*position:fixed/)
 assert.match(css,/max-height:calc\(100dvh - env\(safe-area-inset-top\) - 100px\)/)
 assert.match(css,/\.shell \.nav\{/)
 assert.match(app,/scope="today-unified"/)
 assert.match(life,/scope="shopping"/)
 assert.match(life,/scope="routines"/)
 assert.match(life,/scope="wishes"/)
 assert.match(life,/scope="goals"/)
 assert.match(life,/scope="trips"/)
})
