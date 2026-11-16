// Narrow, one-off UI release: never migrates D1 or alters sibling services.
// Run ONLY inside the pinned GitHub Actions workflow, and keep all tokens out of logs.
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
const stateFile=join(process.env.RUNNER_TEMP||'/tmp','homeflow-member-confirmations.json')
const origin='https://homeflow.yupan6706.workers.dev'
const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account||'')
function fail(message){throw Error('HOMEFLOW_UI_HOTFIX_'+message)}
if(!process.env.GITHUB_ACTIONS||process.env.GITHUB_REF!=='refs/heads/main'||
   process.env.GITHUB_REPOSITORY!=='PTamako/homeflow'||!account||!token)fail('INVALID_RELEASE_CONTEXT')
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
git('merge-base','--is-ancestor','a664ff858e028de05fd42446c5e846c1abf5da3a','HEAD')
const files=git('diff','--name-only','a664ff858e028de05fd42446c5e846c1abf5da3a','HEAD').split('\n').filter(Boolean)
if(files.some(path=>!['scripts/deploy-homeflow-member-confirmations-20261116.mjs','.github/workflows/homeflow-member-confirmations-20261116.yml'].includes(path)))
 fail('UNEXPECTED_SOURCE_DELTA')
async function api(method,path,body){
 const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
 if(!r.ok)fail('CLOUDFLARE_HTTP_'+r.status)
 const d=await r.json();if(!d.success)fail('CLOUDFLARE_NOT_SUCCESS')
 return d.result
}
const deployments=()=>api('GET','/workers/scripts/homeflow/deployments')
const versions=()=>api('GET','/workers/scripts/homeflow/versions')
async function active(){
 const d=await deployments()
 return d.deployments?.[0]?.versions?.find(v=>v.percentage===100)?.version_id||''
}
async function info(id){
 for(let attempt=0;attempt<12;attempt++){
  try{return await api('GET','/workers/scripts/homeflow/versions/'+encodeURIComponent(id))}
  catch(e){
   if(!String(e).includes('CLOUDFLARE_HTTP_404')||attempt===11)throw e
   await new Promise(resolve=>setTimeout(resolve,1500))
  }
 }
 fail('VERSION_DETAILS_UNAVAILABLE')
}
const bindingSignature=version=>{
 const a=version?.resources?.bindings
 if(!Array.isArray(a)||!a.length)fail('MISSING_BINDING_METADATA')
 return a.map(b=>[b.name,b.type,b.service||'',b.database_id||'',b.bucket_name||'',b.environment||''].join(':')).sort()
}
async function deploy(id){
 return api('POST','/workers/scripts/homeflow/deployments',{
  strategy:'percentage',versions:[{version_id:id,percentage:100}],
  annotations:{'workers/message':'HomeFlow member-only personal inbox UI/API verified hotfix'}
 })
}
async function visible(id){
 for(let i=0;i<18;i++){
  if(await active()===id)return true
  await new Promise(resolve=>setTimeout(resolve,1500))
 }
 return false
}
async function healthy(){
 for(let i=0;i<12;i++){
  try{
   const health=await fetch(origin+'/api/health',{cache:'no-store',signal:AbortSignal.timeout(12000)})
   const json=await health.json()
   if(!health.ok||json.ok!==true||json.environment!=='production'||json.database!=='ready')throw Error('health')
   const page=await fetch(origin+'/?_hf_release='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(12000)})
   const html=await page.text()
   const asset=html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)
   if(!page.ok||!asset)throw Error('asset_missing')
   const js=await fetch(origin+asset[1],{cache:'no-store',signal:AbortSignal.timeout(12000)})
   const body=await js.text()
   if(js.ok&&body.includes('member-confirmations')&&body.includes('my-confirmations'))return true
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,2500))
 }
 return false
}
const phase=process.argv[2]
if(phase==='preflight'){
 const old=await active();if(!old)fail('NO_ACTIVE_VERSION')
 const list=await versions();const items=list.items||[]
 if(!items.some(v=>v.id===old))fail('ACTIVE_VERSION_NOT_IN_INVENTORY')
 const current=await info(old)
 bindingSignature(current)
 await writeFile(stateFile,JSON.stringify({old,existingIds:items.map(v=>v.id),commit:git('rev-parse','HEAD')}),{mode:0o600})
 console.log('PREFLIGHT_PASS: active HomeFlow version and protected binding inventory captured')
}else if(phase==='activate'){
 const state=JSON.parse(await readFile(stateFile,'utf8'))
 if(state.commit!==git('rev-parse','HEAD')||await active()!==state.old)fail('PRODUCTION_VERSION_DRIFT')
 const items=(await versions()).items||[]
 const fresh=items.filter(v=>!state.existingIds.includes(v.id))
 if(fresh.length!==1)fail('NEW_VERSION_NOT_UNIQUE')
 const staged=fresh[0].id
 const [oldMeta,newMeta]=await Promise.all([info(state.old),info(staged)])
 const before=bindingSignature(oldMeta),after=bindingSignature(newMeta)
 if(JSON.stringify(before)!==JSON.stringify(after))fail('PROTECTED_BINDING_DRIFT')
 let attempted=false
 try{
  attempted=true
  await deploy(staged)
  if(!await visible(staged))fail('ACTIVATION_NOT_CONFIRMED')
  if(!await healthy())fail('PRODUCTION_SMOKE_FAILED')
  const unauth=await fetch(origin+'/api/my-confirmations?page=0',{
    cache:'no-store',signal:AbortSignal.timeout(12000)})
  if(unauth.status!==401)fail('MEMBER_CONFIRMATIONS_ENDPOINT_NOT_PRIVATE')
  console.log('DEPLOY_SUCCESS: member-only actionable five-row inbox live; unauthorized access blocked, health and bindings verified')
 }catch(e){
  if(attempted){
   try{await deploy(state.old);if(!await visible(state.old))fail('ROLLBACK_CONFIRMATION_FAILED')
    console.error('ROLLBACK_CONFIRMED: previous HomeFlow production version restored')}
   catch(rollback){console.error('ROLLBACK_REQUIRES_MANUAL_INSPECTION:'+String(rollback))}
  }
  throw e
 }
}else fail('INVALID_PHASE')
