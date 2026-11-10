import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const points=read('src/components/HouseholdPoints.vue')
const app=read('src/App.vue')
const sheet=read('src/components/EditBottomSheet.vue')
const prompt=read('src/components/ConfirmActionSheet.vue')
const hook=read('src/use-confirm-action.ts')

test('mobile confirmation sheet is dismissible and never confirms on backdrop',()=>{
 assert.match(prompt,/<EditBottomSheet :title="request.title" @close="emit\('cancel'\)" priority="confirmation"/)
 assert.match(prompt,/:class="\{'confirm-action-danger':request.danger\}"/)
 assert.match(prompt,/@click="emit\('cancel'\)"/)
 assert.match(prompt,/@click="emit\('confirm'\)"/)
 assert.match(prompt,/:role=|confirm-action-message/)
 assert.match(prompt,/white-space:pre-line/)
 assert.match(prompt,/min-height:48px/)
 assert.match(prompt,/env\(safe-area-inset-bottom\)/)
 assert.match(hook,/if\(resolvePending\)return Promise\.resolve\(false\)/)
 assert.match(hook,/onScopeDispose\(\(\)=>settle\(false\)\)/)
 assert.match(hook,/done\?\.\(confirmed\)/)
})

test('points shop replaces all nine blocking browser confirmations, keeping business actions intact',()=>{
 assert.doesNotMatch(points,/window\.confirm\(|window\.alert\(/)
 assert.equal((points.match(/await confirmAction\(\{/g)||[]).length,9)
 assert.match(points,/<ConfirmActionSheet v-if="confirmRequest"/)
 assert.match(points,/@confirm="acceptConfirm" @cancel="cancelConfirm"/)
 assert.match(points,/await refresh\(\);notify\(success\)/)
 assert.match(points,/<PageToast :toast="toast"\/>/)
 for(const endpoint of [
  '/lottery/coupons/redeem-wish','/rewards/redeem',
  '/rewards/pool','/rewards/pool/','/rewards/redemptions/'
 ])assert.ok(points.includes(endpoint),endpoint)
 assert.match(points,/danger:item.active/)
 assert.match(points,/danger:true/)
 assert.match(points,/if\(!await confirmAction\(/)
})

test('Today skip and version refresh also use mobile confirmations',()=>{
 assert.doesNotMatch(app,/\bwindow\.confirm\(|\bif\(!confirm\(/)
 assert.match(app,/async function refreshToLatest\(\)/)
 assert.match(app,/title:'刷新到最新版本',confirmLabel:'刷新应用'/)
 assert.match(app,/title:'跳过本期事项',confirmLabel:'确认跳过',danger:true/)
 assert.match(app,/<ConfirmActionSheet v-if="confirmRequest"/)
 assert.match(app,/@confirm="acceptConfirm" @cancel="cancelConfirm"/)
 assert.match(app,/await reloadToday\(\)/)
})

test('nested sheets stack by mount order with one shared body scroll lock',()=>{
 assert.match(sheet,/let activeSheetLocks=0/)
 assert.match(sheet,/let sheetOrder=0/)
 assert.match(sheet,/if\(activeSheetLocks===0\)sheetOrder=0/)
 assert.match(sheet,/layerZIndex\.value=\(props\.priority==='confirmation'\?11500:10000\)\+\(\+\+sheetOrder\)/)
 assert.match(sheet,/syncSheetLayers\(\)/)
 assert.match(sheet,/item\.node\.inert=hidden/)
 assert.match(sheet,/:style="\{zIndex:layerZIndex\}"/)
 assert.match(sheet,/lockSheetScroll\(\)/)
 assert.match(sheet,/unlockSheetScroll\(\)/)
 assert.match(sheet,/if\(activeSheetLocks===0\)\{/)
 assert.match(sheet,/window\.scrollTo\(0,savedScrollY\)/)
 assert.match(sheet,/if\(previousFocus\?\.isConnected\)previousFocus\.focus\(\{preventScroll:true\}\)/)
 assert.match(sheet,/width:44px;height:44px;/)
 assert.match(sheet,/min-width:44px;min-height:44px;/)
})

test('points rule help buttons keep small glyph while giving 44px tappable hitbox',()=>{
 assert.match(points,/\.points-rule-help\{display:inline-flex[^}]*width:44px;height:44px;/)
 assert.match(points,/min-height:44px;max-height:44px/)
 assert.match(points,/\.points-rule-help \.points-help-glyph\{[^}]*width:15px;height:15px;/)
 assert.match(points,/\.lottery-odds-heading\{[^}]*min-height:44px/)
 assert.equal((points.match(/class="points-rule-help"/g)||[]).length,3)
})
