import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {stripTypeScriptTypes} from 'node:module'

const source=readFileSync(new URL('../src/components/ApprovalCenter.vue',import.meta.url),'utf8')
const extract=(begin,end)=>{
 const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length)
 assert.ok(a>=0&&b>a,'missing UI function '+begin)
 return stripTypeScriptTypes(source.slice(a,b),{mode:'strip'})
}
const load=extract('async function load(reset=true,preserveFeedback=false){',
 'async function toggle(){')
const act=extract("async function act(item:Approval,kind:'approve'|'reject'|'execute'|'cancel'){",
 '\n</script>')
function fixture(reply){
 const readPaths=[],postPaths=[]
 const ref=value=>({value})
 const state={
  props:{active:true,userId:'owner',isOwner:true},
  available:ref(true),busyId:ref(''),loading:ref(false),
  error:ref(''),message:ref(''),expanded:ref(true),
  filter:ref('approved'),page:ref(0),hasMore:ref(false),items:ref([]),
  epoch:0,requestGeneration:0,inFlightQuery:'',
  canExecute:item=>item.status==='approved'||item.status==='failed_retryable',
  confirmAction:async()=>true,
  getJson:async(path,options)=>{
   if(options?.method==='POST'){
    postPaths.push(path)
    if(reply instanceof Error)throw reply
    return reply
   }
   readPaths.push(path)
   return {items:[{request_id:'next',status:'applied'}],has_more:false}
  }
 }
 const ctx=vm.createContext(state)
 vm.runInContext(load+act+'\nthis.loadApprovals=load;this.actApproval=act;',ctx)
 return {ctx,state,readPaths,postPaths}
}
const approval={
 request_id:'33333333-3333-4333-8333-333333333333',
 requester_user_id:'member',status:'approved'
}
test('successful owner execution retains true applied feedback after the server-list refresh',async()=>{
 const {ctx,state,postPaths,readPaths}=fixture({ok:true,applied:true})
 await ctx.actApproval({...approval},'execute')
 assert.equal(postPaths.length,1)
 assert.equal(postPaths[0],'/api/approvals/'+approval.request_id+'/execute')
 assert.equal(readPaths.length,1)
 assert.equal(state.items.value[0].status,'applied')
 assert.equal(state.message.value,'已执行并入账')
 assert.equal(state.error.value,'')
 assert.equal(state.busyId.value,'')
})
test('uncertain target response remains visible as a safe-retry instruction even after the list refresh',async()=>{
 const {ctx,state,readPaths}=fixture(Error('target_conflict_unconfirmed_safe_to_retry'))
 await ctx.actApproval({...approval,status:'failed_retryable'},'execute')
 assert.equal(readPaths.length,1)
 assert.match(state.error.value,/执行结果尚未确认/)
 assert.match(state.error.value,/原审批/)
 assert.match(state.error.value,/不要新建申请/)
 assert.equal(state.busyId.value,'')
 assert.equal(state.message.value,'')
})
test('manual refresh clears stale feedback, but only an action-result refresh preserves it',async()=>{
 const {ctx,state}=fixture({ok:true,applied:true})
 await ctx.actApproval({...approval},'execute')
 assert.equal(state.message.value,'已执行并入账')
 await ctx.loadApprovals(true)
 assert.equal(state.message.value,'')
})
test('safe-retry feedback never confuses HomeFlow approval with target application',()=>{
 assert.match(source,/if\(!preserveFeedback\)\{error.value='';message.value=''\}/)
 assert.match(source,/await load\(true,true\)/)
 assert.match(source,/target_conflict_unconfirmed_safe_to_retry/)
 assert.match(source,/target_result_unknown_safe_to_retry/)
 assert.match(source,/result.applied===true\?'已执行并入账':'执行结果待核对'/)
 assert.match(source,/同一审批 ID 与家計簿的幂等记录核对结果/)
})
