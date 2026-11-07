<script setup lang="ts">
import {computed,ref,watch} from 'vue'

type MemberPoints={
 userId:string;displayName:string;sharedPoints:number;monthPoints:number;
 routinePoints:number;level:number;title:string;progress:number;nextLevelIn:number
}
type Summary={month:string;pointsPerCompletion:number;members:MemberPoints[];
 ownPrivatePoints:number;ownPrivateMonthPoints:number}
const props=defineProps<{active:boolean;userId:string;syncRevision:number}>()
const data=ref<Summary|null>(null),loading=ref(false),error=ref('')
const own= computed(()=>data.value?.members.find(x=>x.userId===props.userId))
const myTotal=computed(()=>Number(own.value?.sharedPoints||0)+Number(data.value?.ownPrivatePoints||0))
let generation=0
async function refresh(){
 if(!props.active)return
 const current=++generation
 loading.value=true;error.value=''
 try{
   const response=await fetch('/api/points',{credentials:'same-origin',cache:'no-store'})
   if(!response.ok)throw Error('积分暂时无法读取')
   const body=await response.json() as Summary
   if(current!==generation||!props.active)return
   data.value=body
 }catch(e){if(current===generation)error.value=(e as Error).message}
 finally{if(current===generation)loading.value=false}
}
watch(()=>[props.active,props.userId,props.syncRevision],()=>{
 if(props.active)void refresh()
 else generation++
},{immediate:true})
</script>

<template>
 <section class="points-board panel" aria-labelledby="points-title">
   <div class="points-head">
     <h2 id="points-title">家庭成长积分</h2>
     <small>完成一次 +10 分</small>
   </div>
   <p class="points-hint">普通待办与周期任务均计分，每期只算一次。跳过不加分，撤销完成会扣回。</p>
   <div v-if="data" class="points-members">
     <article v-for="(item,index) in data.members" :key="item.userId" class="points-member">
       <div class="points-name">
         <b>{{ item.displayName }}</b><span v-if="item.userId===userId">我</span>
         <small v-if="index===0&&item.sharedPoints>0">家庭榜首</small>
       </div>
       <div class="points-score"><strong>{{ item.sharedPoints }}</strong><span>分</span></div>
       <div class="points-level">{{ item.title }} · Lv.{{ item.level }}</div>
       <div class="points-progress" :aria-label="'距离升级还差'+item.nextLevelIn+'分'">
         <span :style="{width:item.progress+'%'}"></span>
       </div>
       <small class="points-details">本月 +{{ item.monthPoints }} · 周期 {{ item.routinePoints }}</small>
     </article>
   </div>
   <p v-if="data" class="points-private">我的总积分 {{ myTotal }} 分
     <small>（家庭共享 {{ own?.sharedPoints||0 }} + 私人 {{ data.ownPrivatePoints }}；私人积分仅自己可见）</small>
   </p>
   <p v-if="!data&&loading" class="points-loading">正在读取积分…</p>
   <p v-if="error" role="alert" class="points-error">{{ error }}
     <button type="button" class="points-retry" @click="refresh">重试</button>
   </p>
 </section>
</template>
<style scoped>
.points-board{display:grid;gap:10px;min-width:0}
.points-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.points-head h2{margin:0;font-size:17px;line-height:1.4}
.points-head small{font-size:12px;color:#52846c;white-space:nowrap;font-weight:650}
.points-hint{margin:0;color:#75877a;font-size:12px;line-height:1.55}
.points-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.points-member{min-width:0;padding:12px;border-radius:12px;background:#f8faf7;border:1px solid #e5eee6}
.points-name{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}
.points-name b{font-size:13px;color:#344f3e;overflow-wrap:anywhere}
.points-name span,.points-name small{color:#739680;font-size:10px}
.points-score{display:flex;align-items:baseline;gap:4px;margin-top:5px}
.points-score strong{font-size:24px;line-height:1.2;color:#38815b;font-variant-numeric:tabular-nums}
.points-score span{font-size:12px;color:#648771}
.points-level{font-size:11px;color:#667e6d;line-height:1.5;overflow-wrap:anywhere}
.points-progress{height:5px;background:#e0e9df;border-radius:99px;margin-top:7px;overflow:hidden}
.points-progress span{display:block;height:100%;background:#58a47a;border-radius:99px}
.points-details{display:block;color:#73877a;font-size:11px;margin-top:7px}
.points-private{margin:0;padding-top:8px;border-top:1px solid #eef2ec;color:#42694c;font-size:12px;line-height:1.5}
.points-private small{color:#748d79;font-size:11px}
.points-loading,.points-error{margin:0;font-size:12px;color:#7c8c80}
.points-error{color:#a34b3d}
.points-retry{border:0;background:none;color:#438669;font-size:12px;padding:5px 9px}
@media(max-width:360px){.points-member{padding:9px}.points-score strong{font-size:21px}}
</style>
