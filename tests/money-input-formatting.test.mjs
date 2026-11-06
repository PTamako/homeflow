import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {cleanMoneyInput,formatMoneyInput,moneyInputNumber,moneyCaretPosition} from '../src/money-input.mjs'

const source=name=>readFileSync(new URL('../src/components/'+name,import.meta.url),'utf8')

test('Japanese yen inputs render grouped integers without changing submitted numeric values',()=>{
 assert.equal(formatMoneyInput(1000000),'1,000,000')
 assert.equal(formatMoneyInput(100000000000),'100,000,000,000')
 assert.equal(formatMoneyInput(0),'0')
 assert.equal(moneyInputNumber('1,000,000'),1000000)
 assert.equal(moneyInputNumber(''),0)
 assert.equal(formatMoneyInput('987654321'),'987,654,321')
})

test('paste accepts existing commas, currency symbols, and full-width digits',()=>{
 assert.equal(cleanMoneyInput('¥ 1,234,567'),'1234567')
 assert.equal(cleanMoneyInput('￥１，２３４，５６７'),'1234567')
 assert.equal(formatMoneyInput('￥１，２３４，５６７'),'1,234,567')
 assert.equal(moneyInputNumber('−12,345'),-12345)
 assert.equal(formatMoneyInput('−123456',true),'-123,456')
 assert.equal(formatMoneyInput('-123456',false),'123,456')
})

test('negative signs are reserved for adjustment fields and cursor survives added separators',()=>{
 assert.equal(formatMoneyInput('-',true),'-')
 assert.equal(moneyInputNumber('-'),0)
 assert.equal(moneyCaretPosition('1000',4,'1,000'),5)
 assert.equal(moneyCaretPosition('12345',2,'12,345'),2)
 assert.equal(moneyCaretPosition('-1234',4,'-1,234'),5)
 assert.equal(moneyCaretPosition('1234',1,'1,234'),1)
})

test('every plan create/edit amount uses common MoneyInput while periods and quantities stay numeric',()=>{
 const create=source('PlanCreator.vue')
 const edit=source('LifeItemEditor.vue')
 for(const form of [create,edit]){
  assert.match(form,/import MoneyInput from '.\/MoneyInput.vue'/)
  for(const name of ['estimatedAmount','targetAmount','reservedAmount','budgetAmount']){
   assert.match(form,new RegExp('<MoneyInput v-model="form\\.'+name+'"'))
   assert.doesNotMatch(form,new RegExp('<input v-model\\.number="form\\.'+name+'"'))
  }
  assert.match(form,/v-model\.number="form\.quantity" type="number"/)
 }
 const finance=source('FinancePanel.vue')
 assert.match(finance,/<MoneyInput v-model="adjustment" :min="-100000000000" :max="100000000000" allow-negative/)
 assert.match(finance,/const adjustment=ref\(0\)/)
 assert.match(finance,/adjustmentAmount:amount/)
 assert.match(finance,/v-model="periodKey" type="number"/)
})

test('shared input validates min and max with text input and uses numeric keyboard',()=>{
 const component=source('MoneyInput.vue')
 assert.match(component,/type="text" inputmode="numeric"/)
 assert.match(component,/setCustomValidity/)
 assert.match(component,/model\.value=moneyInputNumber\(formatted\)/)
 assert.match(component,/input\.setSelectionRange\(nextPosition,nextPosition\)/)
 assert.match(component,/:required="required" :disabled="disabled"/)
})
