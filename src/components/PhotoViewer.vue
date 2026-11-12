<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {compressPhoto} from '../local-media'

const props=withDefaults(defineProps<{
 src:string;title:string;canEdit:boolean;canDelete:boolean;busy?:boolean
}>(),{busy:false})
const emit=defineEmits<{close:[];delete:[];save:[photo:Blob]}>()
const dialog=ref<HTMLElement|null>(null)
const stage=ref<HTMLElement|null>(null)
const imageElement=ref<HTMLImageElement|null>(null)
const editMode=ref(false),working=ref(false),error=ref('')
const angle=ref(0),cropSquare=ref(false),editedUrl=ref('')
const displayed=computed(()=>editedUrl.value||props.src)
const zoom=ref(1),panX=ref(0),panY=ref(0),gesturing=ref(false)
let pinchStart:{distance:number;scale:number;midX:number;midY:number;x:number;y:number}|null=null
let dragStart:{x:number;y:number;panX:number;panY:number}|null=null
let moved=false,justPinched=false,lastTap=0
function resetZoom(){
 zoom.value=1;panX.value=0;panY.value=0
 pinchStart=null;dragStart=null;gesturing.value=false
}
watch(()=>props.src,resetZoom)
function clampPan(){
 const image=imageElement.value,container=stage.value
 if(!image||!container)return
 const maxX=Math.max(0,(image.offsetWidth*zoom.value-container.clientWidth)/2)
 const maxY=Math.max(0,(image.offsetHeight*zoom.value-container.clientHeight)/2)
 panX.value=Math.max(-maxX,Math.min(maxX,panX.value))
 panY.value=Math.max(-maxY,Math.min(maxY,panY.value))
}
function toggleZoom(){
 if(zoom.value>1){resetZoom();return}
 zoom.value=2
 panX.value=0;panY.value=0
}
function pinchDistance(a:Touch,b:Touch){
 return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)
}
function onPhotoTouchStart(event:TouchEvent){
 if(event.touches.length>=2){
  const a=event.touches[0],b=event.touches[1]
  pinchStart={distance:Math.max(1,pinchDistance(a,b)),scale:zoom.value,
   midX:(a.clientX+b.clientX)/2,midY:(a.clientY+b.clientY)/2,
   x:panX.value,y:panY.value}
  dragStart=null;gesturing.value=true;justPinched=true
 }else if(event.touches.length===1&&zoom.value>1){
  const a=event.touches[0]
  dragStart={x:a.clientX,y:a.clientY,panX:panX.value,panY:panY.value}
  gesturing.value=true;moved=false
 }
}
function onPhotoTouchMove(event:TouchEvent){
 if(event.touches.length>=2&&pinchStart){
  const a=event.touches[0],b=event.touches[1]
  zoom.value=Math.max(1,Math.min(4,
   pinchStart.scale*pinchDistance(a,b)/pinchStart.distance))
  panX.value=pinchStart.x+(a.clientX+b.clientX)/2-pinchStart.midX
  panY.value=pinchStart.y+(a.clientY+b.clientY)/2-pinchStart.midY
  clampPan()
 }else if(event.touches.length===1&&dragStart&&zoom.value>1){
  const a=event.touches[0],dx=a.clientX-dragStart.x,dy=a.clientY-dragStart.y
  if(Math.abs(dx)>8||Math.abs(dy)>8)moved=true
  panX.value=dragStart.panX+dx;panY.value=dragStart.panY+dy
  clampPan()
 }
}
function onPhotoTouchEnd(event:TouchEvent){
 if(event.touches.length>=2)return
 if(event.touches.length===1){
  pinchStart=null
  const a=event.touches[0]
  dragStart={x:a.clientX,y:a.clientY,panX:panX.value,panY:panY.value}
  return
 }
 const wasMoving=moved
 pinchStart=null;dragStart=null;gesturing.value=false;moved=false
 if(justPinched){justPinched=false;lastTap=0;return}
 if(wasMoving||event.changedTouches.length!==1){lastTap=0;return}
 const now=Date.now()
 if(lastTap&&now-lastTap<300){toggleZoom();lastTap=0}
 else lastTap=now
}
let source:HTMLCanvasElement|null=null,output:Blob|null=null
let restore={position:'',top:'',width:'',overflow:''},scrollY=0,previousFocus:HTMLElement|null=null

onMounted(()=>{
 previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
 scrollY=window.scrollY
 restore={position:document.body.style.position,top:document.body.style.top,
  width:document.body.style.width,overflow:document.body.style.overflow}
 document.body.style.position='fixed'
 document.body.style.top=-scrollY+'px'
 document.body.style.width='100%'
 document.body.style.overflow='hidden'
 void nextTick(()=>dialog.value?.focus({preventScroll:true}))
})
onBeforeUnmount(()=>{
 if(editedUrl.value)URL.revokeObjectURL(editedUrl.value)
 document.body.style.position=restore.position
 document.body.style.top=restore.top
 document.body.style.width=restore.width
 document.body.style.overflow=restore.overflow
 window.scrollTo(0,scrollY)
 previousFocus?.focus({preventScroll:true})
})
function close(){if(!props.busy&&!working.value)emit('close')}
function keydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
}
async function beginEdit(){
 if(!props.canEdit||props.busy||working.value)return
 working.value=true;error.value=''
 try{
  // iOS installed PWAs can reject fetch(blob:...) after a session-cache
  // object URL was revoked, even while the already decoded <img> is visible.
  // Snapshot that displayed image *before* replacing its src with editedUrl.
  // This uses no extra R2 request or device storage.
  const visible=imageElement.value
  if(!visible)throw Error('照片尚未加载，请稍后重试')
  if(!visible.complete||!visible.naturalWidth||!visible.naturalHeight){
   try{await visible.decode()}catch{throw Error('照片未能加载，请关闭后重试')}
  }
  if(!visible.naturalWidth||!visible.naturalHeight)
   throw Error('照片尚未加载，请稍后重试')
  const frozen=document.createElement('canvas')
  frozen.width=visible.naturalWidth;frozen.height=visible.naturalHeight
  const context=frozen.getContext('2d')
  if(!context)throw Error('无法处理照片')
  context.drawImage(visible,0,0)
  source=frozen
  editMode.value=true;angle.value=0;cropSquare.value=false;resetZoom()
  await render()
 }catch(e){error.value=(e as Error).message;editMode.value=false;source=null;output=null}
 finally{working.value=false}
}
async function render(){
 if(!source)return
 const rotated=angle.value%180!==0
 const naturalW=rotated?source.height:source.width
 const naturalH=rotated?source.width:source.height
 const dimension=Math.max(naturalW,naturalH)
 const scale=Math.min(1,1600/dimension)
 const width=Math.max(1,Math.round((cropSquare.value?Math.min(naturalW,naturalH):naturalW)*scale))
 const height=Math.max(1,Math.round((cropSquare.value?Math.min(naturalW,naturalH):naturalH)*scale))
 const canvas=document.createElement('canvas')
 canvas.width=width;canvas.height=height
 const ctx=canvas.getContext('2d')
 if(!ctx)throw Error('无法处理照片')
 ctx.translate(width/2,height/2)
 ctx.rotate(angle.value*Math.PI/180)
 ctx.drawImage(source,-source.width*scale/2,-source.height*scale/2,
  source.width*scale,source.height*scale)
 const raw=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(
  b=>b?resolve(b):reject(Error('照片处理失败')),'image/jpeg',0.83))
 output=await compressPhoto(new File([raw],'edited.jpg',{type:'image/jpeg'}))
 if(editedUrl.value)URL.revokeObjectURL(editedUrl.value)
 editedUrl.value=URL.createObjectURL(output)
}
async function transform(rotation:number,crop?:boolean){
 if(working.value||props.busy)return
 working.value=true;error.value=''
 try{
  angle.value=(angle.value+rotation)%360
  if(crop!==undefined)cropSquare.value=crop
  await render()
 }catch(e){error.value=(e as Error).message}
 finally{working.value=false}
}
function cancelEdit(){
 resetZoom()
 editMode.value=false;source=null;output=null
 if(editedUrl.value)URL.revokeObjectURL(editedUrl.value)
 editedUrl.value='';error.value=''
}
function save(){
 if(!output||props.busy||working.value)return
 emit('save',output)
}
</script>

<template>
 <Teleport to="body">
  <div class="photo-viewer-layer" @keydown="keydown">
   <div class="photo-viewer-backdrop" @click="close"></div>
   <section ref="dialog" class="photo-viewer" role="dialog" aria-modal="true"
     aria-label="照片预览" tabindex="-1">
    <header class="photo-viewer-header">
     <span class="photo-viewer-title">{{ title }}</span>
     <div class="photo-viewer-header-actions">
      <button type="button" class="photo-viewer-zoom" :disabled="busy||working"
        :aria-label="zoom>1?'还原照片比例':'放大照片两倍'"
        @click="toggleZoom">{{ zoom>1?'还原':'放大' }}</button>
      <button type="button" class="photo-viewer-close" aria-label="关闭照片" :disabled="busy||working" @click="close">×</button>
     </div>
    </header>
    <div ref="stage" class="photo-viewer-stage" :class="{'is-gesturing':gesturing}"
      @touchstart.passive="onPhotoTouchStart" @touchmove.prevent="onPhotoTouchMove"
      @touchend="onPhotoTouchEnd" @touchcancel="onPhotoTouchEnd">
     <img ref="imageElement" :src="displayed" :alt="title"
       :style="{transform:'translate('+panX+'px,'+panY+'px) scale('+zoom+')'}" draggable="false"/>
    </div>
    <p v-if="error" class="photo-viewer-error" role="alert">{{ error }}</p>
    <div v-if="editMode" class="photo-viewer-tools">
     <button type="button" :disabled="busy||working" @click="transform(90)">旋转 90°</button>
     <button type="button" :disabled="busy||working" @click="transform(0,!cropSquare)">
      {{ cropSquare?'恢复比例':'裁剪正方形' }}</button>
    </div>
    <footer class="photo-viewer-actions">
     <template v-if="editMode">
      <button type="button" :disabled="busy||working" @click="cancelEdit">取消</button>
      <button type="button" class="main" :disabled="busy||working" @click="save">保存</button>
     </template>
     <template v-else>
      <button v-if="canEdit" type="button" :disabled="busy||working" @click="beginEdit">编辑</button>
      <button v-if="canDelete" type="button" class="danger" :disabled="busy||working" @click="emit('delete')">删除</button>
     </template>
    </footer>
   </section>
  </div>
 </Teleport>
</template>

<style scoped>
.photo-viewer-layer{position:fixed;inset:0;z-index:11000;isolation:isolate;pointer-events:none}
.photo-viewer-backdrop{position:absolute;inset:0;background:rgb(7 15 11 / 91%);pointer-events:auto}
.photo-viewer{position:absolute;inset:0;display:flex;flex-direction:column;align-items:stretch;
 pointer-events:auto;color:#fff;outline:none}
.photo-viewer-header{display:flex;align-items:center;justify-content:space-between;gap:12px;
 padding:calc(env(safe-area-inset-top) + 12px) 18px 12px;flex:none}
.photo-viewer-title{min-width:0;flex:1;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.photo-viewer-header-actions{display:flex;align-items:center;gap:9px;flex:none}
.photo-viewer-zoom{min-width:52px;min-height:44px;padding:7px 10px;border:1px solid #ffffff50;
 border-radius:11px;background:#ffffff24;color:white;font-size:13px;font-weight:700}
.photo-viewer-close{width:44px;height:44px;border:0;color:#fff;background:#ffffff21;
 border-radius:50%;font-size:28px;line-height:1}
.photo-viewer-stage{display:flex;align-items:center;justify-content:center;min-height:0;flex:1;overflow:hidden;
 padding:10px 12px;touch-action:none;overscroll-behavior:contain}
.photo-viewer-stage img{display:block;max-width:100%;max-height:100%;object-fit:contain;
 transform-origin:center;transition:transform .18s ease-out;user-select:none;-webkit-user-drag:none}
.photo-viewer-stage.is-gesturing img{transition:none}
.photo-viewer-actions,.photo-viewer-tools{display:flex;justify-content:center;gap:12px;flex:none;
 padding:12px 18px calc(16px + env(safe-area-inset-bottom))}
.photo-viewer-tools{padding-bottom:4px}
.photo-viewer-actions button,.photo-viewer-tools button{min-height:44px;touch-action:manipulation;border:1px solid #ffffff50;color:#fff;
 border-radius:12px;padding:11px 18px;font-size:14px;min-width:90px;background:#ffffff24}
.photo-viewer-actions .main{background:#43866a;border-color:#43866a}
.photo-viewer-actions .danger{background:#8b3338;border-color:#a7494b}
.photo-viewer-actions button:disabled,.photo-viewer-tools button:disabled{opacity:.45}
.photo-viewer-error{font-size:12px;color:#ffd0c5;text-align:center;padding:0 12px}
@media(max-width:520px){.photo-viewer-header{padding-inline:14px}.photo-viewer-actions,.photo-viewer-tools{gap:8px;padding-inline:14px}.photo-viewer-actions button,.photo-viewer-tools button{min-width:0;flex:1;padding-inline:10px;font-size:14px}}
@media(prefers-reduced-motion:reduce){.photo-viewer-layer *{animation:none!important;transition:none!important}}
</style>
