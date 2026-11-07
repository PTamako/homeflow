import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('toast messages are page-owned and always disappear after 3000 ms',()=>{
 const composable=file('src/page-toast.ts')
 const component=file('src/components/PageToast.vue')
 assert.match(composable,/setTimeout\(\(\)=>\{toast\.value=null;timer=null\},3000\)/)
 assert.match(composable,/onScopeDispose\(clear\)/)
 assert.match(composable,/if\(timer!==null\)clearTimeout\(timer\)/)
 assert.match(component,/position:fixed/)
 assert.match(component,/pointer-events:none/)
 assert.match(component,/overflow-wrap:anywhere/)
 assert.match(component,/aria-live/)
})

test('switching pages clears old toasts without a global shared state',()=>{
 const app=file('src/App.vue')
 const life=file('src/components/LifePanel.vue')
 assert.match(app,/watch\(tab,value=>\{\s*clearToast\(\)/)
 assert.match(life,/watch\(\(\)=>props\.mode,clearToast\)/)
 assert.match(app,/<PageToast :toast="toast" \/>/)
 assert.match(life,/<PageToast :toast="toast" \/>/)
 assert.doesNotMatch(life,/<p v-if="notice" class="life-notice"/)
})

test('success notices in finance, health and backup are temporary while errors remain visible',()=>{
 for(const name of ['PetHealthPanel','FinancePanel','PushPanel','BackupPanel']){
  const src=file('src/components/'+name+'.vue')
  assert.match(src,/<PageToast :toast="toast" \/>/)
 }
 const health=file('src/components/PetHealthPanel.vue')
 assert.doesNotMatch(health,/<p v-if="message" class="ok"/)
 assert.match(health,/<p v-if="error" class="error"/)
 const finance=file('src/components/FinancePanel.vue')
 assert.doesNotMatch(finance,/message\.value='已关联/)
})

test('success, warning and error all use centered toast above bottom sheets',()=>{
 const composable=file('src/page-toast.ts')
 const component=file('src/components/PageToast.vue')
 const sheet=file('src/components/EditBottomSheet.vue')
 assert.match(composable,/ToastKind='success'\\|'warning'\\|'error'/)
 assert.match(component,/<Teleport to="body">/)
 assert.match(component,/top:50%;left:50%/)
 const sheetLevel=Number(sheet.match(/z-index:(\\d+);isolation:isolate/)?.[1])
 const toastLevel=Number(component.match(/z-index:(\\d+);top:50%/)?.[1])
 assert.ok(toastLevel>sheetLevel,'center toasts must overlay bottom sheets')
 assert.match(component,/page-toast-error\\{background:/)
 assert.match(component,/toast.kind==='error'\\?'×'/)
 assert.match(component,/aria-live/)
 const life=file('src/components/LifePanel.vue')
 assert.match(life,/notify\\(pushError.value,'error'\\)/)
 assert.match(life,/class="task-push-error"/)
})
