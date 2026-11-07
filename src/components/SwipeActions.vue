<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,nextTick,watch} from 'vue'
import {activeSwipeId} from '../swipe-state'
import AppIcon from './AppIcon.vue'
import {swipeHelpLearned,swipeHelpOwner,claimSwipeHelp,releaseSwipeHelp,acknowledgeSwipeHelp} from '../swipe-discovery'

// One open row across the app, including different sections and pages.

const props=withDefaults(defineProps<{
  id:string
  scope:string
  allowEdit?:boolean
  allowDelete?:boolean
  showTrigger?:boolean
  editLabel?:string
  deleteLabel?:string
}>(),{allowEdit:true,allowDelete:true,showTrigger:true,editLabel:'编辑',deleteLabel:'删除'})
const emit=defineEmits<{open:[];edit:[];delete:[]}>()
const key=computed(()=>props.scope+':'+props.id)
const opened=computed(()=>activeSwipeId.value===key.value)
const count=computed(()=>Number(props.allowEdit)+Number(props.allowDelete))
const actionWidth=computed(()=>count.value*72)
const movement=ref(0)
const dragging=ref(false)
const firstAction=ref<HTMLButtonElement|null>(null)
const deleteAction=ref<HTMLButtonElement|null>(null)
const triggerRef=ref<HTMLButtonElement|null>(null)
const rowRef=ref<HTMLDivElement|null>(null)
const coarsePointer=ref(false)
const showHint=computed(()=>coarsePointer.value&&swipeHelpOwner.value===key.value&&!swipeHelpLearned.value)
const showTriggerUi=computed(()=>props.showTrigger&&(!coarsePointer.value||showHint.value))
let touchStart:{x:number;y:number}|null=null
let axis:'horizontal'|'vertical'|null=null
let touchedAt=0
function open(){
 if(!count.value||opened.value)return
 activeSwipeId.value=key.value
 // A contextual More menu must close when the user reveals the edit/delete rail.
 emit('open')
}
function close(){if(opened.value)activeSwipeId.value=''}
function toggle(){
 if(opened.value){close();return}
 open()
 // The subtle neutral desktop trigger is a keyboard/mouse fallback, not More.
 void nextTick(()=>(firstAction.value||deleteAction.value)?.focus())
}
function closeFromKeyboard(){close();void nextTick(()=>(triggerRef.value||rowRef.value)?.focus())}
function activateRow(event:KeyboardEvent){
 if(event.target!==rowRef.value)return
 event.preventDefault()
 toggle()
}
function dismissHint(){acknowledgeSwipeHelp()}
function start(event:TouchEvent){
  if(!count.value||event.touches.length!==1)return
  touchStart={x:event.touches[0].clientX,y:event.touches[0].clientY}
  axis=null;movement.value=0;dragging.value=false
}
function move(event:TouchEvent){
  if(!touchStart||event.touches.length!==1)return
  const dx=event.touches[0].clientX-touchStart.x
  const dy=event.touches[0].clientY-touchStart.y
  if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)
    axis=Math.abs(dx)>Math.abs(dy)*1.3?'horizontal':'vertical'
  if(axis==='horizontal'){
    dragging.value=true
    const origin=opened.value?-actionWidth.value:0
    movement.value=Math.max(-actionWidth.value,Math.min(0,origin+dx))-origin
  }
}
function end(event:TouchEvent){
  if(!touchStart)return
  const dx=event.changedTouches[0]?.clientX-touchStart.x||0
  const dy=event.changedTouches[0]?.clientY-touchStart.y||0
  if(axis==='horizontal'&&Math.abs(dx)>36&&Math.abs(dx)>Math.abs(dy)*1.3){
    if(dx<0){
      open()
      acknowledgeSwipeHelp() // A real first swipe completes the one-time tutorial.
    }else close()
    touchedAt=Date.now()
  }
  touchStart=null;axis=null;movement.value=0;dragging.value=false
}
function cancel(){
  touchStart=null;axis=null;movement.value=0;dragging.value=false
}
function tapContent(event:MouseEvent){
  if(Date.now()-touchedAt<450){
    event.preventDefault();event.stopPropagation();return
  }
  if(opened.value){
    event.preventDefault();event.stopPropagation();close()
  }
}
function run(action:'edit'|'delete'){
  close()
  if(action==='edit')emit('edit')
  else emit('delete')
}
onMounted(()=>{
 coarsePointer.value=window.matchMedia('(hover: none), (pointer: coarse)').matches
 if(count.value>0&&coarsePointer.value)claimSwipeHelp(key.value)
})
watch([count,key],([countNow,newKey],[,previousKey])=>{
 if(previousKey&&previousKey!==newKey)releaseSwipeHelp(previousKey)
 if(countNow>0&&coarsePointer.value)claimSwipeHelp(newKey)
})
onBeforeUnmount(()=>{releaseSwipeHelp(key.value);close()})
</script>
<template>
  <div v-if="showHint" class="swipe-discovery" role="note">
    <span class="swipe-discovery-arrow" aria-hidden="true">←</span>
    <span>向左滑动明细，可以编辑或删除</span>
    <button type="button" @click.stop="dismissHint">知道了</button>
  </div>
  <div v-if="count" ref="rowRef" class="swipe-row" :class="{'is-open':opened,'is-dragging':dragging}"
    role="group" :aria-label="'明细操作：向左滑动或按回车展开'+(allowEdit?editLabel:'')+(allowEdit&&allowDelete?'、':'')+(allowDelete?deleteLabel:'')"
    :aria-expanded="opened" :tabindex="coarsePointer?0:-1"
    @touchstart.passive="start" @touchmove.passive="move" @touchend="end" @touchcancel="cancel"
    @keydown.enter.self="activateRow" @keydown.space.self="activateRow"
    @keydown.esc.stop="closeFromKeyboard">
    <div class="swipe-actions" :style="{width:actionWidth+'px'}">
      <button v-if="allowEdit" ref="firstAction" type="button" class="edit" :tabindex="opened?0:-1"
        :aria-label="editLabel" @click.stop="run('edit')">{{ editLabel }}</button>
      <button v-if="allowDelete" ref="deleteAction" type="button" class="delete" :tabindex="opened?0:-1"
        :aria-label="deleteLabel" @click.stop="run('delete')">{{ deleteLabel }}</button>
    </div>
    <div class="swipe-content" :style="{
      transform:'translateX('+((opened?-actionWidth:0)+movement)+'px)',
      paddingRight:showTriggerUi?'44px':'0px'
    }" @click.capture="tapContent">
      <slot/>
    </div>
    <button v-if="showTriggerUi&&!opened" ref="triggerRef" type="button" class="swipe-trigger"
      :aria-label="'左滑或点击展开'+(allowEdit?editLabel:'')+(allowEdit&&allowDelete?'和':'')+(allowDelete?deleteLabel:'')"
      :aria-expanded="opened" :title="'左滑'+(allowEdit?editLabel:'')+(allowDelete?'/'+deleteLabel:'')"
      @click.stop="toggle">
      <span class="swipe-chevron" aria-hidden="true"><AppIcon name="chevron-down" :size="19" class="swipe-chevron-icon"/></span>
    </button>
  </div>
  <slot v-else/>
</template>
<style scoped>
.swipe-row{position:relative;overflow:hidden;min-width:0;max-width:100%;
  touch-action:pan-y;isolation:isolate}
.swipe-content{position:relative;z-index:1;background:#fff;min-width:0;max-width:100%;
  transition:transform .18s ease-out;will-change:transform}
.is-dragging .swipe-content{transition:none}
.swipe-actions{position:absolute;right:0;inset-block:0;display:flex;align-items:stretch;z-index:0;background:#fff;
  /* Hidden action backgrounds can bleed through at iOS compositing edges. */
  visibility:hidden}
.swipe-row.is-open .swipe-actions,.swipe-row.is-dragging .swipe-actions{visibility:visible}
.swipe-actions button{border:0;border-radius:0;color:#fff;font-size:12px;font-weight:700;
  min-width:72px;max-width:72px;padding:0 5px}
.swipe-actions .edit{background:#558bc9}
.swipe-actions .delete{background:#d76178}
.swipe-trigger{position:absolute;z-index:2;right:0;top:8px;
  height:44px;width:44px;display:grid;place-items:center;background:transparent;
  border:0;color:#829c8c;border-radius:8px;touch-action:manipulation}
.swipe-chevron{display:grid;place-items:center;width:26px;height:28px;
  border-radius:9px;background:#f0f4f0;color:#789182}
.swipe-chevron-icon{transform:rotate(90deg)}
.swipe-trigger:active .swipe-chevron{background:#e6eee7}
.swipe-discovery{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:7px 10px;margin:0 0 5px;border:1px solid #dce9df;
  border-radius:10px;background:#f2f8f3;color:#557360;
  font-size:11px;line-height:1.4}
.swipe-discovery-arrow{font-size:18px;color:#43866a;font-weight:700;flex:none}
.swipe-discovery button{margin-left:auto;border:0;background:#e4f0e6;color:#397e5f;
  border-radius:8px;min-height:34px;padding:5px 10px;font-size:11px;font-weight:700}
.swipe-row:focus-visible{outline:2px solid #43866a;outline-offset:-2px}
@media(pointer:coarse){.swipe-discovery button{min-height:44px}}
.swipe-actions button:active{filter:brightness(.92)}
.swipe-trigger:hover{background:#f0f5f1}
.swipe-trigger .swipe-chevron{pointer-events:none}
.swipe-trigger:focus-visible,.swipe-actions button:focus-visible{
  outline:2px solid #244f3a;outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.swipe-content{transition:none}}
</style>
