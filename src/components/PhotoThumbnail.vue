<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref,watch,nextTick} from 'vue'
import {readPhoto} from '../photo-session-cache'

const props=defineProps<{id:string;userId:string;title:string}>()
const emit=defineEmits<{open:[url:string]}>()
const button=ref<HTMLElement|null>(null),url=ref(''),error=ref(false)
let observer:IntersectionObserver|null=null,live=true,revision=0
async function load(){
 const request=++revision
 error.value=false
 try{
  const result=await readPhoto(props.userId,props.id)
  if(live&&request===revision)url.value=result
 }catch{if(live&&request===revision)error.value=true}
}
function watchVisibility(){
 observer?.disconnect()
 if(!button.value)return
 if(!('IntersectionObserver' in window)){void load();return}
 observer=new IntersectionObserver(entries=>{
  if(entries.some(entry=>entry.isIntersecting)){
   observer?.disconnect()
   void load()
  }
 },{rootMargin:'0px 0px 24px 0px'})
 observer.observe(button.value)
}
async function open(){
 if(!url.value)await load()
 if(url.value)emit('open',url.value)
}
onMounted(()=>{live=true;void nextTick(watchVisibility)})
watch(()=>[props.id,props.userId],()=>{
 revision++;url.value='';error.value=false
 void nextTick(watchVisibility)
})
onBeforeUnmount(()=>{live=false;revision++;observer?.disconnect()})
</script>

<template>
 <button ref="button" type="button" class="photo-tile" :aria-label="'放大查看：'+title" @click.stop="open">
  <img v-if="url" :src="url" :alt="title" loading="lazy"/>
  <span v-else class="photo-placeholder">{{ error?'点按重试':'照片' }}</span>
 </button>
</template>

<style scoped>
.photo-tile{display:block;width:100%;padding:0;margin:0!important;border:0;border-radius:12px;
 background:#edf2ed;aspect-ratio:1;overflow:hidden;cursor:zoom-in;touch-action:pan-y}
.photo-tile img{display:block;width:100%;height:100%;object-fit:cover}
.photo-placeholder{display:grid;place-items:center;width:100%;height:100%;color:#88988b;
 font-size:12px}
.photo-tile:focus-visible{outline:3px solid #43866a;outline-offset:2px}
</style>
