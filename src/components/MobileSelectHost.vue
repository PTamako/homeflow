<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,shallowRef} from 'vue'
import EditBottomSheet from './EditBottomSheet.vue'
import AppIcon from './AppIcon.vue'
import {filterMobileSelectOptions,shouldSearchMobileSelect,type MobileSelectChoice} from '../mobile-select-options.mjs'

// One shared sheet for every native single-select in HomeFlow. Keeping the
// original <select> in the DOM preserves Vue v-model, v-model.number,
// required/disabled validation, and existing @change behavior without replacing
// dozens of independent form implementations.
const activeSelect=shallowRef<HTMLSelectElement|null>(null)
const options=ref<MobileSelectChoice[]>([])
const heading=ref('选择选项')
const chosen=ref('')
const keyword=ref('')
const filtered=computed(()=>filterMobileSelectOptions(options.value,keyword.value))
const searchable=computed(()=>shouldSearchMobileSelect(options.value,
  activeSelect.value?.dataset.mobileSearch==='always'))

function supportsMobileSheet(){
 return window.matchMedia('(pointer: coarse) and (max-width: 1100px)').matches
}
function sourceSelect(event:Event):HTMLSelectElement|null{
 const target=event.target
 if(target instanceof HTMLSelectElement)return target
 return target instanceof Element?target.closest('select'):null
}
function shouldEnhance(select:HTMLSelectElement|null){
 return !!select&&supportsMobileSheet()&&!select.disabled&&!select.multiple&&
  select.size<=1&&select.options.length>0&&!select.hasAttribute('data-native-select')&&
  !select.closest('[inert]')
}
function readHeading(select:HTMLSelectElement){
 const aria=select.getAttribute('aria-label')||select.getAttribute('title')
 if(aria?.trim())return aria.trim()
 const label=select.labels?.[0]
 const ownText=label?Array.from(label.childNodes)
   .filter(node=>node.nodeType===Node.TEXT_NODE)
   .map(node=>node.textContent?.trim()||'').filter(Boolean).join(' '):''
 return ownText||'请选择'
}
function openSelect(select:HTMLSelectElement){
 if(activeSelect.value===select)return
 // Read the currently rendered DOM options only on tap: no upfront per-page
 // observer, duplicated select state, remote search, or storage writes.
 options.value=Array.from(select.options).map((option,index)=>{
  const group=option.parentElement instanceof HTMLOptGroupElement?option.parentElement:null
  return {index,value:option.value,label:option.label.trim()||option.textContent?.trim()||'',
    group:group?.label||'',disabled:option.disabled||!!group?.disabled}
 })
 heading.value=readHeading(select)
 chosen.value=select.value
 keyword.value=''
 activeSelect.value=select
}
function closeSelect(){activeSelect.value=null;keyword.value=''}
function choose(option:MobileSelectChoice){
 const select=activeSelect.value
 if(!select||option.disabled||!select.isConnected||select.disabled){closeSelect();return}
 // The select remains the single source of truth. Vue's regular change
 // listener (and every existing business-specific @change handler) runs once.
 closeSelect()
 if(select.value===option.value)return
 select.value=option.value
 select.dispatchEvent(new Event('input',{bubbles:true}))
 select.dispatchEvent(new Event('change',{bubbles:true}))
}
function intercept(event:Event){
 const select=sourceSelect(event)
 if(!shouldEnhance(select))return
 event.preventDefault()
 event.stopImmediatePropagation()
 openSelect(select!)
}
function onPointerDown(event:PointerEvent){
 // Don't steal mouse-based dropdowns on hybrid devices.
 if(event.pointerType==='mouse')return
 intercept(event)
}
function onClick(event:MouseEvent){
 // Also catch VoiceOver activation and a click forwarded by a <label>.
 if(event.detail>0&&'pointerType' in event&&event.pointerType==='mouse')return
 intercept(event)
}
function onKeydown(event:KeyboardEvent){
 if(event.key!=='Enter'&&event.key!==' ')return
 if(!shouldEnhance(sourceSelect(event)))return
 intercept(event)
}
onMounted(()=>{
 document.addEventListener('pointerdown',onPointerDown,true)
 document.addEventListener('click',onClick,true)
 document.addEventListener('keydown',onKeydown,true)
})
onBeforeUnmount(()=>{
 document.removeEventListener('pointerdown',onPointerDown,true)
 document.removeEventListener('click',onClick,true)
 document.removeEventListener('keydown',onKeydown,true)
 closeSelect()
})
</script>

<template>
 <EditBottomSheet v-if="activeSelect" :title="heading" @close="closeSelect">
  <div class="mobile-select-sheet">
   <label v-if="searchable" class="mobile-select-search">
    <span class="mobile-select-search-label">搜索选项</span>
    <input v-model="keyword" type="search" enterkeyhint="search" autocomplete="off"
      autocapitalize="off" spellcheck="false" placeholder="输入关键词筛选"
      aria-label="搜索下拉选项"/>
   </label>
   <div class="mobile-select-list" role="listbox" :aria-label="heading">
    <template v-for="(item,i) in filtered" :key="item.index">
     <div v-if="item.group&&(i===0||filtered[i-1]?.group!==item.group)"
       class="mobile-select-group" role="presentation">{{ item.group }}</div>
     <button type="button" class="mobile-select-option"
       :class="{'mobile-select-option--selected':item.value===chosen}"
       :disabled="item.disabled" role="option" :aria-selected="item.value===chosen"
       @click="choose(item)">
       <span>{{ item.label }}</span>
       <AppIcon v-if="item.value===chosen" name="check" :size="20"/>
     </button>
    </template>
    <div v-if="!filtered.length" class="mobile-select-empty">
      <p>没有匹配的选项</p>
      <button type="button" @click="keyword=''">清空搜索</button>
    </div>
   </div>
   <p v-if="searchable" class="mobile-select-count" role="status">
    {{ filtered.length }} 个选项
   </p>
  </div>
 </EditBottomSheet>
</template>

<style scoped>
.mobile-select-sheet{display:grid;gap:10px;min-width:0}
.mobile-select-search{display:grid;gap:5px;min-width:0}
.mobile-select-search-label{font-size:12px;color:#6e8676}
.mobile-select-search input{display:block;box-sizing:border-box;width:100%;min-width:0;
 min-height:46px;margin:0;padding:10px 14px;border:1px solid #d0e2d5;
 background:#f8fbf8;color:#2d4c39;border-radius:11px;font-size:16px}
.mobile-select-search input:focus-visible{outline:2px solid #43866a;outline-offset:1px}
.mobile-select-list{display:grid;align-content:start;min-height:0;max-height:min(56dvh,560px);
 overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.mobile-select-group{font-size:11px;font-weight:700;color:#799080;padding:12px 12px 5px;
 border-bottom:1px solid #e6ede7}
.mobile-select-option{display:flex;align-items:center;justify-content:space-between;
 gap:12px;width:100%;min-width:0;min-height:48px;padding:11px 13px;
 border:0;border-bottom:1px solid #edf2ed;border-radius:0;
 background:#fff;color:#365640;font-size:15px;text-align:left;line-height:1.4}
.mobile-select-option span{min-width:0;overflow-wrap:anywhere}
.mobile-select-option--selected{color:#286a45;background:#edf8f0;font-weight:700}
.mobile-select-option:disabled{color:#aab6ac;background:#f8faf8;opacity:.58}
.mobile-select-option:not(:disabled):active{background:#e4f3e8}
.mobile-select-option:focus-visible{outline:2px solid #43866a;outline-offset:-2px}
.mobile-select-option .app-icon{color:#39845a}
.mobile-select-empty{text-align:center;padding:24px 12px;color:#819285;font-size:13px}
.mobile-select-empty button{margin-top:5px;min-height:42px;padding:6px 12px;
 border:1px solid #cfe3d4;border-radius:9px;color:#43866a;background:white}
.mobile-select-count{margin:0;text-align:center;font-size:11px;color:#8a9b8d}
@media(prefers-reduced-motion:reduce){.mobile-select-option{scroll-behavior:auto}}
</style>
