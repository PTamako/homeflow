<script setup lang="ts">
import {nextTick,ref,watch} from 'vue'
import {formatMoneyInput,moneyInputNumber,moneyCaretPosition} from '../money-input.mjs'

// A formatted text input is essential: input[type=number] cannot show thousands
// separators. v-model stays numeric so D1/Worker validation and API JSON do not change.
const model=defineModel<number>({required:true})
const props=withDefaults(defineProps<{
 min?:number;max?:number;required?:boolean;disabled?:boolean
 allowNegative?:boolean;placeholder?:string;id?:string;name?:string
}>(),{
 min:0,max:100000000000,required:false,disabled:false,allowNegative:false
})
const element=ref<HTMLInputElement|null>(null)
const focused=ref(false)
const display=ref(formatMoneyInput(model.value,props.allowNegative))

function validate(){
 const input=element.value
 if(!input)return
 const amount=moneyInputNumber(display.value)
 input.setCustomValidity(
  display.value==='-'?'请输入有效金额':
  display.value===''?'':!Number.isSafeInteger(amount)?'金额超出有效整数范围':
  amount<props.min?'金额不能小于 '+formatMoneyInput(props.min):
  amount>props.max?'金额不能大于 '+formatMoneyInput(props.max):''
 )
}
watch(model,next=>{
 if(!focused.value||moneyInputNumber(display.value)!==next)
  display.value=formatMoneyInput(next,props.allowNegative)
 void nextTick(validate)
})
watch(()=>[props.min,props.max,props.allowNegative],()=>{
 if(!focused.value)display.value=formatMoneyInput(model.value,props.allowNegative)
 void nextTick(validate)
})
function onInput(event:Event){
 const input=event.target as HTMLInputElement
 const raw=input.value,position=input.selectionStart??raw.length
 const formatted=formatMoneyInput(raw,props.allowNegative)
 display.value=formatted
 // Assign synchronously, so iOS keeps the cursor while a comma is inserted.
 input.value=formatted
 const nextPosition=moneyCaretPosition(raw,position,formatted)
 input.setSelectionRange(nextPosition,nextPosition)
 model.value=moneyInputNumber(formatted)
 validate()
}
function onFocus(){
 focused.value=true
 // Starting from zero is a common case for a new wish/goal budget.
 if(display.value==='0')element.value?.select()
}
function onBlur(){
 focused.value=false
 display.value=formatMoneyInput(model.value,props.allowNegative)
 void nextTick(validate)
}
</script>
<template>
 <input ref="element" :id="id" :name="name" type="text" inputmode="numeric"
   :value="display" :required="required" :disabled="disabled"
   :placeholder="placeholder" autocomplete="off" autocapitalize="off"
   spellcheck="false" @input="onInput" @focus="onFocus" @blur="onBlur" />
</template>
<style scoped>
input{box-sizing:border-box;min-width:0;max-width:100%;font-variant-numeric:tabular-nums}
</style>
