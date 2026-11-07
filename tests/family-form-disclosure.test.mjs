import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const pet=readFileSync(new URL('../src/components/PetHealthPanel.vue',import.meta.url),'utf8')

test('new family and pet profile form is collapsed by default',()=>{
  assert.match(app,/const showProfileForm=ref\(false\)/)
  assert.match(app,/<EditBottomSheet v-if="showProfileForm"/)
  assert.match(app,/:aria-expanded="showProfileForm&&petType==='person'"/)
  assert.match(app,/:aria-expanded="showProfileForm&&petType==='pet'"/)
  assert.match(app,/@click="openProfileForm\('person'\)"/)
  assert.match(app,/@click="openProfileForm\('pet'\)"/)
  assert.match(app,/function closeProfileForm\(\)\{[\s\S]*?showProfileForm\.value=false/)
  assert.match(app,/await profileSaved\(\)\s*closeProfileForm\(\)/)
  assert.match(app,/@click="closeProfileForm">取消/)
})

test('family anniversaries stay visible while entry form is collapsed',()=>{
  assert.match(life,/const showAnniversaryForm=ref\(false\)/)
  assert.match(life,/家人的重要日子/)
  assert.match(life,/v-for="e in upcomingAnniversaries"/)
  assert.match(life,/<EditBottomSheet v-if="showAnniversaryForm"/)
  assert.match(life,/:aria-expanded="showAnniversaryForm"/)
  assert.match(life,/if\(!error\.value\)closeAnniversaryForm\(\)/)
  assert.match(life,/@click="closeAnniversaryForm">取消/)
  assert.match(life,/LifeItemEditor v-if="editing\?\.kind==='anniversaries'&&editing\.item\.id===e\.id"/)
})

test('pet health entry opens on add or edit, closes on save or cancel',()=>{
  assert.match(pet,/const showHealthForm=ref\(false\)/)
  assert.match(pet,/<EditBottomSheet v-if="showHealthForm"/)
  assert.match(pet,/:aria-expanded="showHealthForm"/)
  assert.match(pet,/@click="toggleHealthForm"/)
  assert.match(pet,/function editRecord\(r:Health\)\{[\s\S]*?showHealthForm\.value=true/)
  assert.match(pet,/:close-disabled="busy" @close="cancelEditing"/)
  assert.match(pet,/function cancelEditing\(\)\{[\s\S]*?showHealthForm\.value=false/)
  assert.match(pet,/const edited=!!editingId\.value\s*cancelEditing\(\)/)
  assert.match(pet,/@click="cancelEditing">取消/)
  assert.match(pet,/@edit="editRecord\(r\)"/)
})
