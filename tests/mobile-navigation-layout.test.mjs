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

test('plan tasks place reminders and early completion inside compact, divided items',()=>{
  const firstRoutine=life.indexOf('<div v-for="r in routines" :key="r.id" class="plan-task-item">')
  const firstOneTime=life.indexOf('<div v-for="t in oneTimePlans" :key="t.id" class="plan-task-item">',firstRoutine)
  const end=life.indexOf('<p v-if="!routines.length&&!oneTimePlans.length"',firstOneTime)
  assert.ok(firstRoutine>=0&&firstOneTime>firstRoutine&&end>firstOneTime,
    'recurring and one-time tasks share the same item structure')
  const routine=life.slice(firstRoutine,firstOneTime)
  const oneTime=life.slice(firstOneTime,end)
  assert.match(routine,/class="plan-task-footer"/)
  assert.match(routine,/class="plan-task-next">下次预计：\{\{ routineNextDue\(r\) \}\}/)
  assert.match(routine,/@click="completeRoutineEarly\(r\)">今天提前完成/)
  assert.match(routine,/toggleReminderEditor\('routine',r.id\)/)
  assert.match(oneTime,/class="plan-task-footer"/)
  assert.match(oneTime,/toggleReminderEditor\('task',t.id\)/)
  assert.match(routine,/scope="routines"/)
  assert.match(oneTime,/scope="one-time-plans"/)
  const itemStyle=life.match(/\.plan-task-item\{([^}]+)\}/)
  assert.ok(itemStyle,'each task gets its own padded divider')
  assert.match(itemStyle[1],/border-bottom:1px/)
  assert.match(life,/\.plan-task-item \.life-row\{border:0/)
  assert.match(life,/\.plan-task-controls\{[^}]*flex-wrap:wrap/)
  assert.match(life,/\.plan-task-next\{[^}]*white-space:nowrap/)
  assert.match(life,/\.plan-task-action:disabled\{opacity:/)
  assert.doesNotMatch(routine,/routine-early-complete|routine-list-item/)
})
