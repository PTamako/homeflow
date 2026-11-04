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
