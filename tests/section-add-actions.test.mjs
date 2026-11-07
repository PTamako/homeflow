import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=(path)=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const app=source('App.vue')
const life=source('components/LifePanel.vue')
const creator=source('components/PlanCreator.vue')
const css=source('style.css')

test('family member and pet add buttons live within the correct headings, never their own card',()=>{
 const people=app.slice(app.indexOf('<h2><AppIcon name="users" :size="20" /> 家庭成员</h2>'))
 const pets=app.slice(app.indexOf('<h2><AppIcon name="paw" :size="20" /> 宠物档案</h2>'))
 assert.match(people.slice(0,650),/class="family-heading-actions"[\s\S]*aria-label="添加家庭成员"[\s\S]*@click="openProfileForm\('person'\)"/)
 assert.match(pets.slice(0,650),/class="family-heading-actions"[\s\S]*aria-label="添加宠物档案"[\s\S]*@click="openProfileForm\('pet'\)"/)
 assert.doesNotMatch(app,/<section v-if="user.role==='owner'" class="panel">/)
 assert.match(app,/function openProfileForm\(type:'person'\|'pet'\)[\s\S]*?petType.value=type[\s\S]*?showProfileForm.value=true/)
 assert.match(app,/<EditBottomSheet v-if="user.role==='owner'&&showProfileForm"/)
 assert.match(app,/:title="petType==='person'\?'添加家庭成员':'添加宠物档案'"/)
 assert.match(css,/\.section-add-button\{display:inline-grid;place-items:center/)
 assert.match(css,/\.family-heading-actions\{display:flex;align-items:center/)
})

test('timeline add and anniversary add share their section heading and keep mobile forms',()=>{
 const dayTitle=life.indexOf('家人的重要日子')
 const anniversary=life.slice(life.lastIndexOf('<div class="life-section-heading">',dayTitle),dayTitle+700)
 const timeline=life.slice(life.indexOf('<template v-else-if="mode===\'memories\'">'))
 assert.match(anniversary,/class="life-section-heading"[\s\S]*?aria-label="添加纪念日"/)
 assert.match(timeline,/class="life-section-heading"[\s\S]*?aria-label="添加回忆"/)
 assert.match(timeline,/<h2 class="life-heading"><AppIcon name="images" :size="21" \/> 我们的时光轴<\/h2>/)
 assert.doesNotMatch(timeline,/留下一段美好的回忆/)
 assert.doesNotMatch(timeline,/＋ 添加回忆/)
 assert.match(timeline,/<EditBottomSheet v-if="showMemoryForm" title="添加回忆"/)
 assert.match(timeline,/<form id="new-memory-form" class="life-form" @submit.prevent="addMemory">/)
 assert.match(life,/<EditBottomSheet v-if="showAnniversaryForm" title="添加纪念日"/)
 assert.doesNotMatch(life,/＋ 添加纪念日/)
})

test('plan add button shares existing plan toolbar instead of taking a separate row',()=>{
 const index=life.indexOf('<div class="plan-view-toolbar" aria-label="计划筛选与状态">')
 assert.ok(index>0)
 const toolbar=life.slice(index,index+650)
 assert.match(toolbar,/class="plan-view-heading"[\s\S]*<PlanCreator v-if="planScope==='active'" compact/)
 assert.match(creator,/:class="\['plan-creator',\{compact:props.compact\}\]"/)
 assert.match(creator,/:aria-label="props.compact\?'新增计划':undefined"/)
 assert.match(creator,/<EditBottomSheet v-if="opened" title="新增计划"/)
})
