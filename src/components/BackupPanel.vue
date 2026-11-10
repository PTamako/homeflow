<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate'
import {listLocalPhotos,restoreLocalPhoto} from '../local-media'
import AppIcon from './AppIcon.vue'
import PageToast from './PageToast.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{userId:string}>()
const backupStorageKey='homeflow-last-local-export:'+props.userId
const lastExportAt=ref('')
try{lastExportAt.value=localStorage.getItem(backupStorageKey)||''}catch{}
type Snapshot={format:string;schemaVersion:number;records:Record<string,Record<string,unknown>[]>;exportedAt?:string}
const order=['familyProfiles','wishes','trips','goals','tasks','anniversaries','routines','shopping','shoppingExpenseLinks','memories',
  'petHealth','routineAssignments','routineMarks','tripProgress','financeLinks','financeTargetSettings','goalPeriodAdjustments','goalPeriodSettlements','planCompletionMarks','todayPlanActions','reminderSnoozes','reminderPreferences','reminderItemPreferences']
// An immutable audit attachment is kept for manual verification and D1 recovery,
 // never re-imported as awards, which would duplicate family points.
const auditOrder=['rewardItems','rewardRedemptions','rewardGroupOrders',
 'rewardGroupContributions','lotteryDraws','lotteryCoupons','rewardCouponDiscounts','completionPoints',
 'completionAdjustments','dualSplits','shoppingPoints','shoppingJoint',
 'weeklyChallenges','goalRewards','tripRewards','monthlyAchievements']
const pending=ref(false),error=ref(''),status=ref(''),preview=ref<Snapshot|null>(null)
const restoreSheetOpen=ref(false)
const helpOpen=ref(false)
const helpAnchor=ref<HTMLElement|null>(null)
function closeHelpOnOutside(event:PointerEvent){
  if(helpOpen.value&&!helpAnchor.value?.contains(event.target as Node))helpOpen.value=false
}
function closeHelpOnEscape(event:KeyboardEvent){
  if(event.key==='Escape')helpOpen.value=false
}
onMounted(()=>{
  document.addEventListener('pointerdown',closeHelpOnOutside)
  document.addEventListener('keydown',closeHelpOnEscape)
})
onBeforeUnmount(()=>{
  document.removeEventListener('pointerdown',closeHelpOnOutside)
  document.removeEventListener('keydown',closeHelpOnEscape)
})
const {toast,notify}=usePageToast()
const selectedFile=ref<File|null>(null),photos=ref<Record<string,Uint8Array>>({}),restoreCounts=ref<Record<string,number>>({})
const previewRecordCount=computed(()=>preview.value?Object.values(preview.value.records).reduce((count,items)=>count+items.length,0):0)
const previewPhotoCount=computed(()=>Object.keys(photos.value).length)
function bodyOk(snapshot:any):snapshot is Snapshot{
  if(!snapshot||snapshot.format!=='homeflow.portable'||snapshot.schemaVersion!==1||
    !snapshot.records||typeof snapshot.records!=='object')return false
  return order.every(key=>!snapshot.records[key]||
    (Array.isArray(snapshot.records[key])&&snapshot.records[key].length<=50000))
}
async function api(path:string,method='GET',payload?:unknown){
  const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
    ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})})
  const data=await response.json()
  if(!response.ok)throw Error(data.error||'server_error')
  return data
}
function save(bytes:Uint8Array,filename:string,type:string){
  const url=URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type}))
  const a=document.createElement('a')
  a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a)
  a.click();a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),30000)
}
async function exportArchive(){
  pending.value=true;error.value='';status.value=''
  try{
    // Manual export: one bounded D1 dataset page per request. No background scans.
    const snapshot:Snapshot={format:'homeflow.portable',schemaVersion:1,records:{},
      exportedAt:new Date().toISOString()}
    for(const key of order){
      const records:Record<string,unknown>[]=[]
      let cursor:string|null=null
      do{
        const page=await api('/portable?dataset='+encodeURIComponent(key)+
          (cursor?'&cursor='+encodeURIComponent(cursor):''))
        if(page.dataset!==key||!Array.isArray(page.items))throw Error('备份分页响应异常')
        records.push(...page.items)
        if(records.length>50000)throw Error('该类记录过多，请分批导出')
        cursor=typeof page.nextCursor==='string'?page.nextCursor:null
      }while(cursor)
      snapshot.records[key]=records
    }
    if(!bodyOk(snapshot))throw Error('备份内容校验失败')
    const audit:Record<string,Record<string,unknown>[]>={}
    for(const key of auditOrder){
      const entries:Record<string,unknown>[]=[]
      let cursor:string|null=null
      do{
        const page=await api('/portable/audit?dataset='+encodeURIComponent(key)+
          (cursor?'&cursor='+encodeURIComponent(cursor):''))
        if(page.dataset!==key||!Array.isArray(page.items))throw Error('积分历史归档读取失败')
        entries.push(...page.items)
        if(entries.length>50000)throw Error('积分历史过多，请联系管理员使用 D1 数据库备份')
        cursor=typeof page.nextCursor==='string'?page.nextCursor:null
      }while(cursor)
      audit[key]=entries
    }
    const files:Record<string,Uint8Array>={
      'homeflow.json':strToU8(JSON.stringify(snapshot)),
      'points-and-rewards-audit.json':strToU8(JSON.stringify({
        format:'homeflow.points-audit',schemaVersion:1,exportedAt:snapshot.exportedAt,
        scope:'shared-family-and-own-private',restorePolicy:'audit-only-no-replay',
        records:audit
      }))
    }
    let size=Object.values(files).reduce((total,part)=>total+part.byteLength,0),count=0
    if(size>50*1024*1024)throw Error('备份内容超过 50MB，请使用 D1 数据库备份')
    // Include device-only and private R2 photos, only for memories in this
    // authenticated user's export. No bucket/public URLs or object keys.
    for(const m of snapshot.records.memories||[]){
      const id=String(m.id)
      if(!/^[0-9a-f-]{36}$/i.test(id))continue
      let number=0
      const blobs=await listLocalPhotos(props.userId,id)
      for(const blob of blobs){
        const bytes=new Uint8Array(await blob.arrayBuffer())
        size+=bytes.length;count++;number++
        if(size>50*1024*1024)throw Error('照片超过单次 50MB 备份上限，请先逐张导出')
        files['photos/'+id+'/'+String(number).padStart(4,'0')+'.jpg']=bytes
      }
      const media=await fetch('/api/media?memoryId='+encodeURIComponent(id),{
        credentials:'same-origin',cache:'no-store'})
      if(!media.ok)throw Error('云端照片备份列表读取失败')
      const listing=await media.json() as {cloudAvailable?:boolean;items?:Array<{id:string}>}
      if(!listing.cloudAvailable)continue
      for(const item of listing.items||[]){
        const photo=await fetch('/api/media/'+encodeURIComponent(item.id),{
          credentials:'same-origin',cache:'no-store'})
        if(!photo.ok)throw Error('云端照片下载失败，请重试')
        const bytes=new Uint8Array(await photo.arrayBuffer())
        size+=bytes.length;count++;number++
        if(size>50*1024*1024)throw Error('照片超过单次 50MB 备份上限，请先逐张导出')
        files['photos/'+id+'/'+String(number).padStart(4,'0')+'.jpg']=bytes
      }
    }
    const archive=zipSync(files,{level:0})
    save(archive,'homeflow-backup-'+new Date().toISOString().slice(0,10)+'.zip','application/zip')
    lastExportAt.value=new Date().toISOString()
    try{localStorage.setItem(backupStorageKey,lastExportAt.value)}catch{}
    notify('备份文件已生成：'+Object.values(snapshot.records).reduce((n,list)=>n+list.length,0)+' 条记录，'+count+' 张本机和云端照片')
  }catch(e){error.value=(e as Error).message}
  finally{pending.value=false}
}
async function chooseArchive(file:File|null){
  selectedFile.value=file;preview.value=null;photos.value={};error.value='';status.value=''
  if(!file)return
  pending.value=true
  try{
    if(file.size>55*1024*1024)throw Error('备份文件超过 55MB')
    let snapshot:Snapshot
    if(file.name.toLowerCase().endsWith('.zip')){
      const raw=new Uint8Array(await file.arrayBuffer())
      let expanded=0
      const files=unzipSync(raw,{filter:fileInfo=>{
        if(fileInfo.originalSize>55*1024*1024)throw Error('单个备份文件过大')
        expanded+=fileInfo.originalSize
        if(expanded>65*1024*1024)throw Error('备份解压后过大')
        return fileInfo.name==='homeflow.json'||/^photos\/[0-9a-f-]{36}\/\d{4}\.jpg$/i.test(fileInfo.name)
      }})
      if(!files['homeflow.json'])throw Error('不是有效的 HomeFlow 备份')
      snapshot=JSON.parse(strFromU8(files['homeflow.json'])) as Snapshot
      for(const [key,data] of Object.entries(files)){
        if(/^photos\/[0-9a-f-]{36}\/\d{4}\.jpg$/i.test(key)){
          if(data.length>5*1024*1024)throw Error('照片文件过大')
          photos.value[key]=data
        }
      }
    }else if(file.name.toLowerCase().endsWith('.json')){
      snapshot=JSON.parse(await file.text()) as Snapshot
    }else throw Error('请选择 HomeFlow ZIP 或 JSON 文件')
    if(!bodyOk(snapshot))throw Error('备份版本或内容不正确')
    // Server validates all records before any import. A local preview never writes to D1.
    for(const key of order){
      const items=snapshot.records[key]||[]
      for(let start=0;start<items.length;start+=15){
        await api('/portable/restore','POST',{dataset:key,items:items.slice(start,start+15),preview:true})
      }
    }
    preview.value=snapshot
    notify('校验完成：可以恢复 '+Object.values(snapshot.records).reduce((n,a)=>n+a.length,0)+
      ' 条记录和 '+Object.keys(photos.value).length+' 张本机照片')
  }catch(e){error.value=(e as Error).message;preview.value=null}
  finally{pending.value=false}
}
async function restore(){
  if(!preview.value)return
  if(!confirm('确定恢复吗？只补充缺失记录，不覆盖现有内容。恢复中断后可以再次导入。'))return
  pending.value=true;error.value='';status.value='正在恢复…';restoreCounts.value={}
  try{
    const snapshot=preview.value
    for(const key of order){
      const items=snapshot.records[key]||[]
      for(let start=0;start<items.length;start+=15){
        const result=await api('/portable/restore','POST',
          {dataset:key,items:items.slice(start,start+15),confirm:true})
        restoreCounts.value[key]=(restoreCounts.value[key]||0)+Number(result.inserted||0)
      }
    }
    const ownMemories=new Set((snapshot.records.memories||[]).map(m=>String(m.id)))
    let restoredPhotos=0
    for(const [path,bytes] of Object.entries(photos.value)){
      const match=/^photos\/([0-9a-f-]{36})\/(\d{4})\.jpg$/i.exec(path)
      if(!match||!ownMemories.has(match[1]))continue
      const raw=new Uint8Array(bytes)
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw))
      const marker=Array.from(digest.slice(0,12),x=>x.toString(16).padStart(2,'0')).join('')
      await restoreLocalPhoto(props.userId,match[1],new Blob([raw.buffer as ArrayBuffer],{type:'image/jpeg'}),marker)
      restoredPhotos++
    }
    const count=Object.values(restoreCounts.value).reduce((n,i)=>n+i,0)
    status.value=''
    notify('恢复完成：新增 '+count+' 条记录，恢复照片 '+restoredPhotos+' 张')
    restoreSheetOpen.value=false
  }catch(e){
    error.value='恢复未全部完成：'+(e as Error).message+'。已有记录未被覆盖，可以重新导入继续。'
  }finally{pending.value=false}
}
</script>
<template>
  <section class="backup" aria-labelledby="backup-title">
    <div class="backup-heading">
      <h2 id="backup-title" class="backup-title"><AppIcon name="archive" :size="20" /> 备份与恢复</h2>
      <span ref="helpAnchor" class="backup-help">
        <button type="button" class="backup-help-trigger" aria-label="查看备份与恢复说明"
          aria-controls="backup-help-popover" :aria-expanded="helpOpen" @click="helpOpen=!helpOpen">
          <span class="backup-help-glyph" aria-hidden="true">?</span>
        </button>
        <div v-if="helpOpen" id="backup-help-popover" class="backup-help-popover" role="note">
          <strong>备份与恢复说明</strong>
          <p>恢复不会覆盖原记录，也无法撤销之前的误编辑。两位家庭成员需各自备份。</p>
          <p>ZIP 另含积分、抽奖、本人奖励券（含使用与到期）、商城折扣流水的只读核对档案。为避免重复发分或发券，恢复操作不会重新导入这类流水；完整账本灾难恢复需使用 D1 备份。</p>
          <p>不含密码、未同步任务和云端照片；其他设备的本机照片须分别备份。请妥善保存 ZIP 文件。</p>
        </div>
      </span>
    </div>
    <div class="backup-section">
      <div class="backup-section-head">
        <h3>下载备份</h3>
        <small v-if="lastExportAt">上次：{{ lastExportAt.slice(0,10) }}</small>
      </div>
      <p class="backup-caption">仅备份当前账号与本机照片，另附家庭积分只读历史档案；请先同步待办，其他设备需分别备份。</p>
      <button type="button" class="backup-download" :disabled="pending" @click="exportArchive">
        {{ pending?'处理中…':'下载备份' }}
      </button>
    </div>
    <div class="backup-section">
      <button type="button" class="backup-restore-entry" :aria-expanded="restoreSheetOpen" @click="restoreSheetOpen=true">恢复备份 · 选择文件</button>
      <EditBottomSheet v-if="restoreSheetOpen" title="恢复备份" :close-disabled="pending" @close="restoreSheetOpen=false">
      <div class="backup-restore-content">
      <p class="backup-caption">选择 ZIP / JSON 文件，仅补充缺失记录</p>
      <div class="backup-file-row">
        <label class="backup-file-picker" :class="{'backup-file-picker-disabled':pending}">
          选择文件
          <input class="backup-file-native" type="file"
            accept=".zip,.json,application/zip,application/json"
            aria-label="选择 HomeFlow 备份文件"
            :disabled="pending"
            @change="chooseArchive(($event.target as HTMLInputElement).files?.[0]||null)" />
        </label>
        <span class="backup-file-name" :title="selectedFile?.name||''">
          {{ selectedFile?.name||'未选择文件' }}
        </span>
      </div>
      <div v-if="preview" class="backup-preview">
        <p>校验通过：{{ previewRecordCount }} 条记录 · {{ previewPhotoCount }} 张本机照片</p>
        <button type="button" class="backup-restore" :disabled="pending" @click="restore">确认恢复</button>
      </div>
      </div>
      </EditBottomSheet>
    </div>
    <p v-if="status" class="success" role="status">{{ status }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <PageToast :toast="toast" />
  </section>
</template>
<style scoped>
.backup{display:grid;gap:0;min-width:0;max-width:100%;margin:12px 0;padding:18px;
  background:#fff;border:1px solid #e2ebe4;border-radius:16px;box-sizing:border-box}
.backup-heading{position:relative;display:flex;align-items:center;justify-content:flex-start;gap:5px;
  margin:0 0 6px;min-width:0;width:100%;box-sizing:border-box}
.backup-title{display:flex;align-items:center;gap:9px;margin:0;
  font-size:17px;line-height:1.4;color:#26392f}
.backup-help{position:static;display:inline-flex;align-items:center;flex:none}
.backup-help-trigger{display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border:0;
  border-radius:50%;background:transparent;color:#527962;appearance:none;-webkit-appearance:none}
.backup-help-glyph{display:inline-flex;align-items:center;justify-content:center;
  width:15px;height:15px;min-width:15px;min-height:15px;box-sizing:border-box;
  border:1px solid #b8ccc0;border-radius:50%;background:#f7faf7;
  font-size:10px;font-weight:700;line-height:1}
.backup-help-trigger:focus-visible{outline:2px solid #43866a;outline-offset:1px}
/* Position relative to the full heading, not the tiny ? icon: a 310px
   popup right-aligned to the icon extends off the left edge of an iPhone. */
.backup-help-popover{position:absolute;top:calc(100% + 6px);right:0;z-index:12;
  width:min(310px,100%);box-sizing:border-box;max-height:min(320px,65dvh);overflow-y:auto;
  padding:14px 15px;border:1px solid #d5e5d9;border-radius:12px;
  box-shadow:0 10px 28px #1d392827;background:#fff;color:#385643;
  font-size:12px;line-height:1.65;overflow-wrap:anywhere}
.backup-help-popover strong{display:block;margin-bottom:8px;font-size:13px}
.backup-help-popover p{margin:0 0 9px}
.backup-help-popover p:last-child{margin-bottom:0}
.backup-section{min-width:0;padding:14px 0 16px}
.backup-section+.backup-section{border-top:1px solid #e8eee9}
.backup-restore-entry{width:100%;border:1px solid #cdded2;border-radius:11px;background:#f7fbf7;color:#39785c;padding:12px;font-size:13px;font-weight:700;text-align:left}
.backup-restore-content{display:grid;gap:10px;min-width:0}
.backup-section h3{margin:0;font-size:14px;line-height:1.5;color:#26392f}
.backup-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.backup-section-head small{color:#829187;font-size:11px}
.backup .backup-caption{margin:3px 0 11px;font-size:12px;line-height:1.5;color:#76867b}
.backup-download,.backup-restore{display:flex;align-items:center;justify-content:center;
  min-height:44px;padding:10px 14px;border:0;border-radius:10px;box-sizing:border-box;
  background:#438669;color:#fff;font-size:13px;font-weight:700;line-height:1.3;
  touch-action:manipulation}
.backup-download{width:100%}
.backup-restore{width:100%;margin-top:10px}
.backup button:disabled{opacity:.5;cursor:not-allowed}
.backup-file-row{display:flex;align-items:center;gap:10px;min-width:0}
.backup-file-picker{position:relative;display:inline-flex;align-items:center;justify-content:center;
  flex:none;min-width:112px;min-height:44px;padding:10px 13px;
  box-sizing:border-box;border:1px solid #cbdcd0;border-radius:10px;
  background:#f4f8f5;color:#357b5c;font-size:13px;font-weight:650;
  overflow:hidden;cursor:pointer;touch-action:manipulation}
.backup-file-picker-disabled{opacity:.5;cursor:not-allowed}
.backup-file-native{position:absolute;inset:0;width:100%!important;height:100%!important;
  max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;
  border:0!important;border-radius:0!important;opacity:0;cursor:pointer}
.backup-file-native:focus-visible{outline:0}
.backup-file-picker:focus-within{outline:2px solid #43866a;outline-offset:2px}
.backup-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:#829187;font-size:12px}
.backup-preview{margin-top:12px;padding:12px;border:1px solid #dceade;border-radius:11px;background:#f7faf7}
.backup-preview p{margin:0;font-size:12px;line-height:1.5;color:#446851}
.backup .error,.backup .success{margin:8px 0 0;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.backup .error{color:#a94d37}.backup .success{color:#3c8566}
@media(max-width:380px){.backup{padding:14px}.backup-file-picker{min-width:104px}}
</style>
