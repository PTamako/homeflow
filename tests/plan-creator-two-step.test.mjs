import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const plan=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
const script=plan.slice(0,plan.indexOf('</script>'))
const template=plan.slice(plan.indexOf('<template>'),plan.lastIndexOf('</template>')+11)

test('plan creator presents type selection first and renders the form only on the next step',()=>{
 assert.match(script,/const step=ref<'choose'\|'details'>\('choose'\)/)
 assert.match(template,/<EditBottomSheet v-if="opened" :title="step==='choose'\?'新增计划':selected\?\.label\|\|'填写计划'"/)
 assert.match(template,/<div v-if="step==='choose'" ref="stepContent" class="plan-choice-step">/)
 assert.match(template,/<h2 ref="stepHeading" tabindex="-1">选择计划类型<\/h2>/)
 assert.match(template,/<div class="plan-type-grid">/)
 assert.match(template,/@click="choose\(choice.id\)"/)
 assert.match(template,/<form v-else-if="kind" ref="stepContent" class="plan-fields" @submit.prevent="submit">/)
 assert.doesNotMatch(template,/<form v-if="kind"/)
 assert.match(template,/第 1 步 \/ 共 2 步/)
 assert.match(template,/第 2 步 \/ 共 2 步/)
})

test('back navigation keeps the draft when returning to the same type',()=>{
 assert.match(script,/function backToChoices\(\)\{[\s\S]*?step.value='choose'/)
 assert.match(script,/if\(kind.value!==value\)\{/)
 assert.match(script,/step.value='details'/)
 assert.match(template,/@click="backToChoices"/)
 assert.match(template,/返回选择类型/)
 assert.match(template,/:disabled="busy" @click="backToChoices"/)
 assert.match(script,/function dismiss\(\)\{[\s\S]*?step.value='choose';kind.value=null/)
})

test('step navigation scrolls the sheet to top without remounting or jumping the page',()=>{
 assert.match(script,/scrollStepToTop\(\)/)
 assert.match(script,/nextTick\(\(\)=>\{/)
 assert.match(script,/stepContent.value\?\.closest<HTMLElement>\('\.edit-sheet-content'\)/)
 assert.match(script,/scrollArea\?\.scrollTo\(\{top:0\}\)/)
 assert.match(script,/stepHeading.value\?\.focus\(\{preventScroll:true\}\)/)
 assert.doesNotMatch(template,/<EditBottomSheet[^>]+:key="step"/)
 assert.match(template,/:close-disabled="busy" @close="dismiss"/)
})

test('all five plan types retain existing creation paths, validation and sticky actions',()=>{
 for(const type of ['routine','shopping','wish','goal','trip']){
  assert.ok(plan.includes("{id:'"+type+"'"),type+' type remains available')
 }
 for(const api of ["'/tasks'","'/routines'","'/shopping'","'/wishes'","'/goals'","'/trips'"]){
  assert.ok(script.includes(api),api+' original create endpoint remains unchanged')
 }
 assert.match(template,/OneTimeTaskFields v-if="form.repeatType==='once'"/)
 assert.match(template,/class="creator-actions"/)
 assert.match(template,/class="creator-save"/)
 assert.match(template,/:disabled="busy\|\|\(kind==='routine'/)
 assert.match(plan,/\.creator-step-back\{[^}]*min-height:44px/)
 assert.match(plan,/\.plan-type-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
})
