<script setup lang="ts">
import {ref,watch,onBeforeUnmount,onMounted} from 'vue'
import {listLocalPhotos,saveLocalPhoto,downloadLocalPhoto,compressPhoto} from '../local-media'
import FinancePanel from './FinancePanel.vue'
import AppIcon from './AppIcon.vue'

const props=defineProps<{mode:'today'|'family'|'plans'|'memories';userId:string;isOwner:boolean;profileRevision:number;profiles:Array<{id:string;displayName:string;type:string}>}>()
type Row=Record<string,any>
const items=ref<Row[]>([]),other=ref<Row[]>([]),goals=ref<Row[]>([]),trips=ref<Row[]>([]),routines=ref<Row[]>([])
const error=ref(''),notice=ref(''),busy=ref(false),dueItems=ref<Row[]>([]),remindersLoaded=ref(false)
const eventTitle=ref(''),eventDate=ref(''),eventRepeat=ref('yearly')
const routineTitle=ref(''),routineRepeat=ref('daily'),intervalDays=ref(30),intervalAnchor=ref('fixed'),routineSubject=ref('')
const wishTitle=ref(''),wishType=ref('trip'),wishBudget=ref(0),wishVisibility=ref('household')
const goalTitle=ref(''),goalAmount=ref(100000),goalTarget=ref('')
const shoppingTitle=ref('')
function countdown(date:string){
  const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000)
  if(!Number.isFinite(days))return ''
  return days<=0?'今天':days===1?'明天 · 倒计时 1 天':'倒计时 '+days+' 天'
}
function routineLabel(r:Row){
  return r.repeat_type==='daily'?'每天':r.repeat_type==='weekly'?'每周':
    r.repeat_type==='monthly'?'每月':r.repeat_type==='interval'?'按间隔':
    r.repeat_type==='workday'?'工作日':'定期'
}
const memoryTitle=ref(''),memoryStory=ref(''),memoryDate=ref(new Date().toISOString().slice(0,10))
const photoFiles=ref<File[]>([]),photos=ref<Record<string,string[]>>({}),localPhotoBlobs=ref<Record<string,Blob[]>>({})
const cloudEnabled=ref(false),cloudPhotos=ref<Record<string,Array<{id:string;uploadedBy:string}>>>({})
const paste=ref(''),importTargetId=ref(''),preview=ref<Row|null>(null),tripDetail=ref<Row|null>(null),tripProgress=ref<Row[]>([])
let photoUrls:string[]=[]
let lastTodayValue=''
function refreshOnResume(){
  if(props.mode==='today' && document.visibilityState==='visible' && lastTodayValue!==today())void fetchMode()
}
async function api(path:string,method='GET',body?:unknown):Promise<any>{
  const response=await fetch('/api'+path,{method,cache:'no-store',credentials:'same-origin',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
  const data=await response.json()
  if(!response.ok)throw Error(String(data?.error||'server_error'))
  return data
}
async function fetchMode(){
  error.value=''
  try{
    if(props.mode==='today'){
      lastTodayValue=today()
      const [r,a]=await Promise.all([api('/routines/today'),api('/anniversaries/upcoming')])
      routines.value=r.items||[];items.value=a.items||[]
    }else if(props.mode==='family'){
      items.value=(await api('/anniversaries/upcoming')).items||[]
    }else if(props.mode==='plans'){
      const [w,g,s,t,r]=await Promise.all([api('/wishes'),api('/goals'),api('/shopping'),api('/trips'),api('/routines')])
      items.value=w.items||[];goals.value=g.items||[];other.value=s.items||[];trips.value=t.items||[];routines.value=r.items||[]
    }else if(props.mode==='memories'){
      items.value=(await api('/memories')).items||[]
      await loadPhotos()
    }
  }catch(e){error.value=(e as Error).message}
}
async function loadReminders(){
  try{const data=await api('/reminders');dueItems.value=data.items||[];remindersLoaded.value=true}
  catch(e){error.value=(e as Error).message}
}
async function update(action:()=>Promise<any>){
  error.value='';notice.value='';busy.value=true
  try{await action();await fetchMode();notice.value='已保存'}
  catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
function today(){const d=new Date(Date.now()+9*3600000);return d.toISOString().slice(0,10)}
async function addAnniversary(){
  if(!eventTitle.value.trim()||!eventDate.value)return
  await update(()=>api('/anniversaries','POST',{title:eventTitle.value,eventDate:eventDate.value,repeatMode:eventRepeat.value,advanceDays:[30,7,1,0],visibility:'household'}))
  if(!error.value){eventTitle.value='';eventDate.value=''}
}
async function addRoutine(){
  if(!routineTitle.value.trim())return
  const repeatConfig=routineRepeat.value==='interval'?{days:intervalDays.value}:routineRepeat.value==='monthly'?{day:Number(today().slice(8))}:
    routineRepeat.value==='weekly'?{weekdays:[new Date().getDay()]}:{}
  await update(()=>api('/routines','POST',{title:routineTitle.value,repeatType:routineRepeat.value,
    repeatConfig:{...repeatConfig,...(routineRepeat.value==='interval'?{anchor:intervalAnchor.value}:{})},anchorDate:today(),subjectProfileId:routineSubject.value||null,visibility:'household'}))
  if(!error.value)routineTitle.value=''
}
async function markRoutine(r:Row,done:boolean){
  await update(()=>api('/routines/'+r.id+'/mark','POST',{date:today(),status:done?'completed':'open'}))
}
async function addWish(){
  await update(()=>api('/wishes','POST',{title:wishTitle.value,wishType:wishType.value,
    estimatedAmount:Number(wishBudget.value),currency:'JPY',visibility:wishVisibility.value}))
  if(!error.value)wishTitle.value=''
}
async function addGoal(){
  await update(()=>api('/goals','POST',{title:goalTitle.value,targetAmount:Number(goalAmount.value),
    reservedAmount:0,currency:'JPY',targetOn:goalTarget.value||null,visibility:'household'}))
  if(!error.value)goalTitle.value=''
}
async function reserve(g:Row){
  const value=prompt('目前为这个目标预留了多少日元？（这不是实际存款交易）',String(g.reserved_amount||0))
  if(value===null)return
  const amount=Number(value)
  if(!Number.isSafeInteger(amount)||amount<0){error.value='请输入有效金额';return}
  await update(()=>api('/goals/'+g.id,'PATCH',{title:g.title,targetAmount:g.target_amount,
    reservedAmount:amount,currency:g.currency,targetOn:g.target_on,visibility:g.visibility,wishId:g.wish_id}))
}
async function addShopping(){
  await update(()=>api('/shopping','POST',{title:shoppingTitle.value,quantity:1,visibility:'household'}))
  if(!error.value)shoppingTitle.value=''
}
async function toggleShopping(x:Row){
  await update(()=>api('/shopping/'+x.id+'/toggle','POST',{completed:!x.completed_at}))
}
async function convertWish(w:Row){
  const destination=prompt('目的地（例如北海道）',w.title)
  if(!destination)return
  await update(()=>api('/wishes/'+w.id+'/start-trip','POST',{title:w.title,destination}))
}
async function selectTrip(id:string){
  try{const data=await api('/trips/'+id);tripDetail.value=data.trip;tripProgress.value=data.progress||[]}
  catch(e){error.value=(e as Error).message}
}
function itemDone(externalId:string){return !!tripProgress.value.find(p=>p.itemId===externalId&&p.completedAt)}
async function toggleTrip(id:string){
  if(!tripDetail.value)return
  try{
    await api('/trips/'+tripDetail.value.id+'/progress','POST',{itemId:id,completed:!itemDone(id)})
    await selectTrip(tripDetail.value.id)
  }catch(e){error.value=(e as Error).message}
}
async function previewTrip(){
  try{const data=JSON.parse(paste.value);const result=await api('/trips/import','POST',{preview:true,payload:data,targetTripId:importTargetId.value||null})
    preview.value={...result,payload:data};error.value=''}
  catch(e){preview.value=null;error.value=(e as Error).message}
}
async function importTrip(){
  if(!preview.value)return
  const change=preview.value.changes
  if(change==='update'&&!confirm('会更新原旅行内容，但不会删除已完成事项。确定更新吗？'))return
  await update(()=>api('/trips/import','POST',{payload:preview.value?.payload,
    visibility:'household',targetTripId:importTargetId.value||null,confirmReplace:change==='update'}))
  if(!error.value){paste.value='';preview.value=null}
}
async function removeCloudPhoto(id:string){
  if(!confirm('删除这张云端照片吗？本机原图不会删除。'))return
  try{
    await api('/media/'+id,'DELETE')
    await loadPhotos()
    notice.value='云端照片已删除'
  }catch(e){error.value=(e as Error).message}
}
async function addMemory(){
  if(!memoryTitle.value.trim()||!memoryDate.value)return
  error.value='';busy.value=true
  try{
    const result=await api('/memories','POST',{title:memoryTitle.value,story:memoryStory.value,
      happenedOn:memoryDate.value,visibility:'private'})
    if(result.id)for(const f of photoFiles.value.slice(0,10)){
      await saveLocalPhoto(props.userId,result.id,f)
      if(cloudEnabled.value){
        try{
          const compressed=await compressPhoto(f)
          const sent=await fetch('/api/media/upload?memoryId='+encodeURIComponent(result.id),{
            method:'POST',credentials:'same-origin',
            headers:{'content-type':'image/jpeg'},body:compressed})
          if(!sent.ok)notice.value='本机照片已保存，但云端备份部分失败'
        }catch{notice.value='本机照片已保存，但云端暂不可用'}
      }
    }
    memoryTitle.value='';memoryStory.value='';photoFiles.value=[]
    await fetchMode()
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function loadPhotos(){
  for(const x of photoUrls)URL.revokeObjectURL(x)
  photoUrls=[];photos.value={};localPhotoBlobs.value={};cloudPhotos.value={}
  try{
    const media=await api('/media')
    cloudEnabled.value=!!media.cloudAvailable
    for(const item of media.items||[]){
      if(!item.memoryId)continue
      if(!cloudPhotos.value[item.memoryId])cloudPhotos.value[item.memoryId]=[]
      cloudPhotos.value[item.memoryId].push({id:item.id,uploadedBy:item.uploadedBy})
    }
  }catch{cloudEnabled.value=false}
  for(const m of items.value.slice(0,30)){
    try{
      if(m.created_by!==props.userId)continue
      const list=await listLocalPhotos(props.userId,m.id)
      if(!list.length)continue
      localPhotoBlobs.value[m.id]=list
      photos.value[m.id]=list.map(b=>{const url=URL.createObjectURL(b);photoUrls.push(url);return url})
    }catch{ /* private local storage may be unavailable in some Safari modes */ }
  }
}
onMounted(()=>document.addEventListener('visibilitychange',refreshOnResume))
onBeforeUnmount(()=>{
  for(const x of photoUrls)URL.revokeObjectURL(x)
  document.removeEventListener('visibilitychange',refreshOnResume)
})
watch(()=>[props.mode,props.profileRevision],fetchMode,{immediate:true})
</script>

<template>
  <section class="life-area">
    <p v-if="error" role="alert" class="life-error">{{ error }}</p>
    <p v-if="notice" class="life-notice" role="status">{{ notice }}</p>

    <template v-if="mode==='today'">
      <section class="life-card">
        <div class="life-row"><b class="life-heading"><AppIcon name="bell" :size="19" /> 重要提醒</b><button class="life-link" @click="loadReminders">查看今天的提醒</button></div>
        <div v-if="remindersLoaded">
          <p v-if="!dueItems.length" class="life-empty">今天暂无新的重要提醒</p>
          <div v-for="x in dueItems" :key="x.kind+x.id" class="life-row">
            <span>{{ x.title }}</span><small>{{ x.dueOn }}</small>
          </div>
        </div>
      </section>
      <div class="life-grid">
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="repeat" :size="21" /> 今日定期事项</h2>
          <p class="life-caption">每天更新。已完成的记录不会带到明天；未完成事项会顺延到下一适用日。</p>
          <p v-if="!routines.length" class="life-empty">今天没有需要执行的定期任务</p>
          <div v-for="r in routines" :key="r.id" class="life-row today-routine-row"
            :class="{'routine-completed':!!r.mark?.completed_at}">
            <label class="today-routine-label">
              <input type="checkbox" :checked="!!r.mark?.completed_at" :disabled="busy"
                :aria-label="(r.mark?.completed_at?'撤销完成 ':'完成 ')+r.title"
                @change="markRoutine(r,!r.mark?.completed_at)"/>
              <span class="routine-name">{{ r.title }}</span>
            </label>
            <small>{{ r.mark?.completed_at?'已完成':r.carriedFrom?'未完成 · 顺延至今天':routineLabel(r) }}</small>
          </div>
          
        </section>
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 即将到来的纪念日</h2>
          <p v-if="!items.length" class="life-empty">暂无即将到来的纪念日，可在「家庭」添加。</p>
          <div v-for="e in items.slice(0,8)" :key="e.id" class="life-row upcoming-anniversary">
            <b>{{ e.title }}</b>
            <div class="anniversary-countdown">
              <strong>{{ countdown(e.nextOn) }}</strong>
              <time :datetime="e.nextOn">{{ e.nextOn }}</time>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template v-else-if="mode==='family'">
      <section class="life-card">
        <h2 class="life-heading"><AppIcon name="calendar-heart" :size="21" /> 家人的重要日子</h2>
        <p class="life-caption">家庭成员或宠物档案中填写的生日会自动显示、每年提醒，无需重复创建。这里可添加结婚纪念日或其他特殊日期。</p>
        <div v-for="e in items" :key="e.id" class="life-row"><b>{{ e.title }}</b><span>{{ e.nextOn }}</span></div>
        <form class="life-form" @submit.prevent="addAnniversary">
          <input v-model.trim="eventTitle" required placeholder="纪念日名称"/><input v-model="eventDate" type="date" required/>
          <select v-model="eventRepeat"><option value="yearly">每年</option><option value="once">一次性</option><option value="monthly">每月</option></select>
          <button :disabled="busy">添加纪念日</button>
        </form>
      </section>
    </template>

    <template v-else-if="mode==='plans'">
      <div class="life-grid">
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="repeat" :size="21" /> 定期任务设置</h2>
          <p class="life-caption">在这里添加重复任务；到期当天自动显示在「今天」。</p>
          <div v-for="r in routines" :key="r.id" class="life-row">
            <b>{{ r.title }}</b><small>{{ routineLabel(r) }}</small>
          </div>
          <p v-if="!routines.length" class="life-empty">还没有设置定期任务</p>
          <form class="life-form" @submit.prevent="addRoutine">
            <input v-model.trim="routineTitle" required maxlength="150" placeholder="例如：给豆沙换水"/>
            <select v-model="routineRepeat"><option value="daily">每天</option><option value="workday">工作日（日本祝日除外）</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="interval">自定义间隔</option></select>
            <label v-if="routineRepeat==='interval'">每隔多少天<input v-model.number="intervalDays" type="number" min="1" max="3650"/></label>
            <select v-if="routineRepeat==='interval'" v-model="intervalAnchor" aria-label="间隔计算方式">
              <option value="fixed">按原定日期</option><option value="completion">按上次实际完成日</option>
            </select>
            <label>关联对象（可选）
              <select v-model="routineSubject" aria-label="这项定期任务与谁有关">
                <option value="">不关联任何人或宠物</option>
                <option v-for="p in props.profiles" :key="p.id" :value="p.id">{{ p.displayName }}（{{ p.type==='pet'?'宠物':'家人' }}）</option>
              </select></label>
            <p class="life-caption">只是标记任务与谁有关，不会指定执行者或改变共享权限。</p>
            <button :disabled="busy">＋ 添加定期任务</button>
          </form>
        </section>
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="heart" :size="21" /> 心愿清单</h2>
          <div v-for="w in items" :key="w.id" class="life-row"><div><b>{{ w.title }}</b><small>{{ w.wish_type }} · {{ w.status }}</small></div>
            <button v-if="w.wish_type==='trip'" class="life-link" @click="convertWish(w)">开始计划</button>
          </div>
          <form class="life-form" @submit.prevent="addWish">
            <input v-model.trim="wishTitle" required placeholder="想实现什么心愿？"/>
            <select v-model="wishType"><option value="trip">想去旅行</option><option value="purchase">想买东西</option><option value="activity">想体验</option><option value="other">其他</option></select>
            <label>预估日元<input v-model.number="wishBudget" type="number" min="0"/></label>
            <select v-model="wishVisibility"><option value="household">家庭共享</option><option value="private">仅自己</option></select>
            <button :disabled="busy">＋ 记录心愿</button>
          </form>
        </section>
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="wallet" :size="21" /> 储蓄目标</h2>
          <p class="life-caption">预留金额不等于银行余额，也不会被当成家計簿支出。</p>
          <div v-for="g in goals" :key="g.id" class="life-row"><div><b>{{ g.title }}</b>
            <small>¥{{ Number(g.reserved_amount).toLocaleString() }} / ¥{{ Number(g.target_amount).toLocaleString() }}</small></div>
            <button class="life-link" @click="reserve(g)">调整</button></div>
          <form class="life-form" @submit.prevent="addGoal">
            <input v-model.trim="goalTitle" required placeholder="目标名称"/>
            <label>目标金额（日元）<input v-model.number="goalAmount" type="number" min="1" required/></label>
            <label>目标日期<input v-model="goalTarget" type="date"/></label>
            <button :disabled="busy">＋ 新建目标</button>
          </form>
        </section>
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="shopping" :size="21" /> 家庭购物</h2>
          <div v-for="s in other" :key="s.id" class="life-row">
            <label><input type="checkbox" :checked="!!s.completed_at" @change="toggleShopping(s)"/>
              <span>{{ s.title }}</span></label></div>
          <form class="life-form" @submit.prevent="addShopping">
            <input v-model.trim="shoppingTitle" required placeholder="需要买些什么？"/>
            <button :disabled="busy">＋ 添加购物</button></form>
        </section>
        <section class="life-card">
          <h2 class="life-heading"><AppIcon name="plane" :size="21" /> 旅行计划</h2>
          <div v-for="t in trips" :key="t.id" class="life-row"><div><b>{{ t.title }}</b>
            <small>{{ t.destination }} · {{ t.startOn||'日期待确定' }}</small></div>
            <button class="life-link" @click="selectTrip(t.id)">查看行程</button></div>
          <div v-if="tripDetail" class="trip-detail">
            <h3>{{ tripDetail.title }}</h3>
            <template v-if="tripDetail.plan">
              <div v-for="d in tripDetail.plan.trip.days" :key="d.date" class="trip-day"><b>{{ d.date }}</b>
                <label v-for="it in d.items" :key="it.externalId" class="trip-item">
                  <input type="checkbox" :checked="itemDone(it.externalId)" @change="toggleTrip(it.externalId)"/>
                  <span>{{ it.startTime||'待定' }} · {{ it.title }}</span></label></div>
              <div v-if="tripDetail.plan.trip.tasks?.length" class="trip-day">
                <b class="life-heading"><AppIcon name="clipboard-check" :size="18" /> 出发前待办</b>
                <label v-for="task in tripDetail.plan.trip.tasks" :key="task.externalId" class="trip-item">
                  <input type="checkbox" :checked="itemDone(task.externalId)" @change="toggleTrip(task.externalId)"/>
                  <span>{{ task.title }} · {{ task.dueDate||'未设置日期' }}</span>
                </label>
              </div>
              <div v-for="list in tripDetail.plan.trip.packingLists||[]" :key="list.externalId" class="trip-day">
                <b class="life-heading"><AppIcon name="shopping" :size="18" /> 行李清单 · {{ list.owner }}</b>
                <label v-for="piece in list.items" :key="piece.externalId" class="trip-item">
                  <input type="checkbox" :checked="itemDone(piece.externalId)" @change="toggleTrip(piece.externalId)"/>
                  <span>{{ piece.label }} × {{ piece.quantity }}</span>
                </label>
              </div>
              <div v-if="tripDetail.plan.trip.bookings?.length" class="trip-day">
                <b class="life-heading"><AppIcon name="plane" :size="18" /> 交通和预订</b>
                <div v-for="booking in tripDetail.plan.trip.bookings" :key="booking.externalId" class="trip-item">
                  <span>{{ booking.title }} · {{ booking.status }}</span>
                </div>
              </div>
            </template>
            <p v-else class="life-caption">尚未导入行程，可以在下方导入 ChatGPT 制定的 JSON。</p>
          </div>
          <details class="trip-import"><summary>从 ChatGPT 导入旅行计划 JSON</summary>
            <p class="life-caption">粘贴 HomeFlow Trip v1 格式。先验证预览，再保存；更新旧计划会保留完成记录。</p>
            <label>导入到哪个旅行项目？
              <select v-model="importTargetId"><option value="">新建旅行项目</option><option v-for="t in trips" :key="t.id" :value="t.id">{{ t.title }}</option></select>
            </label>
            <textarea v-model="paste" rows="6" placeholder="粘贴完整的 JSON 内容"></textarea>
            <button class="life-light" @click="previewTrip">验证与预览</button>
            <div v-if="preview" class="trip-preview">
              <b>{{ preview.changes==='new'?'新旅行':preview.changes==='unchanged'?'未发生变化':'更新已有旅行' }}</b>
              <p>{{ preview.summary.days }} 天 / {{ preview.summary.itineraryItems }} 项行程 / {{ preview.summary.tasks }} 项准备任务</p>
              <button :disabled="busy" @click="importTrip">确认导入</button>
            </div>
          </details>
        </section>
      </div>
      <FinancePanel :trips="trips" :goals="goals" :owner="isOwner" />
    </template>

    <template v-else-if="mode==='memories'">
      <section class="life-card">
        <h2 class="life-heading"><AppIcon name="book-heart" :size="21" /> 留下一段美好的回忆</h2>
        <form class="life-form" @submit.prevent="addMemory">
          <input v-model.trim="memoryTitle" required maxlength="150" placeholder="今天有什么值得记住？"/>
          <label>发生日期<input v-model="memoryDate" required type="date"/></label>
          <textarea v-model="memoryStory" maxlength="8000" rows="3" placeholder="写下一段日记……"></textarea>
          <label>可选照片（仅存本机）
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" @change="photoFiles=Array.from(($event.target as HTMLInputElement).files||[]).slice(0,10)"/></label>
          <p class="life-caption">{{ cloudEnabled?'照片会同时保存到本机和私有云端，家庭共享范围以这条回忆为准。':'当前只在本机保存照片，不会自动跨设备同步；请定期导出 ZIP 备份。' }}</p>
          <button :disabled="busy">保存到时光轴</button>
        </form>
      </section>
      <section class="life-card"><h2 class="life-heading"><AppIcon name="images" :size="21" /> 我们的时光轴</h2>
        <p v-if="!items.length" class="life-empty">还没有回忆，先写下一件开心的小事。</p>
        <article v-for="m in items" :key="m.id" class="memory">
          <time>{{ m.happened_on }}</time><h3>{{ m.title }}</h3>
          <div v-if="cloudPhotos[m.id]?.length" class="memory-photos cloud">
            <div v-for="remote in cloudPhotos[m.id]" :key="remote.id">
              <img :src="'/api/media/'+remote.id" :alt="m.title+' 云端照片'" loading="lazy"/>
              <button v-if="remote.uploadedBy===props.userId" type="button" class="life-link"
                @click="removeCloudPhoto(remote.id)">删除云端照片</button>
            </div>
          </div>
          <div v-if="photos[m.id]?.length" class="memory-photos">
            <div v-for="(image,i) in photos[m.id]" :key="image">
              <img :src="image" :alt="m.title+' 照片 '+(i+1)" loading="lazy"/>
              <button type="button" class="life-link" @click="downloadLocalPhoto(localPhotoBlobs[m.id][i],m.id+'-'+(i+1)+'.jpg')">保存照片</button>
            </div>
          </div>
          <p>{{ m.story }}</p><small class="memory-visibility"><AppIcon :name="m.visibility==='private'?'shield':'house'" :size="14" /> {{ m.visibility==='private'?'私人回忆':'家庭共享' }}</small>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.life-area{margin:23px 0 5px}.life-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start}.life-card{background:#fff;border:1px solid #eeebe5;border-radius:18px;padding:20px;margin:0 0 16px;box-shadow:0 4px 16px #28332807}.life-card h2{font-size:17px;margin:0 0 11px}.life-card h3{font-size:15px}.life-caption{font-size:11px;line-height:1.7;color:#82948b}.life-empty{font-size:12px;color:#9ba69d;text-align:center;padding:14px 0}.life-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid #f0eee9;font-size:13px}.life-row label{display:flex;align-items:center;gap:8px}.life-row small{display:block;color:#87968b;margin-top:4px}.life-form{display:grid;gap:9px;margin-top:14px}.life-form input,.life-form select,.life-form textarea,.trip-import textarea{width:100%;padding:9px 11px;min-height:40px;border-radius:10px;border:1px solid #e0e7df;background:#fff;color:#283b30;font-size:13px}.life-form label{font-size:12px;color:#738477;display:grid;gap:5px}.life-form button,.trip-preview button{background:#478969;border:none;border-radius:10px;color:white;padding:10px 12px;font-weight:700}.life-link{color:#4a896b;background:#edf5ed;border:0;border-radius:9px;padding:8px;white-space:nowrap;font-size:12px}.life-error{background:#fff0eb;color:#a14d36;padding:12px;border-radius:10px;font-size:12px}.life-notice{background:#e5f2e8;color:#317355;padding:10px;border-radius:10px;font-size:12px}.trip-detail,.trip-import{padding:14px;background:#f6f8f2;border-radius:12px;margin-top:12px}.trip-import summary{cursor:pointer;font-size:13px;font-weight:700}.trip-import textarea{margin:10px 0}.trip-item{display:flex;align-items:center;gap:8px;font-size:12px;margin:9px 0}.trip-day{border-top:1px solid #e8ece6;padding:12px 0}.life-light{padding:10px;border-radius:9px;background:white;color:#478969;border:1px solid #a2c5ad}.trip-preview{padding:12px 0;font-size:12px}.memory{border-left:2px solid #c1d8c7;margin:15px 0;padding:1px 14px}.memory time,.memory small{font-size:11px;color:#8a9d90}.memory h3{margin:8px 0}.memory p{font-size:13px;white-space:pre-wrap;line-height:1.7}.memory-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.memory-photos img{width:100%;height:165px;object-fit:cover;border-radius:12px}
.memory-photos button{margin-top:3px}
@media(max-width:720px){.life-grid{grid-template-columns:1fr}.life-card{padding:17px}}

/* Shared icon language and responsive form guards */
.life-heading{display:flex;align-items:center;gap:9px;color:#293f34;min-width:0}
.life-heading :deep(.app-icon){color:#43866a}
.memory-visibility{display:inline-flex;align-items:center;gap:5px}
.life-form,.life-card,.life-row,.trip-import,.trip-detail{min-width:0;max-width:100%}
.life-row>*{min-width:0;overflow-wrap:anywhere}
.life-row>button{flex:none}
.life-form input:not([type="checkbox"]),.life-form select,.life-form textarea,
.trip-import select,.trip-import textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.life-form input[type="date"]{min-inline-size:0}
.life-form label,.trip-import label{min-width:0;max-width:100%}
.life-form button{width:100%}
.today-routine-label{display:flex!important;align-items:center;gap:12px;flex:1;min-width:0;cursor:pointer}
.today-routine-label input[type="checkbox"]{width:20px;height:20px;flex:none;accent-color:#43866a}
.today-routine-row .routine-name{overflow-wrap:anywhere}
.today-routine-row.routine-completed .routine-name{text-decoration:line-through;color:#9daaa1}
.today-routine-row.routine-completed small{color:#7b9d86}
.upcoming-anniversary{align-items:center}
.anniversary-countdown{display:grid;justify-items:end;gap:4px;text-align:right;flex:none}
.anniversary-countdown strong{font-size:13px;color:#43866a}
.anniversary-countdown time{font-size:12px;color:#85958b}
@media(max-width:420px){.anniversary-countdown{max-width:45%}.upcoming-anniversary>b{max-width:55%;overflow-wrap:anywhere}}
@media(max-width:720px){.life-grid{grid-template-columns:minmax(0,1fr)}}
</style>
