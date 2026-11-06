<script setup lang="ts">
import {computed,ref} from 'vue'
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate'
import {listLocalPhotos,restoreLocalPhoto} from '../local-media'
import AppIcon from './AppIcon.vue'
import PageToast from './PageToast.vue'
import {usePageToast} from '../page-toast'
const props=defineProps<{userId:string}>()
const backupStorageKey='homeflow-last-local-export:'+props.userId
const lastExportAt=ref('')
try{lastExportAt.value=localStorage.getItem(backupStorageKey)||''}catch{}
const backupOld=computed(()=>!lastExportAt.value||
  !Number.isFinite(Date.parse(lastExportAt.value))||
  Date.now()-Date.parse(lastExportAt.value)>30*86400000)
type Snapshot={format:string;schemaVersion:number;records:Record<string,Record<string,unknown>[]>;exportedAt?:string}
const order=['familyProfiles','wishes','trips','goals','tasks','anniversaries','routines','shopping','shoppingExpenseLinks','memories',
  'petHealth','routineMarks','tripProgress','financeLinks','financeTargetSettings','goalPeriodAdjustments','goalPeriodSettlements','planCompletionMarks','reminderSnoozes','reminderPreferences','reminderItemPreferences']
const pending=ref(false),error=ref(''),status=ref(''),preview=ref<Snapshot|null>(null)
const {toast,notify}=usePageToast()
const selectedFile=ref<File|null>(null),photos=ref<Record<string,Uint8Array>>({}),restoreCounts=ref<Record<string,number>>({})
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
    const files:Record<string,Uint8Array>={'homeflow.json':strToU8(JSON.stringify(snapshot))}
    let size=files['homeflow.json'].byteLength,count=0
    // Photos are only available on this device; other devices have separate local photo caches.
    for(const m of snapshot.records.memories||[]){
      const id=String(m.id)
      if(!/^[0-9a-f-]{36}$/i.test(id))continue
      const blobs=await listLocalPhotos(props.userId,id)
      for(let i=0;i<blobs.length;i++){
        const bytes=new Uint8Array(await blobs[i].arrayBuffer())
        size+=bytes.length;count++
        if(size>50*1024*1024)throw Error('本机照片超过单次 50MB 备份上限，请先逐张导出照片')
        files['photos/'+id+'/'+String(i+1).padStart(4,'0')+'.jpg']=bytes
      }
    }
    const archive=zipSync(files,{level:0})
    save(archive,'homeflow-backup-'+new Date().toISOString().slice(0,10)+'.zip','application/zip')
    lastExportAt.value=new Date().toISOString()
    try{localStorage.setItem(backupStorageKey,lastExportAt.value)}catch{}
    notify('备份文件已生成：'+Object.values(snapshot.records).reduce((n,list)=>n+list.length,0)+' 条记录，'+count+' 张本机照片')
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
  }catch(e){
    error.value='恢复未全部完成：'+(e as Error).message+'。已有记录未被覆盖，可以重新导入继续。'
  }finally{pending.value=false}
}
</script>
<template>
  <section class="backup">
    <h2 class="backup-title"><AppIcon name="archive" :size="20" /> 备份与恢复</h2>
    <p>仅备份当前账号及本机照片。</p>
    <small v-if="lastExportAt">上次备份：{{ lastExportAt.slice(0,10) }}</small>
    <small v-if="backupOld">本机照片请定期备份。</small>
    <button :disabled="pending" @click="exportArchive">下载备份</button>
    <small>恢复仅补充缺失记录，不会覆盖已存在的记录或撤销误编辑。两位家庭成员请各自备份，并保管好本机照片 ZIP。</small>
    <label class="import-label">恢复备份（ZIP / JSON）
      <input type="file" accept=".zip,.json,application/zip,application/json"
        :disabled="pending" @change="chooseArchive(($event.target as HTMLInputElement).files?.[0]||null)"/>
    </label>
    <div v-if="preview" class="preview">
      <b>预览：{{ preview.exportedAt||'未知日期' }}</b>
      <p v-for="key in order" :key="key" v-show="preview.records[key]?.length">
        {{ key }}：{{ preview.records[key]?.length||0 }} 条</p>
      <button :disabled="pending" @click="restore">确认恢复缺失记录与照片</button>
    </div>
    <p v-if="status" class="success" role="status">{{ status }}</p>
    <PageToast :toast="toast" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <small>恢复不会覆盖原记录；不含密码、未同步任务及云端照片。</small>
  </section>
</template>
<style scoped>
.backup{background:#fff;border:1px solid #eeeae4;border-radius:18px;padding:20px;margin:16px 0}
.backup h2{font-size:17px}.backup-title{display:flex;align-items:center;gap:9px}.backup p,.backup small{color:#849187;font-size:12px;line-height:1.7}
.backup button{background:#468b6e;border:0;color:white;border-radius:10px;padding:10px 14px;font-size:13px}
.backup button:disabled{opacity:.5}.import-label{display:grid;gap:8px;color:#64756b;font-size:12px;margin-top:18px}
.import-label input{width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #e4e7e0;padding:10px;border-radius:10px}
.preview{background:#edf5ec;padding:12px;border-radius:12px;margin-top:14px}.preview b{font-size:13px}
.preview p{font-size:11px;margin:3px 0}.preview button{margin-top:10px}
.backup .error{color:#a94d37}.backup .success{color:#3c8566}
</style>
