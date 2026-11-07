import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const date=read('src/components/DateField.vue')
const plan=read('src/components/PlanCreator.vue')
const once=read('src/components/OneTimeTaskFields.vue')
const finance=read('src/components/FinancePanel.vue')

test('plan creation button shows exactly one plus while collapsed',()=>{
 assert.match(plan,/<AppIcon name="plus" :size="19"\/>/)
 assert.match(plan,/:class="\['plan-creator',\{compact:props.compact\}\]"/)
 assert.match(plan,/opened\?'收起新增计划':'新增计划'/)
 assert.doesNotMatch(plan,/＋ 新增计划/)
})

test('shared date picker can clear a selected value without affecting native picker validation',()=>{
 assert.match(date,/function clearDate\(\)[\s\S]*?emit\('update:modelValue',''\)/)
 assert.match(date,/v-if="modelValue&&!disabled"/)
 assert.match(date,/aria-label="清空日期"/)
 assert.match(date,/@pointerdown\.stop @click\.stop\.prevent="clearDate"/)
 assert.match(date,/:value="modelValue \?\? ''"/)
 for(const attr of ['min','max','required','disabled'])assert.ok(date.includes(':'+attr+'="'+attr+'"'))
 assert.match(date,/date-field__native--with-clear\{inline-size:calc\(100% - 44px\)\}/)
 assert.match(date,/\.date-field__clear\{[\s\S]*?z-index:2;/)
 assert.match(date,/\.date-field__clear\{[\s\S]*?inline-size:44px;/)
})

test('one-time task uses only the common clear action',()=>{
 assert.match(once,/<DateField v-model="model.dueOn"/)
 assert.doesNotMatch(once,/class="once-clear"/)
})

test('all calendar dates in Vue forms share the same clearable component',()=>{
 for(const file of ['src/App.vue',...readdirSync(new URL('../src/components/',import.meta.url))
   .filter(name=>name.endsWith('.vue')&&name!=='DateField.vue')
   .map(name=>'src/components/'+name)]){
  assert.doesNotMatch(read(file),/<input[^>]+type=["']date["']/g,file)
 }
})

test('monthly period picker can reset to the default month',()=>{
 assert.match(finance,/class="finance-month-reset"/)
 assert.match(finance,/@click="periodKey=defaultPeriodKey\(\)"/)
})
