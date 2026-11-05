import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const uiFiles=[
 'src/App.vue',
 'src/components/LifePanel.vue',
 'src/components/FinancePanel.vue',
 'src/components/PlanCreator.vue',
 'src/components/ManagePage.vue',
 'src/components/BackupPanel.vue',
 'src/components/ImportantReminders.vue',
 'src/components/PushPanel.vue',
 'src/components/ShoppingLedgerPicker.vue',
 'src/components/ReminderItemEditor.vue',
 'src/components/LifeItemEditor.vue'
]
const ui=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const template=path=>{const source=ui(path),start=source.indexOf('<template>'),end=source.lastIndexOf('</template>');return start>=0&&end>start?source.slice(start,end):''}

test('customer-facing copy stays concise and free of implementation notes',()=>{
 for(const path of uiFiles){
  const text=template(path)
  assert.doesNotMatch(text,/（每次 5 条）/,path)
  assert.doesNotMatch(text,/Cloudflare|Service Binding|VAPID|HOMEFLOW_BOOTSTRAP_SECRET/,path)
  assert.doesNotMatch(text,/从 ChatGPT 导入旅行计划 JSON|按需生成/,path)
 }
})
test('copy simplification keeps material financial and destructive-action warnings',()=>{
 assert.match(template('src/components/FinancePanel.vue'),/不代表实际存款/)
 assert.match(template('src/components/TrashPanel.vue'),/清空后无法恢复/)
 assert.match(template('src/components/BackupPanel.vue'),/恢复不会覆盖原记录/)
 assert.match(template('src/components/OneTimeTaskFields.vue'),/待安排/)
})
test('reminder rows show dates instead of raw identifier fragments',()=>{
 assert.doesNotMatch(template('src/components/ImportantReminders.vue'),/item\.id\.slice\(-8\)/)
})


test('HomeFlow header uses the new brand tagline',()=>{
 const app=template('src/App.vue')
 assert.match(app,/<p class="lead">让爱与生活，自然流转。<\/p>/)
 assert.doesNotMatch(app,/每件重要的小事/)
})
