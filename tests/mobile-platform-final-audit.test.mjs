import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const components=readdirSync(new URL('../src/components/',import.meta.url))
 .filter(file=>file.endsWith('.vue')).map(file=>'src/components/'+file)
const views=['src/App.vue',...components]
const confirm=source('src/components/ConfirmActionSheet.vue')
const modal=source('src/components/EditBottomSheet.vue')
const picker=source('src/components/MobileSelectHost.vue')
const ui=source('src/ui-system.css')

test('every HomeFlow Vue view avoids blocking native confirm/alert/prompt',()=>{
 assert.ok(views.length>=30)
 for(const path of views){
  const code=source(path)
  assert.doesNotMatch(code,/\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/,
   path+' should use a safe touch-first sheet or non-blocking notice')
 }
})

test('all destructive and money actions retain a cancellable and explicit mobile confirmation',()=>{
 const flows=[
  ['src/App.vue',2],
  ['src/components/LifePanel.vue',12],
  ['src/components/LifeItemEditor.vue',2],
  ['src/components/PetHealthPanel.vue',1],
  ['src/components/BackupPanel.vue',1],
  ['src/components/ShoppingLedgerPicker.vue',1],
  ['src/components/HouseholdPoints.vue',9]
 ]
 for(const [path,minCount] of flows){
  const code=source(path)
  assert.ok((code.match(/await confirmAction\(\{/g)||[]).length>=minCount,
   path+' has too few guarded confirmation points')
  assert.match(code,/<ConfirmActionSheet v-if="confirmRequest"/,path)
  assert.match(code,/@confirm="acceptConfirm" @cancel="cancelConfirm"/,path)
 }
 assert.match(confirm,/@close="emit\('cancel'\)"/)
 assert.match(confirm,/@click="emit\('cancel'\)"/)
 assert.match(confirm,/@click="emit\('confirm'\)"/)
 assert.match(confirm,/:class="\{'confirm-action-danger':request.danger\}"/)
})

test('photo deletion confirmation overlays the fullscreen viewer without swallowing toasts',()=>{
 const photo=source('src/components/PhotoViewer.vue')
 assert.match(photo,/.photo-viewer-layer\{[^}]*z-index:11000/)
 assert.match(modal,/props.priority==='confirmation'\?11500:10000/)
 assert.match(confirm,/priority="confirmation"/)
 const toast=source('src/components/PageToast.vue')
 assert.match(toast,/z-index:12000/)
 const life=source('src/components/LifePanel.vue')
 assert.match(life,/title:'永久删除照片',confirmLabel:'永久删除',danger:true/)
 assert.match(life,/if\(!await confirmAction\(\{title:'永久删除照片'/)
 assert.match(life,/await api\('\/media\/'\+selected.id,'DELETE'\)/)
})

test('nested bottom sheets prevent background interaction, restore focus and scroll position',()=>{
 assert.match(modal,/const sheetLayers:Array<\{node:HTMLElement;z:number\}>/m)
 assert.match(modal,/item.node.inert=hidden/)
 assert.match(modal,/item.node.setAttribute\('aria-hidden','true'\)/)
 assert.match(modal,/syncSheetLayers\(\)/)
 assert.match(modal,/layer.value.removeAttribute\('aria-hidden'\)/)
 assert.match(modal,/previousFocus\?\.isConnected/)
 assert.match(modal,/window.scrollTo\(0,savedScrollY\)/)
 assert.match(modal,/:style="\{zIndex:layerZIndex\}"/)
 assert.match(modal,/role="dialog" aria-modal="true"/)
 assert.match(modal,/@keydown="onKeydown"/)
 assert.match(modal,/min-width:44px;min-height:44px/)
})

test('single selects are searchable, keyboard navigable and keep original form semantics',()=>{
 assert.match(picker,/const filtered=computed/)
 assert.match(picker,/role="listbox"/)
 assert.match(picker,/@keydown="navigateOptions"/)
 assert.match(picker,/ArrowDown/)
 assert.match(picker,/ArrowUp/)
 assert.match(picker,/Home/)
 assert.match(picker,/End/)
 assert.match(picker,/selected\?\.scrollIntoView\(\{block:'nearest'\}\)/)
 assert.match(picker,/select.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/)
 assert.match(picker,/!select.multiple/)
 assert.match(picker,/!select.hasAttribute\('data-native-select'\)/)
 const nativeDate=source('src/components/DateField.vue')
 assert.match(nativeDate,/type="date"/)
 assert.match(nativeDate,/aria-label="清空日期"/)
})

test('every touch-width device including iPad landscape receives 44px buttons and safe-area forms',()=>{
 assert.match(ui,/@media\(pointer:coarse\)/)
 assert.doesNotMatch(ui,/@media\(pointer:coarse\) and \(max-width:1100px\)/)
 assert.match(ui,/\.shell button\{min-height:44px\}/)
 assert.match(modal,/@media\(pointer:coarse\)/)
 assert.match(modal,/font-size:16px;min-height:44px/)
 const life=source('src/components/LifePanel.vue')
 assert.match(life,/.memory-add-photo\{[^}]*width:44px;height:44px/s)
 assert.match(life,/.trip-detail-close\{[^}]*width:44px;height:44px/s)
 assert.match(life,/.shopping-handler-row .shopping-row-actions .life-link\{min-height:44px;/)
 const points=source('src/components/HouseholdPoints.vue')
 assert.match(points,/.annual-pagination button\{min-height:44px;/)
 assert.match(points,/.reward-buy\{[^}]*min-height:44px/)
 assert.match(source('src/components/BackupPanel.vue'),/.backup-help-trigger\{[^}]*width:44px;height:44px;/)
})
