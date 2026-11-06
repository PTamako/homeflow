<script setup lang="ts">
import {computed,useAttrs} from 'vue'

defineOptions({inheritAttrs:false})
const props=defineProps<{
  modelValue?:string|null
  min?:string
  max?:string
  required?:boolean
  disabled?:boolean
}>()
const emit=defineEmits<{(event:'update:modelValue',value:string):void}>()
const attrs=useAttrs()
const dateText=computed(()=>{
  const value=props.modelValue||''
  return /^\d{4}-\d{2}-\d{2}$/.test(value)?value.replace(/-/g,'/'):'选择日期'
})
function update(event:Event){
  emit('update:modelValue',(event.target as HTMLInputElement).value)
}
function clearDate(){
  if(!props.disabled)emit('update:modelValue','')
}
</script>

<template>
  <span class="date-field">
    <span class="date-field__text" :class="{'date-field__placeholder':!modelValue}" aria-hidden="true">{{ dateText }}</span>
    <svg class="date-field__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <path d="M7 3v4M17 3v4M3 10h18"/>
    </svg>
    <!-- Keep the native picker and form validation, but never let its iOS intrinsic
         width dictate the visible layout. Taps reach this full-size input. -->
    <input
      v-bind="attrs"
      class="date-field__native"
      :class="{'date-field__native--with-clear':!!modelValue&&!disabled}"
      type="date"
      :value="modelValue ?? ''"
      :min="min"
      :max="max"
      :required="required"
      :disabled="disabled"
      @input="update"
      @change="update"
    />
    <button v-if="modelValue&&!disabled" class="date-field__clear" type="button"
      aria-label="清空日期" title="清空日期" @pointerdown.stop @click.stop.prevent="clearDate">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>
  </span>
</template>

<style scoped>
.date-field{
  position:relative;
  display:flex;
  align-items:center;
  gap:10px;
  inline-size:100%;
  min-inline-size:0;
  max-inline-size:100%;
  block-size:44px;
  min-block-size:44px;
  padding:9px 12px;
  box-sizing:border-box;
  background:#fff;
  color:#27352f;
  border:1px solid #dae5dd;
  border-radius:11px;
  overflow:hidden;
  font-size:14px;
  line-height:1.4;
}
.date-field__text{
  flex:1 1 auto;
  min-inline-size:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.date-field__placeholder{color:#91a098}
.date-field__icon{inline-size:18px;block-size:18px;flex:0 0 18px;color:#608a72}
.date-field__native{
  position:absolute;
  inset:0;
  display:block;
  inline-size:100%;
  block-size:100%;
  min-inline-size:0;
  max-inline-size:100%;
  box-sizing:border-box;
  margin:0;
  padding:0;
  border:0;
  opacity:0;
  cursor:pointer;
  z-index:1;
  font-size:16px;
}
.date-field__native--with-clear{inline-size:calc(100% - 44px)}
.date-field__clear{
  position:relative;
  z-index:2;
  display:grid;
  place-items:center;
  flex:0 0 44px;
  inline-size:44px;
  block-size:44px;
  min-block-size:44px;
  margin:-9px -12px -9px 0;
  padding:0;
  border:0;
  border-radius:0 10px 10px 0;
  background:transparent;
  color:#718a7d;
  cursor:pointer;
}
.date-field__clear svg{inline-size:16px;block-size:16px;pointer-events:none}
.date-field__clear:hover{color:#356e55;background:#f2f7f3}
.date-field__clear:focus-visible{outline:2px solid #43866a;outline-offset:-3px}
.date-field:focus-within{outline:2px solid #43866a;outline-offset:1px}
.date-field:has(.date-field__native:disabled){opacity:.55}
@media(max-width:720px){.date-field{font-size:16px}}
</style>
