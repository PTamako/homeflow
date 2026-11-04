import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
const pet=readFileSync(new URL('../src/components/PetHealthPanel.vue',import.meta.url),'utf8')
const finance=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const icons=readFileSync(new URL('../src/components/AppIcon.vue',import.meta.url),'utf8')

test('mobile bottom navigation has four consistent vector tabs',()=>{
  const nav=app.match(/const nav=\[([^\n]*)\] as const/)
  assert.ok(nav,'navigation config should exist')
  const ids=[...nav[1].matchAll(/id:'([^']+)'/g)].map(x=>x[1])
  assert.deepEqual(ids,['today','plans','memories','family'])
  const iconNames=[...nav[1].matchAll(/icon:'([^']+)'/g)].map(x=>x[1])
  assert.deepEqual(iconNames,['sun','clipboard-check','images','house'])
  assert.ok(!app.includes("tab==='cat'"))
  assert.ok(app.includes('<AppIcon :name="n.icon"'))
  assert.match(icons,/<svg /)
})
test('pet health is accessible from an expandable pet card under family',()=>{
  assert.ok(app.includes('宠物档案'))
  assert.ok(app.includes("openPetId===p.id"))
  assert.ok(app.includes('aria-expanded="openPetId===p.id"'))
  const familyBlock=app.slice(app.indexOf('v-else-if="tab===\'family\'"'),app.indexOf('<section v-else class="hero">'))
  assert.ok(familyBlock.includes('<PetHealthPanel'))
  assert.ok(familyBlock.includes('v-if="openPetId===p.id"'))
})
test('native mobile date fields and every main form constrain intrinsic width',()=>{
  for(const selector of ['.task-form,.profile-form','.profile-form input','.profile-form select','input[type="date"]',
    '.pet-profile-trigger','.nav-item']){
    assert.ok(css.includes(selector),selector)
  }
  assert.match(css,/@media\(max-width:720px\)\s*\{[\s\S]*?\.task-form,\.profile-form\s*\{grid-template-columns:minmax\(0,1fr\)/)
  assert.ok(css.includes('box-sizing:border-box'))
  assert.ok(pet.includes('.pet-form{grid-template-columns:minmax(0,1fr)}'))
  assert.ok(finance.includes('.fields{grid-template-columns:minmax(0,1fr)}'))
  assert.ok(life.includes('.life-form input[type="date"]{min-inline-size:0}'))
})

test('native date controls fit inside narrow cards across every form',()=>{
  for(const type of ['date','datetime-local','month','time']){
    assert.ok(css.includes('input[type="'+type+'"]'),type+' global sizing')
  }
  for(const declaration of ['inline-size:100%','min-inline-size:0','max-inline-size:100%','box-sizing:border-box']){
    assert.ok(css.includes(declaration),declaration)
  }
  for(const container of ['.task-edit-form','.plan-fields','.detail-editor','.profile-editor-grid','.archive-date-filters','.ledger-dates']){
    assert.ok(css.includes(container),container+' width containment')
  }
  assert.match(css,/::-webkit-date-and-time-value\s*\{[\s\S]*?min-inline-size:0/)
  assert.match(css,/::-webkit-datetime-edit\s*\{[\s\S]*?min-inline-size:0/)
  const shopping=readFileSync(new URL('../src/components/ShoppingLedgerPicker.vue',import.meta.url),'utf8')
  assert.match(shopping,/@media\(max-width:600px\)\s*\{\.ledger-dates\s*\{grid-template-columns:minmax\(0,1fr\)/)
})

test('all 31 date fields render inside the shared iOS-safe date control',()=>{
  const component=readFileSync(new URL('../src/components/DateField.vue',import.meta.url),'utf8')
  assert.match(component,/type="date"/)
  assert.match(component,/:value="modelValue \?\? ''"/)
  assert.match(component,/:min="min"/)
  assert.match(component,/:max="max"/)
  assert.match(component,/:required="required"/)
  assert.match(component,/@change="update"/)
  assert.match(component,/position:relative/)
  assert.match(component,/overflow:hidden/)
  assert.match(component,/position:absolute/)
  assert.match(component,/inline-size:100%/)
  assert.match(component,/min-inline-size:0/)
  assert.match(component,/选择日期/)
  const paths=[
    '../src/App.vue',
    '../src/components/LifePanel.vue',
    '../src/components/LifeItemEditor.vue',
    '../src/components/PlanCreator.vue',
    '../src/components/FinancePanel.vue',
    '../src/components/ProfileEditor.vue',
    '../src/components/PetHealthPanel.vue',
    '../src/components/ShoppingLedgerPicker.vue'
  ]
  let fields=0
  for(const path of paths){
    const file=readFileSync(new URL(path,import.meta.url),'utf8')
    assert.match(file,/import DateField from /,path+' imports the shared component')
    assert.doesNotMatch(file,/<input\b[^>]*\btype="date"/,path+' must not contain an unbounded native picker')
    const controls=[...file.matchAll(/<DateField\b[^>]*\/>/g)]
    assert.ok(controls.length>0,path+' contains at least one date control')
    for(const [tag] of controls)assert.match(tag,/v-model="/)
    fields+=controls.length
  }
  assert.ok(fields>=31,'all date fields, including newly added editors, use the shared iOS-safe control')
  const sw=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8')
  assert.match(sw,/homeflow-shell-v2/,'new service worker invalidates old cached shell')
  assert.match(sw,/fetch\(req,\{cache:'no-store'\}\)/,'navigation must request current HTML')
})

test('interval plan shows next due date and early-complete button together in a rounded row',()=>{
  const row=life.match(/<div v-if="planScope==='active'&&canCompleteRoutineEarly\(r\)" class="routine-early-complete">([\s\S]*?)<\/div>/)
  assert.ok(row,'interval action row should exist')
  assert.match(row[1],/<small>下次预计：\{\{ routineNextDue\(r\) \}\}<\/small>/)
  assert.match(row[1],/<button[^>]*@click="completeRoutineEarly\(r\)"[^>]*>今天提前完成<\/button>/)
  const style=life.match(/\.routine-early-complete\{([^}]+)\}/)
  assert.ok(style,'interval action row must have its own styles')
  for(const rule of ['display:flex','align-items:center','border:1px','border-radius:12px','background:#f5f8f5','box-sizing:border-box']){
    assert.ok(style[1].includes(rule),'missing bounded row rule: '+rule)
  }
  assert.match(life,/\.routine-early-complete small\{[^}]*min-width:0/)
  assert.match(life,/\.routine-early-complete button\{[^}]*flex:none/)
  assert.match(life,/\.life-row\.routine-has-early-complete\{border-bottom:0/)
})
