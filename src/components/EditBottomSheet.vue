<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,useId} from 'vue'

const props=withDefaults(defineProps<{title:string;closeDisabled?:boolean}>(),{closeDisabled:false})
const emit=defineEmits<{close:[]}>()
const dialog=ref<HTMLElement|null>(null)
const titleId=useId()
let previousFocus:HTMLElement|null=null

// Nested sheets must not restore scrolling while another sheet is still open.
function requestClose(){
 if(!props.closeDisabled)emit('close')
}
function onKeydown(event:KeyboardEvent){
 if(event.key==='Escape'){
  event.preventDefault();event.stopPropagation();requestClose();return
 }
 if(event.key!=='Tab'||!dialog.value)return
 const controls=Array.from(dialog.value.querySelectorAll<HTMLElement>(
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
 )).filter(el=>el.getClientRects().length>0)
 if(!controls.length){event.preventDefault();dialog.value.focus();return}
 const first=controls[0],last=controls[controls.length-1]
 if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.value)){
  event.preventDefault();last.focus()
 }else if(!event.shiftKey&&document.activeElement===last){
  event.preventDefault();first.focus()
 }
}
onMounted(()=>{
 previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
 lockSheetScroll()
 void nextTick(()=>dialog.value?.focus({preventScroll:true}))
})
onBeforeUnmount(()=>{
 unlockSheetScroll()
 previousFocus?.focus({preventScroll:true})
})
let activeSheetLocks=0
let savedBodyOverflow=''
function lockSheetScroll(){
 if(activeSheetLocks++===0){
  savedBodyOverflow=document.body.style.overflow
  document.body.style.overflow='hidden'
 }
}
function unlockSheetScroll(){
 activeSheetLocks=Math.max(0,activeSheetLocks-1)
 if(activeSheetLocks===0)document.body.style.overflow=savedBodyOverflow
}
</script>

<template>
 <Teleport to="body">
  <div class="edit-sheet-layer" @keydown="onKeydown">
   <div class="edit-sheet-scrim" aria-hidden="true" @click="requestClose"></div>
   <section ref="dialog" class="edit-sheet-dialog" role="dialog" aria-modal="true"
     :aria-labelledby="titleId" tabindex="-1">
    <div class="edit-sheet-handle" aria-hidden="true"></div>
    <header class="edit-sheet-header">
     <h2 :id="titleId">{{ title }}</h2>
     <button type="button" class="edit-sheet-close" :disabled="closeDisabled"
       aria-label="关闭编辑面板" @click="requestClose">×</button>
    </header>
    <div class="edit-sheet-content"><slot/></div>
   </section>
  </div>
 </Teleport>
</template>

<style scoped>
.edit-sheet-layer{position:fixed;inset:0;z-index:10000;isolation:isolate;
 pointer-events:none}
.edit-sheet-scrim{position:absolute;inset:0;pointer-events:auto;
 background:rgb(20 35 28 / 43%);animation:sheet-fade .2s ease-out both}
.edit-sheet-dialog{position:absolute;bottom:0;left:50%;width:100%;
 max-width:620px;max-height:calc(100dvh - 14px);display:flex;flex-direction:column;
 overflow:hidden;pointer-events:auto;background:#fff;border-radius:22px 22px 0 0;
 box-shadow:0 -8px 36px rgb(20 35 28 / 16%);
 transform:translateX(-50%);animation:sheet-slide .24s cubic-bezier(.2,.8,.2,1) both;
 outline:none}
.edit-sheet-handle{width:36px;height:4px;border-radius:10px;background:#d7e1d9;
 margin:9px auto 4px;flex:none}
.edit-sheet-header{display:flex;align-items:center;justify-content:space-between;
 gap:12px;padding:8px 18px 11px;border-bottom:1px solid #e8eee9;flex:none}
.edit-sheet-header h2{margin:0;font-size:16px;line-height:1.4;color:#2f4a38;
 font-weight:750;min-width:0;overflow-wrap:anywhere}
.edit-sheet-close{display:grid;place-items:center;flex:none;width:30px;height:30px;
 min-width:30px;min-height:30px;padding:0;border:0;border-radius:50%;
 background:#f1f5f1;color:#66826e;font-size:23px;line-height:1}
.edit-sheet-close:disabled{opacity:.45}
.edit-sheet-close:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.edit-sheet-content{min-height:0;overflow:auto;overscroll-behavior:contain;
 -webkit-overflow-scrolling:touch;padding:16px 18px calc(18px + env(safe-area-inset-bottom))}
.edit-sheet-content :deep(input),.edit-sheet-content :deep(select),
.edit-sheet-content :deep(textarea){max-width:100%}
@keyframes sheet-fade{from{opacity:0}to{opacity:1}}
@keyframes sheet-slide{from{transform:translate(-50%,32px);opacity:.9}
 to{transform:translate(-50%,0);opacity:1}}
@media(prefers-reduced-motion:reduce){.edit-sheet-scrim,.edit-sheet-dialog{animation:none}}
@media(min-width:760px){
 .edit-sheet-dialog{bottom:16px;border-radius:22px;max-height:calc(100dvh - 32px)}
}
</style>
