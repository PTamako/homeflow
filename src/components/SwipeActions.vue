<script setup lang="ts">
import {computed,onBeforeUnmount,ref} from 'vue'
import {activeSwipeId} from '../swipe-state'

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
const emit=defineEmits<{edit:[];delete:[]}>()
const key=computed(()=>props.scope+':'+props.id)
const opened=computed(()=>activeSwipeId.value===key.value)
const count=computed(()=>Number(props.allowEdit)+Number(props.allowDelete))
const actionWidth=computed(()=>count.value*68)
const movement=ref(0)
const dragging=ref(false)
let touchStart:{x:number;y:number}|null=null
let axis:'horizontal'|'vertical'|null=null
let touchedAt=0
function open(){if(count.value)activeSwipeId.value=key.value}
function close(){if(opened.value)activeSwipeId.value=''}
function toggle(){opened.value?close():open()}
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
    dx<0?open():close()
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
onBeforeUnmount(close)
</script>
<template>
  <div v-if="count" class="swipe-row" :class="{'is-open':opened,'is-dragging':dragging}"
    @touchstart.passive="start" @touchmove.passive="move" @touchend="end" @touchcancel="cancel">
    <div class="swipe-actions" :style="{width:actionWidth+'px'}">
      <button v-if="allowEdit" type="button" class="edit" :tabindex="opened?0:-1"
        :aria-label="editLabel" @click.stop="run('edit')">{{ editLabel }}</button>
      <button v-if="allowDelete" type="button" class="delete" :tabindex="opened?0:-1"
        :aria-label="deleteLabel" @click.stop="run('delete')">{{ deleteLabel }}</button>
    </div>
    <div class="swipe-content" :style="{
      transform:'translateX('+((opened?-actionWidth:0)+movement)+'px)',
      paddingRight:showTrigger?'25px':'0px'
    }" @click.capture="tapContent">
      <slot/>
    </div>
    <button v-if="showTrigger&&!opened" type="button" class="swipe-trigger"
      :aria-label="'左滑或点击展开'+(allowEdit?editLabel:'')+(allowEdit&&allowDelete?'和':'')+(allowDelete?deleteLabel:'')"
      :aria-expanded="opened" :title="'左滑'+(allowEdit?editLabel:'')+(allowDelete?'/'+deleteLabel:'')"
      @click.stop="toggle">
      <span class="swipe-stripes" aria-hidden="true">
        <span v-if="allowEdit" class="stripe-edit"></span>
        <span v-if="allowDelete" class="stripe-delete"></span>
      </span>
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
.swipe-actions{position:absolute;right:0;inset-block:0;display:flex;align-items:stretch;z-index:0;
  /* Hidden action backgrounds can bleed through at iOS compositing edges. */
  visibility:hidden}
.swipe-row.is-open .swipe-actions,.swipe-row.is-dragging .swipe-actions{visibility:visible}
.swipe-actions button{border:0;border-radius:0;color:#fff;font-size:12px;font-weight:700;
  min-width:68px;max-width:68px;padding:0 4px}
.swipe-actions .edit{background:#558bc9}
.swipe-actions .delete{background:#d76178}
.swipe-trigger{position:absolute;z-index:2;right:0;top:8px;
  height:34px;width:25px;display:grid;place-items:center;background:transparent;
  border:0;color:#829c8c;border-radius:8px;touch-action:manipulation}
.swipe-stripes{display:flex;align-items:center;justify-content:center;gap:3px;width:100%;height:100%}
.swipe-stripes span{display:block;width:3px;height:19px;border-radius:3px}
.stripe-edit{background:#558bc9}
.stripe-delete{background:#d76178}
.swipe-trigger:active .swipe-stripes{opacity:.75}
.swipe-trigger:focus-visible,.swipe-actions button:focus-visible{
  outline:2px solid #244f3a;outline-offset:-2px}
@media(prefers-reduced-motion:reduce){.swipe-content{transition:none}}
</style>
