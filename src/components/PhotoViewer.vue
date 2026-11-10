<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue'
import {compressPhoto} from '../local-media'

const props=withDefaults(defineProps<{
 src:string;title:string;canEdit:boolean;canDelete:boolean;busy?:boolean
}>(),{busy:false})
const emit=defineEmits<{close:[];delete:[];save:[photo:Blob]}>()
const dialog=ref<HTMLElement|null>(null)
const editMode=ref(false),working=ref(false),error=ref('')
const angle=ref(0),cropSquare=ref(false),editedUrl=ref('')
const displayed=computed(()=>editedUrl.value||props.src)
let source:HTMLImageElement|null=null,output:Blob|null=null
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
  const response=await fetch(props.src,{cache:'no-store'})
  if(!response.ok)throw Error('无法打开照片，请稍后重试')
  const input=URL.createObjectURL(await response.blob())
  try{
   const img=new Image()
   img.src=input
   await img.decode()
   source=img
  }finally{URL.revokeObjectURL(input)}
  editMode.value=true;angle.value=0;cropSquare.value=false
  await render()
 }catch(e){error.value=(e as Error).message;editMode.value=false}
 finally{working.value=false}
}
async function render(){
 if(!source)return
 const rotated=angle.value%180!==0
 const naturalW=rotated?source.naturalHeight:source.naturalWidth
 const naturalH=rotated?source.naturalWidth:source.naturalHeight
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
 ctx.drawImage(source,-source.naturalWidth*scale/2,-source.naturalHeight*scale/2,
  source.naturalWidth*scale,source.naturalHeight*scale)
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
     <button type="button" class="photo-viewer-close" aria-label="关闭照片" :disabled="busy||working" @click="close">×</button>
    </header>
    <div class="photo-viewer-stage">
     <img :src="displayed" :alt="title"/>
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
.photo-viewer-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.photo-viewer-close{width:44px;height:44px;border:0;color:#fff;background:#ffffff21;
 border-radius:50%;font-size:28px;line-height:1}
.photo-viewer-stage{display:flex;align-items:center;justify-content:center;min-height:0;flex:1;overflow:auto;
 padding:10px 12px;touch-action:pinch-zoom}
.photo-viewer-stage img{display:block;max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none}
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
@media(prefers-reduced-motion:reduce){.photo-viewer-layer *{animation:none!important}}
</style>
