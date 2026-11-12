import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const swipe=read('src/components/SwipeActions.vue')
const discovery=read('src/swipe-discovery.ts')
const life=read('src/components/LifePanel.vue')

test('one-time gesture tutorial is scoped across the entire app and persists after a real swipe',()=>{
 assert.match(discovery,/homeflow:swipe-discovery-v1/)
 assert.match(discovery,/swipeHelpOwner=ref\(''\)/)
 assert.match(discovery,/localStorage\.getItem\(key\)/)
 assert.match(discovery,/localStorage\.setItem\(key,'1'\)/)
 assert.match(swipe,/swipeHelpLearned/)
 assert.match(swipe,/claimSwipeHelp\(key\.value\)/)
 assert.match(swipe,/releaseSwipeHelp\(key\.value\)/)
 assert.match(swipe,/acknowledgeSwipeHelp\(\) \/\/ A real first swipe/)
 assert.match(swipe,/向左滑动明细，可以编辑或删除/)
 assert.match(swipe,/@click\.stop="dismissHint"/)
 assert.match(swipe,/v-if="showHint"/)
})

test('no permanent blue/red stripes, but hidden swipe actions retain their original meaning',()=>{
 assert.doesNotMatch(swipe,/swipe-stripes|stripe-edit|stripe-delete/)
 assert.match(swipe,/\.swipe-actions \.edit\{background:#558bc9\}/)
 assert.match(swipe,/\.swipe-actions \.delete\{background:#d76178\}/)
 assert.match(swipe,/props\.scope!=='today-unified'/)
 assert.match(swipe,/props\.showTrigger&&count\.value>0/)
 assert.match(swipe,/name="ellipsis"/)
 assert.match(swipe,/paddingRight:showTriggerUi\?'44px':'0px'/)
 assert.match(swipe,/class="swipe-chevron"/)
 assert.match(swipe,/role="group"/)
 assert.match(swipe,/@keydown\.enter\.self="activateRow"/)
 assert.match(swipe,/@keydown\.esc\.stop="closeFromKeyboard"/)
 assert.match(swipe,/touch-action:pan-y/)
 assert.match(swipe,/\.swipe-actions\{[\s\S]*?visibility:hidden/)
})

test('wishlist and trip rows expose only real contextual extras in More, not duplicate swipe actions',()=>{
 for(const [kind,group] of [['wish','wish'],['trip','trip']]){
  assert.ok(life.includes("expandedTaskMenu==='"+kind+":'"),kind)
  assert.ok(life.includes("toggleTaskMenu('"+kind+":'"),kind)
  assert.ok(life.includes("'"+kind+"-actions-'"),kind)
 }
 const wishMenu=life.slice(life.indexOf('class="routine-inline-actions plan-action-strip"'),life.indexOf('<form v-if="planMemoryDraft?.kind===\'wish\''))
 const tripMenu=life.slice(life.indexOf(':id="\'trip-actions-\'+t.id"'),life.indexOf('<form v-if="planMemoryDraft?.kind===\'trip\''))
 assert.match(wishMenu,/查看关联储值/)
 assert.match(wishMenu,/记录心愿回忆/)
 assert.match(tripMenu,/费用与调整额/)
 assert.match(tripMenu,/记录旅行回忆/)
 for(const menu of [wishMenu,tripMenu])assert.doesNotMatch(menu,/>编辑<\/button>|>删除<\/button>/)
 assert.match(life,/activeSwipeId\.value=''/)
})

test('linked wish is shown on the individual savings amount line and navigates by its own id',()=>{
 const goal=life.slice(life.indexOf('<template v-for="g in goals"'),life.indexOf('<p v-if="!goals.length'))
 assert.match(goal,/<small class="goal-amount-line">/)
 assert.match(goal,/<button v-if="g\.wish_id" type="button" class="goal-wish-link"/)
 assert.match(goal,/@click="emit\('openPlans','wish',String\(g\.wish_id\)\)"/)
 assert.doesNotMatch(goal,/<small v-if="g\.wish_id">/)
})
