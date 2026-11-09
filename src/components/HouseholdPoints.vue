<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import AppIcon from './AppIcon.vue'
import EditBottomSheet from './EditBottomSheet.vue'
import LotteryCelebration from './LotteryCelebration.vue'

type MemberPoints={userId:string;displayName:string;sharedPoints:number;monthPoints:number;availablePoints:number;
 routinePoints:number;level:number;title:string;progress:number;nextLevelIn:number}
type Level={level:number;title:string;progress:number;nextLevelIn:number}
type Badge={id:string;label:string;icon:string;unlocked:boolean;target:number;progress:number;rewardPoints:number}
type Summary={month:string;pointsPerCompletion:number;members:MemberPoints[];
 ownPrivatePoints:number;ownPrivateMonthPoints:number;experience:number;
 earnedPoints:number;householdEarnedPoints:number;weeklyBonusPoints:number;savingsBonusPoints:number;achievementBonusPoints:number;lotteryNetPoints:number;spentPoints:number;availablePoints:number;
 ownLevel:Level;badges:Badge[];challenge:{weekOn:string;completed:number;target:number;bonus:number;achieved:boolean}}
type Reward={id:string;title:string;description:string;icon:string;points:number;
 stock:number|null;active:boolean;builtin:boolean;redeemedCount:number;createdBy:string|null;goalCreditYen:number}
type Redemption={id:string;rewardId:string;redeemedBy:string;redeemedByName:string;
 title:string;icon:string;points:number;quantity:number;status:string;createdAt:string;fulfilledAt:string|null;creditedYen:number;wishTitle:string|null}
type Contribution={userId:string;displayName:string;points:number}
type GroupOrder={id:string;rewardId:string;createdBy:string;title:string;icon:string;
 points:number;fundedPoints:number;wishTitle:string|null;goalCreditYen:number;status:'collecting'|'requested'|'fulfilled'|'cancelled';
 createdAt:string;fundedAt:string|null;contributions:Contribution[]}
type Shop={rewards:Reward[];redemptions:Redemption[];groupOrders:GroupOrder[];
 redemptionPage:number;redemptionPages:number;redemptionTotal:number;
 groupPage:number;groupPages:number;groupTotal:number;pageSize:number}
type WishGoalOption={wishId:string;wishTitle:string;goalId:string;goalTitle:string;targetAmount:number}
type YearMember={userId:string;displayName:string;contributionPoints:number;earnedPoints:number;
 spentPoints:number;lotteryNetPoints:number;privatePoints:number|null;endingPoints:number;expiredPoints:number|null}
type YearEntry={userId:string;visibility:'household'|'private';amount:number;contribution:number;
 category:string;label:string;stamp:string;prizeKind:string|null;
 ticketCost:number|null;prizePoints:number|null;eventId:string|null}
type YearHistory={year:number;currentYear:number;members:YearMember[];entries:YearEntry[];
 page:number;pageSize:number;total:number;totalPages:number;
 memberFilter:string;categoryFilter:string}
type LotteryDraw={id:string;userId:string;displayName?:string;
 kind:'empty'|'five'|'six'|'ten'|'twenty'|'fifty'|'double'|'ticket'|'shop'|'wish';
 cost:number;points:number;createdAt:string;month:string;ticketCouponId?:string|null}
type Coupon={id:string;kind:'ticket'|'shop'|'wish';createdAt:string;expiresOn:string;
 usedAt:string|null;useReference:string|null;usedGoalId:string|null;
 wishTitle:string|null;status:'available'|'used'|'expired'}
type Lottery={month:string;cost:number;limit:number;used:number;history:LotteryDraw[];
 historyPage:number;historyPageSize:number;historyTotal:number;historyTotalPages:number;
 odds:{kind:string;rate:number;label:string}[]}

const props=defineProps<{active:boolean;userId:string;syncRevision:number}>()
const data=ref<Summary|null>(null),shop=ref<Shop|null>(null),loading=ref(false),busy=ref(false),error=ref('')
const view=ref<'shop'|'achievements'|'lottery'|'history'>('shop')
const quantityChoice=ref<Record<string,number>>({})
const redemptionPage=ref(1),groupPage=ref(1)
const history=ref<YearHistory|null>(null)
const historyYear=ref(new Date(Date.now()+9*3600000).getUTCFullYear())
const historyMember=ref('')
const historyCategory=ref('all')
const historyPage=ref(1)
const historyMatchesFilters=computed(()=>Boolean(history.value&&
 history.value.year===historyYear.value&&history.value.page===historyPage.value&&
 history.value.memberFilter===historyMember.value&&
 history.value.categoryFilter===historyCategory.value))
const visibleHistoryEntries=computed(()=>historyMatchesFilters.value?history.value?.entries||[]:[])
const historyBusy=ref(false)
const historyError=ref('')
let historyRequest=0
const availableYears=computed(()=>{
 const latest=new Date(Date.now()+9*3600000).getUTCFullYear()
 return Array.from({length:Math.max(1,latest-2025)},(_,i)=>latest-i)
})
const historyMemberName=(id:string)=>history.value?.members.find(m=>m.userId===id)?.displayName||'家庭成员'
const categoryNames:Record<string,string>={
 complete:'任务完成',bounty:'指定奖励',reserved:'指定扣分',
 shopping:'购物计划',lottery:'幸运抽奖',
 redeem:'商城兑换',pool:'合力兑换',
 weekly:'每周挑战',achievement:'月度成就',
 savings:'储值奖励',trip:'旅行奖励'
}
const historyTime=(stamp:string)=>new Date(stamp).toLocaleString('zh-CN',{
 timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
})
const drawOutcome=(kind:string|null)=>kind==='empty'?'空手而归':
 kind==='double'?'最高奖 · 积分翻倍':'中奖'
const signedPoints=(amount:number)=>(amount>0?'+':'')+fmt(amount)
const quantityFor=(item:Reward)=>Math.max(1,Math.min(99,Math.trunc(quantityChoice.value[item.id]||1)))
function stepQuantity(item:Reward,delta:number){
 const remaining=item.stock===null?99:Math.max(1,item.stock-item.redeemedCount)
 quantityChoice.value={...quantityChoice.value,
  [item.id]:Math.max(1,Math.min(99,remaining,quantityFor(item)+delta))}
}
const historyPath=()=>'/points/history?year='+historyYear.value+
 '&page='+historyPage.value+'&member='+encodeURIComponent(historyMember.value)+
 '&category='+encodeURIComponent(historyCategory.value)
async function goToHistory(page:number,year=historyYear.value,member=historyMember.value,
 category=historyCategory.value){
 if(!props.active||!expanded.value||view.value!=='history'||busy.value)return
 const token=++historyRequest
 historyPage.value=page;historyYear.value=year;historyMember.value=member
 historyCategory.value=category
 historyBusy.value=true;historyError.value=''
 try{
  const next=await fetchJSON(historyPath()) as YearHistory
  if(token!==historyRequest||!props.active||!expanded.value||view.value!=='history')return
  history.value=next
 }catch(e){if(token===historyRequest)historyError.value=(e as Error).message}
 finally{if(token===historyRequest)historyBusy.value=false}
}
async function changeShopPage(kind:'redemption'|'group',page:number){
 if(!props.active||!expanded.value||view.value!=='shop'||loading.value||busy.value||
    !shop.value)return
 const max=kind==='redemption'?shop.value.redemptionPages:shop.value.groupPages
 if(page<1||page>max)return
 if(kind==='redemption')redemptionPage.value=page
 else groupPage.value=page
 await refresh()
}
const lottery=ref<Lottery|null>(null)
const couponItems=ref<Coupon[]>([])
const couponSheetOpen=ref(false)
const couponStatus=ref<'available'|'used'|'expired'>('available')
const couponPage=ref(1)
const useFreeTicket=ref(false)
const useShopCoupon=ref(false)
const wishCouponDraft=ref<Coupon|null>(null)
const wishCouponGoal=ref('')
const wishCouponOptions=ref<WishGoalOption[]>([])
const wishCouponBusy=ref(false)
const activeCoupons=computed(()=>couponItems.value.filter(c=>c.status==='available'))
const firstCoupon=(kind:Coupon['kind'])=>activeCoupons.value.filter(c=>c.kind===kind)
  .sort((a,b)=>a.expiresOn.localeCompare(b.expiresOn)||a.createdAt.localeCompare(b.createdAt))[0]||null
const availableTicket=computed(()=>firstCoupon('ticket'))
const availableShopCoupon=computed(()=>firstCoupon('shop'))
const usingTicket=computed(()=>useFreeTicket.value&&Boolean(availableTicket.value))
const filteredCoupons=computed(()=>couponItems.value.filter(c=>c.status===couponStatus.value))
const couponTotalPages=computed(()=>Math.max(1,Math.ceil(filteredCoupons.value.length/5)))
const visibleCoupons=computed(()=>filteredCoupons.value.slice((couponPage.value-1)*5,couponPage.value*5))
const couponTitle=(kind:Coupon['kind'])=>kind==='ticket'?'🎟 免费抽奖券':
 kind==='shop'?'🛍 商城95折券':'💖 心愿加速券'
const couponStatusName=(status:Coupon['status'])=>status==='available'?'可使用':
 status==='used'?'已使用':'已过期'
const couponDay=(stamp:string)=>stamp.slice(0,10)
const couponDiscount=(item:Reward,quantity:number)=>Math.min(50,Math.floor(item.points*quantity/20))
const selectedCouponDiscount=(item:Reward,quantity:number)=>
 useShopCoupon.value&&availableShopCoupon.value&&item.points*quantity>=20?
 couponDiscount(item,quantity):0
const redeemCost=(item:Reward,quantity:number)=>
 item.points*quantity-selectedCouponDiscount(item,quantity)
const lotteryLastDraw=ref<LotteryDraw|null>(null)
const LOTTERY_RESULT_DURATION_MS=3000
let lotteryResultTimer:ReturnType<typeof setTimeout>|null=null
function clearLotteryResult(){
 if(lotteryResultTimer!==null){clearTimeout(lotteryResultTimer);lotteryResultTimer=null}
 lotteryLastDraw.value=null
}
function showLotteryResult(draw:LotteryDraw){
 clearLotteryResult()
 lotteryLastDraw.value=draw
 lotteryResultTimer=setTimeout(()=>{lotteryLastDraw.value=null;lotteryResultTimer=null},
  LOTTERY_RESULT_DURATION_MS)
}
// Default to a compact family overview entry, not an open reward catalog.
const expanded=ref(false)
const ruleHelpOpen=ref(false)
const rulesAnchor=ref<HTMLElement|null>(null)
const experienceHelpOpen=ref(false)
const experienceAnchor=ref<HTMLElement|null>(null)
const lotteryHelpOpen=ref(false)
const lotteryRulesAnchor=ref<HTMLElement|null>(null)
const lotteryOddsOpen=ref(false)
const formOpen=ref(false),editId=ref('')
const formIcon=ref('🎁'),formTitle=ref(''),formDescription=ref('')
const formCost=ref('100'),formStock=ref(''),formActive=ref(true),formCredit=ref('0')
const wishRewardDraft=ref<{item:Reward;action:'redeem'|'pool';quantity:number}|null>(null)
const wishGoalOptions=ref<WishGoalOption[]>([])
const wishGoalSelected=ref('')
const wishGoalLoading=ref(false)
const wishGoalError=ref('')
const wishGoalChoice=computed(()=>wishGoalOptions.value.find(g=>g.goalId===wishGoalSelected.value)||null)
function closeWishReward(){if(!busy.value&&!wishGoalLoading.value)wishRewardDraft.value=null}
async function askLinkedWish(item:Reward,action:'redeem'|'pool',quantity=1){
 if(busy.value||wishGoalLoading.value)return
 wishRewardDraft.value={item,action,quantity}
 wishGoalOptions.value=[];wishGoalSelected.value='';wishGoalError.value=''
 wishGoalLoading.value=true
 try{
  const result=await fetchJSON('/rewards/wish-goals') as {items:WishGoalOption[]}
  if(!wishRewardDraft.value||wishRewardDraft.value.item.id!==item.id)return
  wishGoalOptions.value=result.items||[]
  if(wishGoalOptions.value.length===1)wishGoalSelected.value=wishGoalOptions.value[0].goalId
 }catch(e){wishGoalError.value=(e as Error).message}
 finally{wishGoalLoading.value=false}
}
const poolAmount=ref<Record<string,string>>({})
const poolContributionOpen=ref('')
const own=computed(()=>data.value?.members.find(x=>x.userId===props.userId))
const myTotal=computed(()=>data.value?.experience??Number(own.value?.sharedPoints||0)+Number(data.value?.ownPrivatePoints||0))
const points=computed(()=>data.value?.availablePoints??0)
const contributionLeaderId=computed(()=>data.value?.members[0]?.userId??'')
const walletLeaderId=computed(()=>data.value?.members.reduce((leader,member)=>
 !leader||member.availablePoints>leader.availablePoints?member:leader,null as MemberPoints|null)?.userId??'')
const lotteryRemaining=computed(()=>Math.max(0,(lottery.value?.limit??7)-(lottery.value?.used??0)))
const visibleRewards=computed(()=>shop.value?.rewards.filter(r=>r.active)||[])
const hiddenRewards=computed(()=>shop.value?.rewards.filter(r=>!r.active)||[])
// A cancelled group order is fully refunded and should no longer occupy the
// active joint-redemption list. Keep its database history for auditing.
const recentGroupOrders=computed(()=>
 (shop.value?.groupOrders||[]).filter(order=>order.status!=='cancelled'))
let generation=0
async function fetchJSON(path:string,method='GET',body?:unknown){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',cache:'no-store',
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 // A proxy/Worker failure can return an HTML error page. On iOS Safari,
 // response.json() otherwise displays the opaque "string did not match" error.
 if(!(response.headers.get('content-type')||'').includes('application/json'))
   throw Error('积分服务暂时不可用（HTTP '+response.status+'），请刷新重试')
 let result
 try{result=await response.json()}
 catch{throw Error('积分服务返回了无效数据（HTTP '+response.status+'），请刷新重试')}
 if(!response.ok)throw Error(({
   invalid_reward:'请检查名称、价格及库存',
   server_error:'积分服务暂时出现异常，请刷新重试',
   reward_unavailable_or_insufficient:'积分不足、商品已售罄或已经下架',
   pool_closed_or_insufficient:'本单已结束、金额超过剩余需求，或你的可用积分不足',
   pool_not_cancellable:'只有未凑齐积分的合力兑换可以取消',
   pool_not_funded:'积分尚未凑齐，暂不能兑现',
   lottery_unavailable:'积分不足、次数已用完、免费券不可用或抽奖状态已更新，请刷新重试',
   coupon_unavailable:'奖励券已使用、过期或不属于当前账户，请刷新重试',
   coupon_unavailable_or_wish_inactive:'奖励券不可用或关联心愿已失效，请检查后重试',
   not_authenticated:'请重新登录',
   origin_forbidden:'请从 HomeFlow 应用内操作'
  } as Record<string,string>)[result.error]||result.error||'操作失败')
 return result
}
async function refresh(){
 if(!props.active)return
 const current=++generation
 loading.value=true;error.value=''
 try{
   if(!expanded.value){
     const pointsResult=await fetchJSON('/points')
     if(current!==generation||!props.active)return
     data.value=pointsResult as Summary
   }else{
     const selectedView=view.value
     const historyToken=selectedView==='history'?++historyRequest:0
     const [pointsResult,secondary,couponResult]=await Promise.all([
       fetchJSON('/points'),fetchJSON(selectedView==='lottery'?'/lottery':
         selectedView==='history'?historyPath():
          '/rewards?redemptionPage='+redemptionPage.value+'&groupPage='+groupPage.value),
       fetchJSON('/lottery/coupons') as Promise<{items:Coupon[]}>])
     if(current!==generation||!props.active||!expanded.value||selectedView!==view.value)return
     data.value=pointsResult as Summary
     couponItems.value=couponResult.items||[]
     if(!availableTicket.value)useFreeTicket.value=false
     if(!availableShopCoupon.value)useShopCoupon.value=false
     if(selectedView==='lottery'){
       lottery.value=secondary as Lottery
     }else if(selectedView==='history'){
       if(historyToken===historyRequest){
        history.value=secondary as YearHistory
        historyBusy.value=false
       }
     }else{
      shop.value=secondary as Shop
      redemptionPage.value=shop.value.redemptionPage
      groupPage.value=shop.value.groupPage
    }
   }
 }catch(e){if(current===generation)error.value=(e as Error).message}
 finally{if(current===generation)loading.value=false}
}
watch(()=>[props.active,props.userId,props.syncRevision],()=>{
 if(props.active)void refresh()
 else{
   generation++
   expanded.value=false
   ruleHelpOpen.value=false
   experienceHelpOpen.value=false
   lotteryHelpOpen.value=false
   shop.value=null
   redemptionPage.value=1;groupPage.value=1
   lottery.value=null
   historyRequest++
   history.value=null
   historyBusy.value=false
   clearLotteryResult()
 }
},{immediate:true})
watch(()=>props.userId,()=>{
 generation++
 data.value=null
 shop.value=null
 redemptionPage.value=1;groupPage.value=1
 lottery.value=null
 historyRequest++
 history.value=null
 historyBusy.value=false
 clearLotteryResult()
 expanded.value=false
 ruleHelpOpen.value=false
 experienceHelpOpen.value=false
 lotteryHelpOpen.value=false
})
function dismissRulesOutside(event:PointerEvent){
 if(ruleHelpOpen.value&&!rulesAnchor.value?.contains(event.target as Node))
   ruleHelpOpen.value=false
 if(experienceHelpOpen.value&&!experienceAnchor.value?.contains(event.target as Node))
   experienceHelpOpen.value=false
 if(lotteryHelpOpen.value&&!lotteryRulesAnchor.value?.contains(event.target as Node))
   lotteryHelpOpen.value=false
}
function dismissRulesKey(event:KeyboardEvent){
 if(event.key==='Escape'){
   ruleHelpOpen.value=false
   experienceHelpOpen.value=false
   lotteryHelpOpen.value=false
 }
}
onMounted(()=>{
 document.addEventListener('pointerdown',dismissRulesOutside)
 document.addEventListener('keydown',dismissRulesKey)
})
onBeforeUnmount(()=>{
 document.removeEventListener('pointerdown',dismissRulesOutside)
 document.removeEventListener('keydown',dismissRulesKey)
 historyRequest++
 clearLotteryResult()
})
function openDetails(){
 if(expanded.value)return
 expanded.value=true
 void refresh()
}
function closeDetails(){
 clearLotteryResult()
 historyRequest++
 historyBusy.value=false
 expanded.value=false
 ruleHelpOpen.value=false
 experienceHelpOpen.value=false
 lotteryHelpOpen.value=false
 generation++
 view.value='shop'
 resetForm()
 wishRewardDraft.value=null
}
function resetForm(){
 formOpen.value=false;editId.value='';formIcon.value='🎁';formTitle.value=''
 formDescription.value='';formCost.value='100';formStock.value='';formActive.value=true;formCredit.value='0'
}
function editReward(reward:Reward){
 editId.value=reward.id;formIcon.value=reward.icon;formTitle.value=reward.title
 formDescription.value=reward.description;formCost.value=String(reward.points)
 formStock.value=reward.stock===null?'':String(reward.stock)
 formCredit.value=String(reward.goalCreditYen||0)
 formActive.value=reward.active;formOpen.value=true
}
function openCreate(){resetForm();formOpen.value=true}
function selectView(next:'shop'|'achievements'|'lottery'|'history'){
 if(view.value===next)return
 clearLotteryResult()
 historyRequest++
 lotteryHelpOpen.value=false
 view.value=next
 wishRewardDraft.value=null
 if(next==='lottery'||next==='shop'&&!shop.value||next==='history')void refresh()
}
async function drawLottery(){
 if(busy.value||!lottery.value||lotteryRemaining.value<1||points.value<5)return
 busy.value=true;error.value='';clearLotteryResult()
 const requestId=crypto.randomUUID()
 const drawingUser=props.userId
 try{
   const result=await fetchJSON('/lottery/draw','POST',{requestId}) as {draw:LotteryDraw}
   if(props.active&&expanded.value&&view.value==='lottery'&&props.userId===drawingUser){
       showLotteryResult(result.draw)
   }
   await refresh()
   // A committed draw is final even when the follow-up read fails. Never show
   // a generic draw failure or invite a second charge in that situation.
   if(error.value)error.value='抽奖已经成功，积分刷新失败，请稍后重新打开查看：'+error.value
 }catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
async function mutate(work:()=>Promise<unknown>,success:string){
 if(busy.value)return
 busy.value=true;error.value=''
 try{await work();await refresh();window.alert(success)}
 catch(e){error.value=(e as Error).message}
 finally{busy.value=false}
}
async function saveReward(){
 const cost=Number(formCost.value),stock=formStock.value.trim()===''?null:Number(formStock.value)
 const credit=Number(formCredit.value.trim()||0)
 if(!formTitle.value.trim()||!Number.isInteger(cost)||cost<10||cost>10000||
    (stock!==null&&(!Number.isInteger(stock)||stock<0||stock>9999))||
    !Number.isSafeInteger(credit)||credit<0||credit>100000){
  error.value='请填写名称（1～60字）、10～10000积分和有效库存';return
 }
 const payload={title:formTitle.value.trim(),description:formDescription.value,
  icon:formIcon.value,points:cost,stock,active:formActive.value,goalCreditYen:credit}
 const endpoint=editId.value?'/rewards/'+encodeURIComponent(editId.value):'/rewards'
 const method=editId.value?'PATCH':'POST'
 await mutate(()=>fetchJSON(endpoint,method,payload),'奖励已保存')
 if(!error.value)resetForm()
}
async function toggleActive(item:Reward){
 if(!window.confirm(item.active?'下架「'+item.title+'」？已有兑换记录会保留。':'重新上架「'+item.title+'」？'))return
 const payload={title:item.title,description:item.description,icon:item.icon,
  points:item.points,stock:item.stock,active:!item.active,goalCreditYen:item.goalCreditYen||0}
 await mutate(()=>fetchJSON('/rewards/'+encodeURIComponent(item.id),'PATCH',payload),
  item.active?'已下架':'已重新上架')
}
async function redeem(item:Reward){
 const quantity=quantityFor(item),total=quantity*item.points
 if(item.stock!==null&&item.redeemedCount+quantity>item.stock){error.value='商品剩余数量不足';return}
 if(points.value<total){error.value='可用积分不足';return}
 if(item.goalCreditYen>0){await askLinkedWish(item,'redeem',quantity);return}
 if(!window.confirm('确定花费 '+total+' 积分兑换「'+item.title+'」×'+quantity+' 吗？\n兑换后无法自动退款，经验值不会扣除。'))return
 const requestId=crypto.randomUUID()
 redemptionPage.value=1
 await mutate(()=>fetchJSON('/rewards/redeem','POST',{rewardId:item.id,requestId,quantity}),
  '已成功兑换 '+quantity+' 件！')
 if(!error.value)quantityChoice.value={...quantityChoice.value,[item.id]:1}
}
async function startPool(item:Reward){
 if(item.goalCreditYen>0){await askLinkedWish(item,'pool');return}
 if(!window.confirm('创建「'+item.title+'」的合力兑换？\n家人可以各自出积分，凑齐 '+item.points+' 分后才能兑现。'))return
 const requestId=crypto.randomUUID()
 groupPage.value=1
 await mutate(()=>fetchJSON('/rewards/pool','POST',{rewardId:item.id,requestId}),
  '合力兑换已创建，请在下方选择出资金额')
}
async function submitWishReward(){
 const draft=wishRewardDraft.value,choice=wishGoalChoice.value
 if(!draft||!choice||busy.value||wishGoalLoading.value)return
 const {item,action,quantity}=draft
 const yen=item.goalCreditYen*quantity
 const message=action==='redeem'?
  '花费 '+item.points*quantity+' 积分，兑换「'+item.title+'」×'+quantity+
    '，并将 ¥'+yen.toLocaleString('ja-JP')+' 奖励额度计入「'+choice.wishTitle+'」的关联储值？':
  '创建「'+item.title+'」的合力兑换，凑齐后将 ¥'+
    yen.toLocaleString('ja-JP')+' 奖励额度计入「'+choice.wishTitle+'」的关联储值？'
 if(!window.confirm(message+'\n奖励额度不代表实际存款，也不会写入家計簿。'))return
 const requestId=crypto.randomUUID()
 const payload={rewardId:item.id,requestId,wishId:choice.wishId,goalId:choice.goalId}
 if(action==='redeem'){
  redemptionPage.value=1
  await mutate(()=>fetchJSON('/rewards/redeem','POST',{...payload,quantity}),
   '兑换成功！'+choice.wishTitle+'的储值奖励额度增加 ¥'+yen.toLocaleString('ja-JP'))
 }else{
  groupPage.value=1
  await mutate(()=>fetchJSON('/rewards/pool','POST',payload),
   '合力兑换已创建，积分凑齐后将自动计入所选心愿的储值额度')
 }
 if(!error.value){
  wishRewardDraft.value=null
  if(action==='redeem')quantityChoice.value={...quantityChoice.value,[item.id]:1}
 }
}
async function contributePool(item:GroupOrder){
 const amount=Number(poolAmount.value[item.id]??Math.ceil(item.points/2))
 const remaining=Math.max(0,item.points-item.fundedPoints)
 if(!Number.isSafeInteger(amount)||amount<1||amount>remaining){
   error.value='本次出资请填写 1～'+remaining+' 的整数';return
 }
 if(amount>points.value){error.value='当前可用积分不足';return}
 if(!window.confirm('确认出资 '+amount+' 分给「'+item.title+'」？\n只扣你的可用积分，未凑齐时仍可取消并返还。'))return
 const requestId=crypto.randomUUID()
 await mutate(()=>fetchJSON('/rewards/pool/'+item.id+'/contribute','POST',
  {points:amount,requestId}),'已出资 '+amount+' 分')
 if(!error.value)poolContributionOpen.value=''
}
async function cancelPool(item:GroupOrder){
 if(!window.confirm('取消「'+item.title+'」的合力兑换？\n未凑齐的订单可以取消，双方已出的积分都会返还。'))return
 await mutate(()=>fetchJSON('/rewards/pool/'+item.id+'/cancel','POST'),
  '合力兑换已取消，积分已返还')
}
async function fulfillPool(item:GroupOrder){
 if(!window.confirm('确认「'+item.title+'」已由家人兑现吗？'))return
 await mutate(()=>fetchJSON('/rewards/pool/'+item.id+'/fulfill','POST'),'已确认兑现')
}
async function fulfill(item:Redemption){
 if(!window.confirm('确认「'+item.title+'」已经兑现了吗？'))return
 await mutate(()=>fetchJSON('/rewards/redemptions/'+item.id,'PATCH',{status:'fulfilled'}),
  '已标记兑现')
}
const fmt=(value:number)=>value.toLocaleString('zh-CN')
const dateText=(stamp:string)=>stamp?new Date(stamp).toLocaleDateString('zh-CN',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric'}):''
</script>

<template>
 <LotteryCelebration :draw="lotteryLastDraw"/>
 <section class="points-board panel" :class="{'points-board--collapsed':!expanded}" aria-label="家庭成长积分">
   <button v-if="!expanded" type="button" class="points-entry" :aria-expanded="expanded"
     aria-controls="points-expanded" @click="openDetails">
     <span class="points-entry-icon" aria-hidden="true"><AppIcon name="gift" :size="21"/></span>
     <span class="points-entry-main"><strong>家庭成长积分</strong>
       <small v-if="data">Lv.{{ data.ownLevel.level }} · 我的可用家庭积分 {{ fmt(points) }} 分</small>
       <small v-else>{{ loading?'正在读取积分…':'积分商店 · 合力兑换 · 成就' }}</small>
     </span>
     <span class="points-entry-right">查看 <AppIcon name="chevron-down" :size="16" class="points-chevron-right"/></span>
   </button>
   <p v-if="!expanded&&error" role="alert" class="points-error">{{ error }}</p>
   <div v-if="expanded" id="points-expanded" class="points-expanded">
     <div class="points-head">
       <div ref="rulesAnchor" class="points-title-wrap">
         <h2 id="points-title">家庭成长积分</h2>
         <button type="button" class="points-rule-help" aria-label="查看积分规则"
           aria-controls="points-rule-popover" :aria-expanded="ruleHelpOpen"
           @click="ruleHelpOpen=!ruleHelpOpen"><span class="points-help-glyph" aria-hidden="true">?</span></button>
         <div v-if="ruleHelpOpen" id="points-rule-popover" role="tooltip" class="points-rule-popover">
           <b>积分规则</b>
           <p>购物计划完成 +2；周期任务每期 +5；一次性任务统一基础 +5，额外指定奖励另计；储值目标每期经核验达标，家庭每位成员 +50；旅行结束并确认完成后，每位参与人每天 +10（含出发与结束当天）；心愿不计分。定期任务可单独指派某一期：指定他人时必须填写大于 0 的整数奖励，由发布人家庭积分预留。跳过无分、撤销扣回；私人任务不进入贡献榜，也不能兑换家庭奖励。贡献分不包括抽奖中奖和抽奖消耗；抽奖只影响可用家庭积分。每年 1 月 1 日 00:00（日本时间）所有积分、贡献分与 XP 清零，历史兑换记录保留。</p>
         </div>
       </div>
       <button type="button" class="points-collapse" @click="closeDetails">收起 <AppIcon name="chevron-down" :size="16" class="points-chevron-up"/></button>
     </div>
   <div v-if="data" class="points-my-card">
     <div>
       <span ref="experienceAnchor" class="xp-label">
         <small>我的成长经验</small>
         <button type="button" class="points-rule-help" aria-label="查看成长经验规则"
           aria-controls="experience-rule-popover" :aria-expanded="experienceHelpOpen"
           @click="experienceHelpOpen=!experienceHelpOpen;ruleHelpOpen=false"><span class="points-help-glyph" aria-hidden="true">?</span></button>
         <div v-if="experienceHelpOpen" id="experience-rule-popover" role="tooltip" class="points-rule-popover">
           <b>成长经验与积分</b>
           <p>成长经验包含任务、每周挑战、储值达标及月度成就奖励；兑换不减少 XP，撤销完成或达标失效会收回相应奖励。</p>
         </div>
       </span>
       <strong>{{ fmt(myTotal) }} XP</strong>
       <span>{{ data.ownLevel.title }} · Lv.{{ data.ownLevel.level }}</span>
     </div>
     <div><small>我的可用家庭积分</small><strong>{{ fmt(points) }}</strong><span>已兑换 {{ fmt(data.spentPoints) }} 分</span></div>
   </div>
   <div v-if="data" class="own-level-line" :aria-label="'再获得'+data.ownLevel.nextLevelIn+'经验升级'">
     <span :style="{width:data.ownLevel.progress+'%'}"></span>
   </div>
   <div v-if="data" class="points-members">
     <article v-for="item in data.members" :key="item.userId" class="points-member"
       :class="{'points-member--champion':item.userId===contributionLeaderId,'points-member--wealthy':item.userId===walletLeaderId}"
        :aria-label="item.displayName+(item.userId===contributionLeaderId?'，贡献第一':'')+(item.userId===walletLeaderId?'，可用家庭积分第一':'')">
       <div class="points-name">
         <b>{{ item.displayName }}</b>
         <span v-if="item.userId===contributionLeaderId" class="points-honors">
           <span v-if="item.userId===contributionLeaderId" class="points-honor"
             role="img" aria-label="贡献第一" title="贡献第一">🏆</span>
         </span>
         <span v-if="item.userId===userId" class="points-me">我</span>
       </div>
       <div class="points-score"><strong>{{ fmt(item.monthPoints) }}</strong><span>本月贡献分</span></div>
       <div class="points-available"><span>可用家庭积分</span><strong>{{ fmt(item.availablePoints) }}</strong></div>
       <div class="points-level">本年贡献 · Lv.{{ item.level }}</div>
       <small class="points-details">本年贡献 {{ fmt(item.sharedPoints) }} · 周期 {{ item.routinePoints }}</small>
     </article>
   </div>
   <details v-if="data" class="points-private">
     <summary><span>我的积分：贡献 {{ fmt(own?.sharedPoints||0) }} 分 · 私人 {{ fmt(data.ownPrivatePoints) }} 分</span><AppIcon name="chevron-down" :size="14" class="points-private-chevron"/></summary>
     <p class="points-bonus-breakdown">积分来源：挑战 +{{ fmt(data.weeklyBonusPoints) }} · 储值 +{{ fmt(data.savingsBonusPoints) }} · 成就 +{{ fmt(data.achievementBonusPoints) }} · 抽奖净额 {{ data.lotteryNetPoints>0?'+':'' }}{{ fmt(data.lotteryNetPoints||0) }}（仅影响可用积分，不计贡献分）</p>
   </details>
   <div class="points-tabs" role="group" aria-label="积分功能">
     <button type="button" :class="{chosen:view==='shop'}" @click="selectView('shop')"><AppIcon name="gift" :size="16"/> 积分商店</button>
     <button type="button" :class="{chosen:view==='achievements'}" @click="selectView('achievements')"><AppIcon name="award" :size="16"/> 成就挑战</button>
     <button type="button" :class="{chosen:view==='lottery'}" @click="selectView('lottery')"><AppIcon name="ticket" :size="16"/> 抽奖</button>
     <button type="button" :class="{chosen:view==='history'}" @click="selectView('history')"><AppIcon name="history" :size="16"/> 明细</button>
   </div>
   <template v-if="view==='achievements'&&data">
     <div class="challenge-card">
       <div><b>本周家庭挑战</b><span>{{ data.challenge.completed }}/{{ data.challenge.target }} 次</span></div>
       <div class="challenge-bar"><span :style="{width:Math.min(100,data.challenge.completed/data.challenge.target*100)+'%'}"></span></div>
       <small>{{ data.challenge.achieved?'本周已达成，自动获得 +30 积分':'本周完成 10 次家庭共享任务，自动奖励 30 分' }}</small>
     </div>
     <div class="monthly-achievement-heading">
       <b>{{ data.month.replace('-', ' 年 ') }} 月 · 月度成就</b>
       <small>每月 1 日重置成就 · 六项全达成共 +100 分；积分与 XP 每年元旦清零</small>
     </div>
     <div class="badges-grid">
       <div v-for="badge in data.badges" :key="badge.id" class="achievement" :class="{locked:!badge.unlocked}">
         <span>{{ badge.icon }}</span>
         <b>{{ badge.label }}</b>
         <small>{{ Math.min(badge.progress,badge.target) }}/{{ badge.target }} · 奖励 +{{ badge.rewardPoints }} 分</small>
         <small>{{ badge.unlocked?'本月已领取':'进行中' }}</small>
       </div>
     </div>
   </template>
   <template v-if="view==='lottery'">
     <div v-if="lottery" class="lottery-card">
       <div class="lottery-main">
         <div class="lottery-box" :class="{'lottery-box--rolling':busy,'lottery-box--jackpot':lotteryLastDraw?.kind==='double'}" aria-hidden="true">
            <span class="lottery-box-glow"></span>
            <span class="lottery-box-spark lottery-box-spark--one">✦</span>
            <span class="lottery-box-spark lottery-box-spark--two">✦</span>
            <span class="lottery-box-spark lottery-box-spark--three">✧</span>
            <span class="lottery-box-spark lottery-box-spark--four">✦</span>
            <div class="lottery-chest">
              <div class="lottery-chest-top">
                <span class="lottery-chest-bow lottery-chest-bow--left"></span>
                <span class="lottery-chest-bow lottery-chest-bow--right"></span>
                <span class="lottery-chest-slot"></span>
              </div>
              <div class="lottery-chest-front">
                <span class="lottery-chest-ribbon"></span>
                <span class="lottery-chest-seal">✦</span>
              </div>
            </div>
            <span class="lottery-box-label">好运箱</span>
            <small class="lottery-box-subtitle">试试今天的好运</small>
          </div>
          <div class="lottery-panel">
           <b>家庭幸运抽奖</b>
           <small>每次消耗 5 家庭积分</small>
           <small>本月已抽 {{ lottery.used }}/{{ lottery.limit }} 次 · 剩余 {{ lotteryRemaining }} 次</small>
           <button type="button" class="redeem-btn lottery-spin"
             :disabled="busy||lotteryRemaining===0||points<5"
             @click="drawLottery">{{ busy?'正在抽奖…':lotteryRemaining===0?'本月机会已用完':points<5?'积分不足':'抽一次 · 5 分' }}</button>
         </div>
       </div>
       <div ref="lotteryRulesAnchor" class="lottery-odds">
         <div class="lottery-odds-heading">
           <button type="button" class="lottery-odds-toggle" :aria-expanded="lotteryOddsOpen"
             aria-controls="lottery-odds-grid" @click="lotteryOddsOpen=!lotteryOddsOpen">
             <AppIcon name="chevron-down" :size="13" :class="{'lottery-odds-chevron-open':lotteryOddsOpen}"/>
             查看奖池概率与规则
           </button>
           <button type="button" class="points-rule-help" aria-label="查看抽奖规则说明"
             aria-controls="lottery-rule-popover" :aria-expanded="lotteryHelpOpen"
             @click="lotteryHelpOpen=!lotteryHelpOpen;ruleHelpOpen=false;experienceHelpOpen=false">
             <span class="points-help-glyph" aria-hidden="true">?</span>
           </button>
         </div>
         <div v-show="lotteryOddsOpen" id="lottery-odds-grid" class="lottery-odds-grid">
           <div v-for="odd in lottery.odds" :key="odd.kind"><span>{{ odd.label }}</span><b>{{ odd.rate }}%</b></div>
         </div>
         <div v-if="lotteryHelpOpen" id="lottery-rule-popover" role="tooltip"
           class="points-rule-popover lottery-rule-popover">
           <b>抽奖规则</b>
           <p>每位成员每月最多抽 7 次，日本时间每月 1 日重置。翻倍奖励以扣除本次 5 分后的家庭可用积分为基数；私人积分不参与。抽奖结果自动发送到家庭成员的今日消息并推送。</p>
         </div>
       </div>
     </div>
     <p v-else class="points-loading">{{ loading?'正在读取抽奖箱…':'暂无抽奖数据' }}</p>
   </template>
   <template v-if="view==='history'">
     <div class="annual-history-head">
       <b>年度积分明细</b>
       <div class="annual-filters">
         <label>年度
           <select :value="historyYear" @change="goToHistory(1,Number(($event.target as HTMLSelectElement).value))">
             <option v-for="year in availableYears" :key="year" :value="year">{{ year }}年</option>
           </select>
         </label>
         <label>成员
           <select :value="historyMember" @change="goToHistory(1,historyYear,($event.target as HTMLSelectElement).value)">
             <option value="">全部</option>
             <option v-for="person in history?.members||[]" :key="person.userId" :value="person.userId">{{ person.displayName }}</option>
           </select>
         </label>
         <label>分类
           <select :value="historyCategory" @change="goToHistory(1,historyYear,historyMember,($event.target as HTMLSelectElement).value)">
             <option value="all">全部</option>
             <option value="task">任务</option>
             <option value="shopping">购物</option>
             <option value="lottery">抽奖</option>
             <option value="shop">商城</option>
             <option value="achievement">挑战成就</option>
             <option value="saving">储值旅行</option>
           </select>
         </label>
       </div>
     </div>
     <div v-if="history" class="annual-members">
       <article v-for="person in history.members" :key="person.userId" class="annual-member">
         <b>{{ person.displayName }}</b>
         <div><span>年度贡献</span><strong>{{ fmt(person.contributionPoints) }}</strong></div>
         <div><span>年度入账 / 扣减</span><span>{{ fmt(person.earnedPoints) }} / {{ fmt(person.spentPoints) }}</span></div>
         <div><span>{{ history.year<history.currentYear?'年末未用清零':'当前可用积分' }}</span>
           <strong :class="{'annual-expired':history.year<history.currentYear}">{{ fmt(person.endingPoints) }}</strong></div>
         <div v-if="person.privatePoints!==null"><span>私人积分</span><span>{{ fmt(person.privatePoints) }}</span></div>
       </article>
     </div>
     <p class="annual-note">{{ history&&history.year<history.currentYear?
      '年末未用积分已经清零，仅供历史回顾，不能继续兑换。':'当前年度积分将于12月31日结束，次年1月1日清零。' }}</p>
     <div class="annual-ledger">
       <div class="annual-ledger-title"><b>积分流水</b><small v-if="historyMatchesFilters">共 {{ history?.total }} 条 · 每页5条</small></div>
       <p v-if="historyBusy&&!historyMatchesFilters" class="points-loading">正在筛选明细…</p>
       <p v-else-if="historyMatchesFilters&&!visibleHistoryEntries.length" class="points-loading">该条件下暂无积分记录</p>
       <div v-for="(entry,i) in visibleHistoryEntries" :key="entry.eventId||entry.stamp+entry.userId+entry.category+i" class="annual-ledger-row">
         <div>
           <b>{{ entry.label }}</b>
           <small class="annual-ledger-meta">{{ categoryNames[entry.category]||'积分调整' }} · {{ historyMemberName(entry.userId) }} · {{ entry.visibility==='private'?'私人':'家庭' }} · {{ historyTime(entry.stamp) }}</small>
           <small v-if="entry.category==='lottery'" class="annual-ledger-breakdown">
             {{ drawOutcome(entry.prizeKind) }} · 消耗 {{ fmt(entry.ticketCost||0) }} 分 · 中奖 {{ fmt(entry.prizePoints||0) }} 分 · 净变化 {{ signedPoints(entry.amount) }} 分
           </small>
           <small v-else class="annual-ledger-breakdown">
             {{ entry.amount<0?'扣减':'获得' }} {{ fmt(Math.abs(entry.amount)) }} 分 · 贡献变化 {{ signedPoints(entry.contribution) }} 分
           </small>
         </div>
         <strong :class="{negative:entry.amount<0,neutral:entry.amount===0}">{{ entry.category==='lottery'?'净 ':'' }}{{ signedPoints(entry.amount) }}</strong>
       </div>
       <div v-if="historyMatchesFilters&&history&&history.totalPages>1" class="annual-pagination">
         <button type="button" :disabled="historyBusy||historyPage<=1" @click="goToHistory(historyPage-1)">上一页</button>
         <span>{{ historyPage }} / {{ history.totalPages }}</span>
         <button type="button" :disabled="historyBusy||historyPage>=history.totalPages" @click="goToHistory(historyPage+1)">下一页</button>
       </div>
       <p v-if="historyError" class="points-error" role="alert">{{ historyError }}</p>
     </div>
   </template>
   <template v-if="view==='shop'">
     <div class="shop-title">
       <b>家庭奖励</b><button type="button" class="small-outline" :disabled="busy" @click="openCreate">+ 自定义奖励</button>
     </div>
     <div v-if="shop" class="reward-list">
       <article v-for="item in visibleRewards" :key="item.id" class="reward-row">
         <span class="reward-emoji">{{ item.icon }}</span>
         <div class="reward-details"><b>{{ item.title }}</b><small>{{ item.description }}</small>
           <span>{{ fmt(item.points) }} 分/件 <small v-if="item.stock!==null"> · 剩余 {{ Math.max(0,item.stock-item.redeemedCount) }}</small></span>
           <small v-if="quantityFor(item)>1">合计 {{ fmt(item.points*quantityFor(item)) }} 分</small>
           <small v-if="item.goalCreditYen>0" class="reward-goal-note">可关联心愿储值 · ¥{{ Number(item.goalCreditYen).toLocaleString('ja-JP') }}/件</small>
         </div>
         <button type="button" class="redeem-btn reward-buy" :disabled="busy||points<item.points*quantityFor(item)||(item.stock!==null&&item.redeemedCount+quantityFor(item)>item.stock)"
           @click="redeem(item)">{{ item.stock!==null&&item.redeemedCount>=item.stock?'售罄':'兑换' }}</button>
         <div class="reward-actions">
           <div class="quantity-stepper" aria-label="兑换数量">
             <button type="button" :disabled="busy||quantityFor(item)<=1" :aria-label="'减少'+item.title+'数量'"
               @click="stepQuantity(item,-1)">−</button>
             <span :aria-label="'数量'+quantityFor(item)">{{ quantityFor(item) }}</span>
             <button type="button" :disabled="busy||quantityFor(item)>=99||(item.stock!==null&&quantityFor(item)>=item.stock-item.redeemedCount)"
               :aria-label="'增加'+item.title+'数量'" @click="stepQuantity(item,1)">+</button>
           </div>
           <button type="button" class="link-btn" :disabled="busy||(item.stock!==null&&item.redeemedCount>=item.stock)"
             @click="startPool(item)"><AppIcon name="handshake" :size="15"/> 合力</button>
           <button type="button" class="link-btn" :disabled="busy" @click="editReward(item)">编辑</button>
           <button type="button" class="link-btn" :disabled="busy" @click="toggleActive(item)">下架</button>
         </div>
       </article>
     </div>
     <EditBottomSheet v-if="wishRewardDraft" :title="wishRewardDraft.action==='redeem'?'兑换并关联心愿':'合力兑换 · 关联心愿'"
        :close-disabled="busy||wishGoalLoading" @close="closeWishReward">
        <div class="wish-reward-sheet">
          <p><b>{{ wishRewardDraft.item.title }}</b> · {{ wishRewardDraft.quantity }} 件 ·
            {{ wishRewardDraft.item.points*wishRewardDraft.quantity }} 积分</p>
          <p class="wish-reward-credit">将获得 ¥{{ (wishRewardDraft.item.goalCreditYen*wishRewardDraft.quantity).toLocaleString('ja-JP') }} 的奖励抵扣额度</p>
          <p v-if="wishGoalLoading">读取可关联心愿…</p>
          <template v-else>
            <label v-if="wishGoalOptions.length">选择心愿及对应的储值计划
              <select v-model="wishGoalSelected">
                <option value="">请选择心愿</option>
                <option v-for="option in wishGoalOptions" :key="option.goalId" :value="option.goalId">
                  {{ option.wishTitle }} · {{ option.goalTitle }}
                </option>
              </select>
            </label>
            <p v-else class="wish-reward-notice">暂无可关联的心愿储值计划，请先在计划中创建心愿及累计储值计划。</p>
            <p class="wish-reward-notice">仅增加心愿的虚拟奖励额度，不会生成实际银行存款或家計簿账单。
              <template v-if="wishRewardDraft.action==='pool'">合力兑换需要先凑齐积分，凑齐后才计入。</template>
            </p>
            <p v-if="wishGoalError||error" role="alert" class="points-error">{{ wishGoalError||error }}</p>
            <button type="button" class="redeem-btn wish-reward-confirm"
              :disabled="busy||!wishGoalSelected" @click="submitWishReward">
              {{ busy?'处理中…':wishRewardDraft.action==='pool'?'确认创建合力兑换':'确认兑换并计入储值' }}
            </button>
          </template>
        </div>
      </EditBottomSheet>
      <details v-if="hiddenRewards.length" class="hidden-rewards">
       <summary>已下架的奖励（{{ hiddenRewards.length }}）</summary>
       <div v-for="item in hiddenRewards" :key="item.id" class="archived-row">
         <span>{{ item.icon }} {{ item.title }} · {{ item.points }}分</span>
         <button type="button" :disabled="busy" @click="editReward(item)">编辑</button>
         <button type="button" :disabled="busy" @click="toggleActive(item)">上架</button>
       </div>
     </details>
     <EditBottomSheet v-if="formOpen" :title="editId?'编辑奖励':'新增奖励'" :close-disabled="busy" @close="resetForm">
     <form class="reward-form" @submit.prevent="saveReward">
       <label>奖励名称<input v-model="formTitle" type="text" maxlength="60" placeholder="例如：周末奶茶任选" required/></label>
       <label>简介<input v-model="formDescription" type="text" maxlength="150" placeholder="兑换后怎么兑现"/></label>
       <div class="form-fields">
         <label>图标<select v-model="formIcon">
           <option v-for="emoji in ['🎁','🍦','🎬','🍖','🛋️','🐱','☕','🌸','🎮','🎟️','🧹','🎉']" :key="emoji">{{ emoji }}</option>
         </select></label>
         <label>积分<input v-model="formCost" type="number" inputmode="numeric" min="10" max="10000" step="1" required/></label>
         <label>库存<input v-model="formStock" type="number" inputmode="numeric" min="0" max="9999" placeholder="无限"/></label>
       </div>
       <label>关联心愿储值额度（¥/件，0 表示不关联）
         <input v-model="formCredit" type="number" inputmode="numeric" min="0" max="100000" step="1"/>
       </label>
       <small class="reward-credit-help">大于 0 时，兑换人须选择已关联累计储值的心愿。属于家庭奖励额度，不是实际存款。</small>
       <label class="checkbox-line"><input v-model="formActive" type="checkbox"/> 上架</label>
       <button type="submit" class="save-btn" :disabled="busy">{{ busy?'保存中…':'保存奖励' }}</button>
     </form>
     </EditBottomSheet>
     <div v-if="recentGroupOrders.length" class="pool-section">
       <b class="pool-title"><AppIcon name="handshake" :size="17"/> 合力兑换</b>
       <article v-for="order in recentGroupOrders" :key="order.id" class="pooled-order">
         <div class="pool-heading"><strong>{{ order.icon }} {{ order.title }}</strong>
           <small>{{ order.status==='collecting'?'凑分中':order.status==='requested'?'待兑现':order.status==='fulfilled'?'已兑现':'已取消' }}</small>
         </div>
         <div class="pool-status"><b>{{ order.status==='cancelled'?'已返还':fmt(order.fundedPoints)+' / '+fmt(order.points)+' 分' }}</b>
           <span>{{ dateText(order.createdAt) }}</span></div>
         <div v-if="order.status!=='cancelled'" class="challenge-bar">
           <span :style="{width:Math.min(100,order.fundedPoints/order.points*100)+'%'}"></span>
         </div>
         <small v-if="order.goalCreditYen>0" class="reward-goal-note">心愿{{ order.wishTitle?'「'+order.wishTitle+'」':'' }} · 奖励额度 ¥{{ Number(order.goalCreditYen).toLocaleString('ja-JP') }} · {{ order.status==='collecting'?'凑齐后计入':'已计入储值' }}</small>
         <div v-if="order.contributions.length" class="pool-contributors">
           <span v-for="c in order.contributions" :key="c.userId">{{ c.displayName }}：{{ fmt(c.points) }}分</span>
         </div>
         <div v-if="order.status==='collecting'" class="pool-contribute">
           <button type="button" class="redeem-btn" :disabled="busy||points<1" @click="poolContributionOpen=order.id">出资积分</button>
           <button type="button" class="pool-cancel" :disabled="busy" @click="cancelPool(order)">取消并退分</button>
           <EditBottomSheet v-if="poolContributionOpen===order.id" :title="'合力出资 · '+order.title" :close-disabled="busy" @close="poolContributionOpen=''">
             <div class="pool-contribute-sheet">
               <p>尚需 {{ fmt(Math.max(0,order.points-order.fundedPoints)) }} 分 · 我的可用积分 {{ fmt(points) }} 分</p>
               <label>我出多少积分
                 <input v-model="poolAmount[order.id]" type="number" inputmode="numeric" min="1"
                    :max="order.points-order.fundedPoints"
                    :placeholder="String(Math.min(Math.ceil(order.points/2),order.points-order.fundedPoints))"/>
               </label>
               <p v-if="error" role="alert" class="points-error">{{ error }}</p>
               <button type="button" class="redeem-btn" :disabled="busy||points<1" @click="contributePool(order)">确认出资</button>
             </div>
           </EditBottomSheet>
         </div>
         <button v-else-if="order.status==='requested'" type="button" class="redeem-btn pool-fulfill"
           :disabled="busy" @click="fulfillPool(order)">确认已经兑现</button>
       </article>
       <nav v-if="(shop?.groupPages||1)>1" class="lottery-history-pagination shop-pagination" aria-label="合力订单分页">
         <button type="button" :disabled="busy||loading||groupPage<=1" @click="changeShopPage('group',groupPage-1)">上一页</button>
         <span>第 {{ groupPage }} / {{ shop?.groupPages }} 页 · 共 {{ shop?.groupTotal }} 笔</span>
         <button type="button" :disabled="busy||loading||groupPage>=(shop?.groupPages||1)" @click="changeShopPage('group',groupPage+1)">下一页</button>
       </nav>
     </div>
     <div v-if="shop?.redemptions.length" class="history-section">
       <b>兑换记录</b>
       <div v-for="record in shop.redemptions" :key="record.id" class="history-row">
         <span>{{ record.icon }}</span>
         <div><strong>{{ record.title }}</strong><small>{{ record.redeemedByName }} · {{ record.quantity||1 }}件 · {{ record.points }}分 · {{ dateText(record.createdAt) }}<template v-if="record.creditedYen>0"> · 心愿奖励 ¥{{ Number(record.creditedYen).toLocaleString('ja-JP') }}{{ record.wishTitle?' → '+record.wishTitle:'' }}</template></small></div>
         <span class="history-status" :class="{fulfilled:record.status==='fulfilled'}">{{ record.status==='fulfilled'?'已兑现':'待兑现' }}</span>
         <button v-if="record.status==='requested'" type="button" :disabled="busy" @click="fulfill(record)">确认兑现</button>
       </div>
       <nav v-if="(shop?.redemptionPages||1)>1" class="lottery-history-pagination shop-pagination" aria-label="商城兑换历史分页">
         <button type="button" :disabled="busy||loading||redemptionPage<=1" @click="changeShopPage('redemption',redemptionPage-1)">上一页</button>
         <span>第 {{ redemptionPage }} / {{ shop?.redemptionPages }} 页 · 共 {{ shop?.redemptionTotal }} 笔</span>
         <button type="button" :disabled="busy||loading||redemptionPage>=(shop?.redemptionPages||1)" @click="changeShopPage('redemption',redemptionPage+1)">下一页</button>
       </nav>
     </div>
   </template>
   <p v-if="!data&&loading" class="points-loading">正在读取积分与奖励…</p>
   <p v-if="error" role="alert" class="points-error">{{ error }}
     <button type="button" class="points-retry" @click="refresh">刷新</button>
   </p>
   </div>
 </section>
</template>
<style scoped>
.points-board{display:grid;align-content:start;gap:12px;min-width:0}
.points-board--collapsed{padding:10px 13px;margin:10px 0}
.points-entry{width:100%;display:flex;align-items:center;gap:10px;text-align:left;
  padding:3px 1px;min-height:48px;border:0;background:none;color:#344c3d}
.points-entry-icon{display:grid;place-items:center;flex:none;width:38px;height:38px;
  background:#f0f7ef;border-radius:11px;font-size:21px}
.points-entry-main{min-width:0;flex:1;display:grid;gap:3px}
.points-entry-main strong{font-size:14px;line-height:1.3}
.points-entry-main small{font-size:11px;color:#748c7a;line-height:1.4}
.points-entry-right{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#4a8662;white-space:nowrap;line-height:1}
.points-chevron-right{transform:rotate(-90deg)}
.points-entry:focus-visible,.points-collapse:focus-visible{outline:2px solid #43866a;outline-offset:3px}
.points-expanded{display:grid;align-content:start;gap:11px;min-width:0}
.points-collapse{display:inline-flex;align-items:center;justify-content:center;gap:4px;
  border:0;background:#f3f8f2;color:#518069;border-radius:8px;
  font-size:12px;line-height:1;min-height:30px;padding:4px 11px;white-space:nowrap}
.points-chevron-up{transform:rotate(180deg)}
.points-head,.shop-title,.form-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.points-head h2{margin:0;font-size:17px;line-height:1.4}
.points-title-wrap{position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0}
/* The tappable area stays comfortable, but only the inner 15px glyph is visible.
   Fixed min/max sizes prevent iOS/PWA button sizing from stretching the circle. */
.points-rule-help{display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 26px;width:26px;height:26px;min-width:26px;max-width:26px;
  min-height:26px;max-height:26px;padding:0;margin:0;align-self:center;
  border:0;border-radius:50%;background:transparent;color:#527962;
  font-size:10px;line-height:1;appearance:none;-webkit-appearance:none}
.points-rule-help .points-help-glyph{display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 15px;width:15px;height:15px;min-width:15px;min-height:15px;
  max-width:15px;max-height:15px;aspect-ratio:1;
  box-sizing:border-box;border:1px solid #b8ccc0;border-radius:50%;
  background:#f7faf7;color:#527962;font-size:10px;font-weight:700;line-height:1}
.points-my-card .points-rule-help .points-help-glyph{font-size:10px;color:#527962}
.points-rule-help:focus-visible{outline:2px solid #43866a;outline-offset:2px}
.points-rule-popover{position:absolute;top:calc(100% + 9px);left:0;z-index:20;
  width:min(290px,calc(100vw - 64px));box-sizing:border-box;
  background:#fff;border:1px solid #dce9de;border-radius:11px;
  box-shadow:0 10px 25px #27352f26;padding:11px 13px;text-align:left;
  font-size:12px;line-height:1.65;color:#526f5b}
.points-rule-popover b{display:block;margin-bottom:3px;color:#3b674e;font-size:12px}
.points-rule-popover p{margin:0;overflow-wrap:anywhere}
.points-head small{font-size:12px;color:#52846c;font-weight:650;white-space:nowrap}
.points-hint{margin:0;color:#75877a;font-size:12px;line-height:1.55}
.points-my-card{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.xp-label{position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0}
.points-my-card>div{display:grid;gap:5px;border-radius:12px;background:#f2f8f2;padding:11px;min-width:0}
.points-my-card small{color:#658775;font-size:11px;line-height:1.5}
.points-my-card strong{font-size:22px;color:#377c59;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.points-my-card span{font-size:11px;color:#6e8676}
.own-level-line,.challenge-bar{height:6px;background:#e3eee4;border-radius:99px;overflow:hidden}
.own-level-line span,.challenge-bar span{display:block;height:100%;background:#61ab7d;border-radius:99px}
.points-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.points-member{min-width:0;padding:10px;border-radius:11px;background:#f9faf8;border:1px solid #e7eee7}
.points-name{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;min-width:0}
.points-name b{font-size:13px;color:#344f3e;min-width:0;flex:0 1 auto;
 white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.points-me{flex:none;font-size:10px;color:#739680}
/* Contribution leader: luminous lime-green gradient, keeping the trophy beside
   the name. Wallet leader styles below intentionally take priority if both win. */
.points-member--champion{
 border:2px solid transparent;
 background:
  linear-gradient(145deg,#fbfff7 0%,#fffefa 55%,#f0ffe1 100%) padding-box,
  linear-gradient(125deg,#b6ff62 0%,#6cf03a 27%,#c7ff85 51%,#42df33 77%,#a9ff57 100%) border-box;
 box-shadow:0 0 0 1px #a5f26b96,0 0 15px #89f64a66,0 5px 14px #4cae4f26,inset 0 0 0 1px #f5ffe8;
}
/* Wealthiest household wallet: metallic gold frame, with no extra title badge or
   icon. Keep the gold treatment separate from the contribution trophy. */
.points-member--wealthy{
 border:2px solid transparent;
 background:
  linear-gradient(145deg,#fffefa 0%,#fffaf0 60%,#fff3d9 100%) padding-box,
  linear-gradient(125deg,#b48129 0%,#ffe9a6 26%,#d39e3b 52%,#fff0b8 74%,#a86b1c 100%) border-box;
 box-shadow:0 0 0 1px #d3ae5a55,0 5px 14px #9b74221c,inset 0 0 0 1px #fff9e7;
}
.points-member--wealthy .points-available{
 background:linear-gradient(100deg,#fff3d0 0%,#ffeed0 55%,#f8e4b1 100%);
 color:#886321;
}
.points-member--wealthy .points-available strong{color:#9a681e}
.points-honors{display:inline-flex;flex:none;align-items:center;gap:2px;white-space:nowrap}
.points-honor{display:inline-flex;flex:none;align-items:center;justify-content:center;
 font-size:16px;line-height:1;white-space:nowrap}
.points-score{display:flex;align-items:baseline;gap:5px;margin-top:5px}
.points-score strong{font-size:22px;color:#38815b;font-variant-numeric:tabular-nums}
.points-score span,.points-level,.points-details{font-size:11px;color:#728574}
.points-available{display:flex;align-items:baseline;justify-content:space-between;gap:4px;
 flex-wrap:wrap;margin:8px 0 6px;padding:6px 8px;border-radius:8px;background:#edf5ee;
 font-size:11px;line-height:1.4;color:#5a7864}
.points-available strong{color:#347c55;font-size:16px;font-variant-numeric:tabular-nums}
.points-details{display:block;margin-top:7px}
.points-private{margin:0;color:#42694c;font-size:12px;line-height:1.6}
.points-private summary{display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:pointer;list-style:none}
.points-private summary::-webkit-details-marker{display:none}
.points-private-chevron{flex:none;color:#758c7b;transition:transform .2s}
.points-private[open] .points-private-chevron{transform:rotate(180deg)}
.points-bonus-breakdown{margin:5px 0 0;color:#758c7b;font-size:11px;line-height:1.5}
.points-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;border-radius:11px;background:#f2f5f0}
.points-tabs button{min-width:0;white-space:nowrap;border:0;border-radius:8px;background:transparent;padding:9px 3px;font-size:clamp(10px,3vw,13px);color:#657b6b;display:flex;justify-content:center;align-items:center;gap:4px}
.points-tabs button.chosen{background:white;color:#397a54;font-weight:700;box-shadow:0 1px 4px #00000012}
 .lottery-card{display:grid;gap:12px;border:1px solid #e4ede6;border-radius:13px;padding:12px;background:#fbfdfa}
 .lottery-main{display:flex;align-items:center;gap:12px;min-width:0}
 .lottery-box{
 position:relative;isolation:isolate;overflow:hidden;box-sizing:border-box;
 flex:0 0 clamp(102px,29vw,122px);height:145px;min-width:0;
 display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;
 padding:12px 5px 9px;border-radius:21px;border:1px solid #cae3d5;color:#36795b;
 background:linear-gradient(145deg,#f4fff8 0%,#e0f3e6 48%,#cdebdc 100%);
 box-shadow:inset 0 2px 0 #ffffffed,inset 0 -6px 0 #a8d6c05c,0 8px 18px #357d5930
}
.lottery-box:after{
 content:'';position:absolute;inset:-35%;z-index:0;pointer-events:none;
 background:linear-gradient(113deg,transparent 35%,#ffffffa3 49%,transparent 64%);
 transform:translateX(-85%) rotate(-12deg);animation:lottery-box-glint 5.6s ease-in-out infinite
}
.lottery-box-glow{
 position:absolute;inset:22px 18px 34px;border-radius:50%;z-index:0;
 background:radial-gradient(circle,#ffefb4c7 0%,#d8f7d6ab 42%,transparent 73%);
 filter:blur(5px);animation:lottery-box-breathe 3.6s ease-in-out infinite
}
.lottery-box-spark{
 position:absolute;z-index:2;font-size:14px;line-height:1;color:#d6a94f;
 text-shadow:0 0 7px #fff6c8;pointer-events:none;
 animation:lottery-box-twinkle 3.1s ease-in-out infinite
}
.lottery-box-spark--one{top:13px;left:11px;animation-delay:-.2s}
.lottery-box-spark--two{top:29px;right:7px;color:#edc86f;font-size:19px;animation-delay:-1.4s}
.lottery-box-spark--three{top:68px;left:8px;font-size:19px;color:#83cba2;animation-delay:-2.3s}
.lottery-box-spark--four{top:78px;right:12px;font-size:10px;animation-delay:-.9s}
.lottery-chest{
 position:relative;z-index:1;width:74px;height:70px;flex:none;
 filter:drop-shadow(0 6px 5px #3c8b6960);
 animation:lottery-chest-float 3.4s ease-in-out infinite
}
.lottery-chest-top{
 position:absolute;z-index:3;left:1px;right:1px;top:17px;height:20px;
 border-radius:10px 10px 6px 6px;border:1px solid #449a75;
 background:linear-gradient(100deg,#a0dbba 0%,#5db58e 50%,#429970 100%);
 box-shadow:inset 0 3px 2px #e4fff690,0 3px 3px #3c786a3d
}
.lottery-chest-front{
 position:absolute;left:6px;right:6px;top:32px;height:34px;
 border:1px solid #398c67;border-radius:5px 5px 12px 12px;
 background:linear-gradient(130deg,#b8ebc4 0%,#80cda1 45%,#4fa477 100%);
 box-shadow:inset 4px 0 6px #e4ffec88,inset -4px -3px 5px #27745244
}
.lottery-chest-ribbon{
 position:absolute;left:calc(50% - 6px);width:12px;top:0;bottom:0;
 background:linear-gradient(90deg,#d49f43,#fff0b4 45%,#e0af54);box-shadow:1px 0 2px #8d682740
}
.lottery-chest-slot{
 position:absolute;left:calc(50% - 18px);width:36px;height:4px;top:5px;
 border-radius:9px;border:1px solid #4b946e;background:#286648;
 box-shadow:inset 0 1px 2px #173c33b0,0 1px 0 #d7f4df
}
.lottery-chest-bow{
 position:absolute;z-index:4;top:-21px;width:26px;height:22px;
 border:6px solid #f9d992;background:linear-gradient(140deg,#fff8cf,#f2bc63);
 box-sizing:border-box;box-shadow:0 1px 3px #845e3047
}
.lottery-chest-bow--left{left:12px;border-radius:20px 18px 5px 18px;transform:rotate(-28deg)}
.lottery-chest-bow--right{right:12px;border-radius:18px 20px 18px 5px;transform:rotate(28deg)}
.lottery-chest-seal{
 position:absolute;z-index:2;top:9px;left:calc(50% - 9px);
 display:grid;place-items:center;width:18px;height:18px;
 border-radius:50%;background:linear-gradient(135deg,#fff8d5,#e9b84b);
 color:#9a631d;font-size:11px;line-height:1;border:1px solid #c08a30;
 box-shadow:0 1px 3px #946f2c3b
}
.lottery-box-label{
 position:relative;z-index:2;line-height:1.2;white-space:nowrap;
 border:1px solid #deb86d;border-radius:99px;
 padding:3px 10px;background:linear-gradient(120deg,#fff8e4,#f9dfaa);
 color:#7e632e;box-shadow:0 2px 3px #a4822e20;
 font-size:11px;font-weight:800;letter-spacing:.08em
}
.lottery-box-subtitle{
 position:relative;z-index:2;color:#638b70;font-size:9px;
 white-space:nowrap;line-height:1.2;letter-spacing:0
}
.lottery-box--rolling{
 transform-origin:50% 88%;animation:lottery-box-shuffle .46s ease-in-out infinite;
 box-shadow:inset 0 2px 0 #fff,inset 0 -6px 0 #a8d6c05c,0 0 0 2px #ffe6a780,0 0 24px #eecb7b98
}
.lottery-box--rolling .lottery-chest{animation:lottery-chest-roll .46s ease-in-out infinite}
.lottery-box--rolling:after{animation:lottery-box-glint .7s ease-in-out infinite}
.lottery-box--jackpot{
 border-color:#ecc25d;background:linear-gradient(140deg,#fff9dc,#ffdf93 55%,#f6c866);
 box-shadow:0 0 0 2px #ffdf7caa,0 0 30px #ffcc4abb,inset 0 1px 0 #fff;
 animation:lottery-box-jackpot 1.05s ease-in-out infinite
}
.lottery-box--jackpot .lottery-box-glow{
 background:radial-gradient(circle,#fff6c4 0%,#f6c95ab8 45%,transparent 76%)
}
.lottery-box--jackpot .lottery-chest{
 filter:drop-shadow(0 0 8px #fff6ad);animation:lottery-chest-jackpot .8s ease-in-out infinite
}
.lottery-box--jackpot .lottery-box-spark{color:#ffba2d;text-shadow:0 0 12px #fff}
@keyframes lottery-box-breathe{0%,100%{opacity:.53;transform:scale(.92)}
 50%{opacity:1;transform:scale(1.16)}}
@keyframes lottery-chest-float{0%,100%{transform:translateY(1px)}
 50%{transform:translateY(-4px)}}
@keyframes lottery-box-twinkle{0%,100%{opacity:.25;transform:scale(.55)}
 42%{opacity:1;transform:scale(1.18)}70%{opacity:.48;transform:scale(.9)}}
@keyframes lottery-box-glint{0%,20%{transform:translateX(-85%) rotate(-12deg)}
 52%,100%{transform:translateX(95%) rotate(-12deg)}}
@keyframes lottery-box-shuffle{0%,100%{transform:rotate(0deg) scale(1)}
 25%{transform:rotate(-6deg) translateY(-3px) scale(1.03)}
 75%{transform:rotate(6deg) translateY(-3px) scale(1.03)}}
@keyframes lottery-chest-roll{0%,100%{transform:translateY(0) scale(1)}
 50%{transform:translateY(-5px) scale(1.12)}}
@keyframes lottery-box-jackpot{0%,100%{filter:brightness(1)}50%{filter:brightness(1.12)}}
@keyframes lottery-chest-jackpot{0%,100%{transform:scale(1)}
 50%{transform:scale(1.16) rotate(-5deg)}}
@media(max-width:360px){
 .lottery-main{gap:9px}
 .lottery-box{flex-basis:96px;height:132px;padding:9px 3px}
 .lottery-chest{width:66px;height:62px;margin-bottom:-4px}
 .lottery-chest-top{top:15px}
 .lottery-chest-front{top:30px}
 .lottery-chest-bow--left{left:9px}
 .lottery-chest-bow--right{right:9px}
 .lottery-box-subtitle{font-size:8px}
 .lottery-box-spark--two{right:3px}
}
@media(prefers-reduced-motion:reduce){
 .lottery-box:after,.lottery-box-glow,.lottery-box-spark,
 .lottery-chest,.lottery-box--rolling,.lottery-box--jackpot{animation:none!important}
 .lottery-box:after{display:none}
 .lottery-box-glow{opacity:.75}
}
.lottery-panel{display:grid;gap:5px;min-width:0;flex:1}
 .lottery-panel>b{font-size:15px;color:#365b43}
 .lottery-panel small{font-size:11px;color:#708977}
 .lottery-spin{justify-self:start;min-height:35px;margin-top:5px}
 .lottery-spin:disabled{opacity:.55}
 .lottery-result{display:flex;align-items:center;gap:9px;border-radius:10px;background:#eef7ef;padding:10px;color:#3b7656}
 .lottery-result>div{display:grid;gap:4px}
 .lottery-result b{font-size:14px}.lottery-result small{font-size:11px;color:#668774}
 .lottery-odds{position:relative;min-width:0}
 .lottery-odds-heading{display:flex;align-items:center;gap:1px;min-height:26px}
 .lottery-odds-toggle{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:0;
   border:0;background:none;color:#4a8265;font-size:12px;text-align:left;cursor:pointer}
 .lottery-odds-toggle:focus-visible{outline:2px solid #43866a;outline-offset:2px}
 .lottery-odds-toggle :deep(svg){transform:rotate(-90deg);transition:transform .2s}
 .lottery-odds-toggle :deep(svg.lottery-odds-chevron-open){transform:rotate(0)}
 .lottery-rule-popover{top:calc(26px + 9px)}
 .lottery-odds-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
 .lottery-odds-grid>div{display:flex;justify-content:space-between;gap:6px;padding:6px 8px;border-radius:7px;background:#f2f7f2;color:#58715e;font-size:11px}
.lottery-history-pagination{display:flex;justify-content:center;align-items:center;gap:12px;
  padding:12px 0 2px;min-height:42px}
 .lottery-history-pagination button{flex:0 0 auto;min-height:38px;padding:7px 12px;border-radius:9px;
  border:1px solid #cfe2d3;background:#f5faf5;color:#3e805d;font-size:12px;font-weight:650}
 .lottery-history-pagination button:disabled{opacity:.42}
 .lottery-history-pagination span{font-size:11px;color:#768b7c;white-space:nowrap}
  .challenge-card{background:#f5faf5;border-radius:12px;padding:12px;display:grid;gap:9px}
.challenge-card>div:first-child{display:flex;justify-content:space-between;font-size:13px;color:#43674e}
.challenge-card small{font-size:11px;color:#678477}
.monthly-achievement-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin:3px 0 8px;color:#43674e;font-size:12px}.monthly-achievement-heading small{font-size:11px;color:#71867a}.badges-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.achievement{display:grid;justify-items:center;gap:4px;padding:10px 4px;border-radius:10px;background:#f4f9f3;min-width:0;text-align:center}
.achievement.locked{filter:grayscale(1);opacity:.55}
.achievement span{font-size:22px}.achievement b{font-size:11px}.achievement small{font-size:10px;color:#6f8a76}
.shop-title b,.history-section>b{font-size:14px;color:#426b50}
.small-outline{border:1px solid #cde1d1;background:white;color:#448765;border-radius:8px;padding:7px 10px;font-size:12px}
.reward-list{display:grid;gap:7px}
.reward-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto;
  align-items:center;gap:6px 9px;border:1px solid #e4ede6;border-radius:11px;padding:9px;min-width:0}
.reward-emoji{grid-column:1;grid-row:1;font-size:23px;background:#f4f8f3;
  width:38px;height:38px;border-radius:10px;display:grid;place-items:center}
.reward-details{grid-column:2;grid-row:1;min-width:0;display:grid;gap:3px}
.reward-details b{font-size:13px;overflow-wrap:anywhere}
.reward-details small{font-size:11px;color:#7b8d80;line-height:1.35;overflow-wrap:anywhere}
.reward-details>span{font-size:12px;color:#438266;font-weight:650}
.reward-buy{grid-column:3;grid-row:1;min-height:32px;white-space:nowrap}
.reward-actions{grid-column:2/-1;grid-row:2;display:flex;gap:6px;justify-content:flex-end;
  align-items:center;min-width:0;flex-wrap:wrap}
.reward-goal-note{font-size:11px;color:#578c69;line-height:1.35}
.wish-reward-sheet{display:grid;gap:12px;padding:2px 0 8px}
.wish-reward-sheet p{margin:0;color:#587660;font-size:12px;line-height:1.55}
.wish-reward-sheet label{display:grid;gap:7px;font-size:12px;color:#507457}
.wish-reward-sheet select{min-height:44px;width:100%;min-width:0;border:1px solid #d4e4d8;border-radius:9px;background:#fff;color:#345d44;padding:8px;font-size:14px}
.wish-reward-sheet .wish-reward-credit{font-size:14px;font-weight:700;color:#41815a}
.wish-reward-sheet .wish-reward-notice{color:#7b8c7c;font-size:11px}
.wish-reward-confirm{justify-self:stretch;min-height:42px}
.reward-credit-help{font-size:11px;color:#7b8c7c;line-height:1.5}
.quantity-stepper{display:inline-flex;align-items:center;flex:none;gap:0;border:1px solid #d7e8da;border-radius:8px;background:#f7faf7;overflow:hidden}
.quantity-stepper button{display:grid;place-items:center;min-width:29px;min-height:30px;border:0;background:none;color:#478466;font-size:17px;line-height:1}
.quantity-stepper button:disabled{opacity:.35}
.quantity-stepper span{min-width:19px;text-align:center;font-size:12px;color:#466d55;font-variant-numeric:tabular-nums;font-weight:700}
.redeem-btn,.save-btn{border:0;background:#468f65;color:white;border-radius:8px;padding:8px 10px;font-size:12px;font-weight:650}
.redeem-btn:disabled,.save-btn:disabled{opacity:.45}
.link-btn{border:0;background:transparent;color:#739483;font-size:11px;padding:6px 5px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.pool-section{display:grid;gap:8px;padding-top:9px;border-top:1px solid #ecf0ea}
.pool-section>b{font-size:14px;color:#426b50}.pool-title{display:flex;align-items:center;gap:6px}
.pooled-order{border:1px solid #dceadf;border-radius:11px;padding:11px;display:grid;gap:8px;background:#fafdfb;min-width:0}
.pool-heading,.pool-status{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pool-heading strong{font-size:13px;min-width:0;overflow-wrap:anywhere}
.pool-heading small{font-size:11px;color:#5d8a70;white-space:nowrap}
.pool-status b{font-size:12px;color:#3f8560}
.pool-status span{font-size:10px;color:#87998d}
.pool-contributors{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:11px;color:#708873}
.pool-contribute{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pool-contribute-sheet{display:grid;gap:12px}.pool-contribute-sheet p{margin:0;color:#6a816f;font-size:12px}
.pool-contribute-sheet label{display:grid;gap:6px;font-size:13px;color:#55755d}
.pool-contribute-sheet input{width:100%;min-height:44px;border:1px solid #d4e4d8;border-radius:9px;padding:9px;font-size:16px}
.pool-contribute label{display:flex;gap:5px;align-items:center;font-size:12px;color:#55755d}
.pool-contribute input{width:64px;box-sizing:border-box;border:1px solid #d4e4d8;border-radius:7px;padding:7px;font-size:14px}
.pool-cancel{background:none;border:0;color:#a17b70;font-size:11px;padding:6px}
.pool-fulfill{justify-self:start}
.hidden-rewards summary{font-size:12px;color:#758c7c;cursor:pointer}
.archived-row{display:flex;align-items:center;gap:5px;padding:7px 0;font-size:12px}
.archived-row span{flex:1}
.archived-row button,.form-heading button{background:none;border:0;color:#478466;font-size:12px;padding:4px}
.reward-form{display:grid;gap:12px;padding:0;border:0;background:transparent;min-width:0}
.reward-form label{display:grid;gap:4px;font-size:12px;color:#54735a;min-width:0}
.reward-form input:not([type=checkbox]),.reward-form select{width:100%;min-width:0;max-width:100%;box-sizing:border-box;border:1px solid #d4e0d4;background:#fff;border-radius:8px;padding:9px;font-size:14px;color:#314f3b}
.form-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.reward-form .checkbox-line{display:flex;align-items:center;gap:7px}
.save-btn{justify-self:end}
.history-section{display:grid;gap:8px;padding-top:9px;border-top:1px solid #ecf0ea}
.history-row{display:flex;gap:7px;align-items:center;min-width:0}
.history-row>span:first-child{font-size:19px}
.history-row>div{flex:1;min-width:0;display:grid;gap:3px}
.history-row strong{font-size:12px;overflow-wrap:anywhere}
.history-row small{font-size:10px;color:#829487}
.history-status{font-size:10px;color:#b1793c;white-space:nowrap}
.history-status.fulfilled{color:#589175}
.history-row button{font-size:11px;color:#467a59;background:#f3f8f3;border:0;border-radius:7px;padding:7px;white-space:nowrap}
.annual-history-head{display:grid;gap:8px}
.annual-history-head>b,.annual-ledger-title>b{font-size:14px;color:#426b50}
.annual-filters{display:flex;flex-wrap:wrap;align-items:end;gap:8px}
.annual-filters label{display:grid;gap:3px;min-width:0;font-size:11px;color:#748778}
.annual-filters select{min-width:90px;max-width:160px;height:35px;border:1px solid #d3e4d8;border-radius:8px;background:#fff;color:#345f48;padding:5px 7px;font-size:13px}
.annual-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.annual-member{display:grid;align-content:start;gap:7px;padding:10px;min-width:0;background:#f7faf6;border:1px solid #e2ece3;border-radius:11px}
.annual-member>b{font-size:13px;color:#355f47;overflow-wrap:anywhere}
.annual-member>div{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:3px;font-size:10px;color:#718776}
.annual-member strong{font-size:14px;color:#367e55;font-variant-numeric:tabular-nums}
.annual-member strong.annual-expired{color:#af6155}
.annual-note{margin:0;font-size:11px;color:#8a9189;line-height:1.5}
.annual-ledger{display:grid;gap:4px}
.annual-ledger-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:5px}
.annual-ledger-title small{font-size:10px;color:#8a998c}
.annual-ledger-row{display:flex;align-items:center;justify-content:space-between;min-width:0;gap:10px;padding:9px 0;border-bottom:1px solid #edf0ed}
.annual-ledger-row>div{display:grid;gap:4px;min-width:0;flex:1}
.annual-ledger-row b{font-size:12px;color:#456b52;overflow-wrap:anywhere}
.annual-ledger-row small{font-size:10px;color:#829586;line-height:1.35}
.annual-ledger-meta,.annual-ledger-breakdown{display:block;overflow-wrap:anywhere}
.annual-ledger-breakdown{color:#59816b!important;line-height:1.5!important}
.annual-ledger-row>strong.neutral{color:#89998d}
.annual-ledger-row>strong{flex:none;font-size:13px;color:#33845f;font-variant-numeric:tabular-nums}
.annual-ledger-row>strong.negative{color:#b97461}
.annual-pagination{display:flex;justify-content:center;align-items:center;gap:12px;padding:9px}
.annual-pagination button{min-height:34px;border:1px solid #d5e8da;background:#f8fcf8;color:#4b8364;border-radius:7px;padding:5px 9px;font-size:12px}
.annual-pagination button:disabled{opacity:.4}
.annual-pagination span{font-size:11px;color:#7a8c7d}
.points-loading,.points-error{margin:0;font-size:12px;color:#7c8c80}
.points-error{color:#a34b3d}
.points-retry{background:none;border:0;color:#438669;font-size:12px}
@media(max-width:360px){.reward-row{padding:8px;gap:5px}.reward-emoji{width:34px;height:34px}
.reward-actions{gap:2px}.link-btn{padding:5px 3px}.points-my-card strong{font-size:19px}
.points-board--collapsed{padding:9px 11px}}
</style>
