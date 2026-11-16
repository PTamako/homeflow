// Scoped coordinated HomeFlow + Kakeibo production code release; never migrates D1 or mutates sibling finance secrets.
// Run ONLY inside the pinned GitHub Actions workflow, and keep all tokens out of logs.
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFileSync,spawnSync} from 'node:child_process'

const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
const stateFile=join(process.env.RUNNER_TEMP||'/tmp','homeflow-cross-bank-release.json')
const origin='https://homeflow.yupan6706.workers.dev'
const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account||'')
function fail(message){throw Error('HOMEFLOW_UI_HOTFIX_'+message)}
if(!process.env.GITHUB_ACTIONS||process.env.GITHUB_REF!=='refs/heads/main'||
   process.env.GITHUB_REPOSITORY!=='PTamako/homeflow'||!account||!token)fail('INVALID_RELEASE_CONTEXT')
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim()
git('merge-base','--is-ancestor','d4ceb85a63f485ec716faf64053f8781c59757f2','HEAD')
const files=git('diff','--name-only','d4ceb85a63f485ec716faf64053f8781c59757f2','HEAD').split('\n').filter(Boolean)
if(files.some(path=>!['scripts/deploy-homeflow-cross-bank-release.mjs','.github/workflows/homeflow-cross-bank-production-20261116.yml'].includes(path)))
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
const info=id=>api('GET','/workers/scripts/homeflow/versions/'+encodeURIComponent(id))
const bindingSignature=version=>{
 const a=version?.resources?.bindings
 if(!Array.isArray(a)||!a.length)fail('MISSING_BINDING_METADATA')
 return a.map(b=>[b.name,b.type,b.service||'',b.database_id||'',b.bucket_name||'',b.environment||''].join(':')).sort()
}
async function deploy(id){
 return api('POST','/workers/scripts/homeflow/deployments',{
  strategy:'percentage',versions:[{version_id:id,percentage:100}],
  annotations:{'workers/message':'HomeFlow owner approval hub + signed Kakeibo cross-bank source consent'}
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
   if(js.ok&&body.includes('management-personal-tab')&&body.includes('family-approval-recurring-tab'))return true
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,2500))
 }
 return false
}

const pagesOrigin='https://kakeibo-f17.pages.dev'
const kakeiboCommit='11ae6f4cfb7d827ec7d188587a98dde288c8a698'
async function canonicalPages(){
 const project=await api('GET','/pages/projects/kakeibo')
 return project.canonical_deployment||null
}
async function newPages(oldId){
 for(let i=0;i<18;i++){
  const page=await canonicalPages()
  if(page?.id!==oldId&&page?.environment==='production'&&page?.latest_stage?.status==='success')
   return page.id
  await new Promise(resolve=>setTimeout(resolve,1500))
 }
 fail('PAGES_ACTIVATION_NOT_CONFIRMED')
}
async function pagesHealthy(){
 for(let i=0;i<14;i++){
  try{
   const page=await fetch(pagesOrigin+'/?_bank_release='+Date.now(),{
    cache:'no-store',signal:AbortSignal.timeout(12000)})
   const html=await page.text()
   if(!page.ok)throw Error('PAGES_HTTP_'+page.status)
   const asset=html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)
   if(!asset)throw Error('PAGES_ASSETS_MISSING')
   const script=await fetch(pagesOrigin+asset[1],{cache:'no-store',signal:AbortSignal.timeout(12000)})
   const body=await script.text()
   if(script.ok&&body.includes('family:cross-bank'))return true
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,2400))
 }
 return false
}
async function rollbackPages(oldId){
 await api('POST','/pages/projects/kakeibo/deployments/'+oldId+'/rollback',{})
 for(let i=0;i<15;i++){
  const d=await canonicalPages()
  if(d?.id===oldId&&d?.latest_stage?.status==='success')return true
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
 return false
}

const phase=process.argv[2]
if(phase==='preflight'){
 const old=await active();if(!old)fail('NO_ACTIVE_VERSION')
 const page=await canonicalPages()
 if(!page?.id||page.environment!=='production'||page.latest_stage?.status!=='success')
  fail('NO_STABLE_PAGES_CANONICAL')
 const kakeiboHead=git('-C','.contract-kakeibo','rev-parse','HEAD')
 if(kakeiboHead!==kakeiboCommit)fail('UNREVIEWED_KAKEIBO_HEAD')
 const list=await versions();const items=list.items||[]
 if(!items.some(v=>v.id===old))fail('ACTIVE_VERSION_NOT_IN_INVENTORY')
 const current=await info(old)
 bindingSignature(current)
 await writeFile(stateFile,JSON.stringify({old,oldPages:page.id,existingIds:items.map(v=>v.id),
  commit:git('rev-parse','HEAD'),kakeiboCommit}),{mode:0o600})
 console.log('PREFLIGHT_PASS: active HomeFlow version and protected binding inventory captured')
}else if(phase==='activate'){
 const state=JSON.parse(await readFile(stateFile,'utf8'))
 if(state.commit!==git('rev-parse','HEAD')||await active()!==state.old)fail('PRODUCTION_VERSION_DRIFT')
 if(state.kakeiboCommit!==kakeiboCommit||
  git('-C','.contract-kakeibo','rev-parse','HEAD')!==kakeiboCommit)
  fail('UNREVIEWED_KAKEIBO_HEAD')
 if((await canonicalPages())?.id!==state.oldPages)fail('PAGES_PRODUCTION_VERSION_DRIFT')
 const items=(await versions()).items||[]
 const fresh=items.filter(v=>!state.existingIds.includes(v.id))
 if(fresh.length!==1)fail('NEW_VERSION_NOT_UNIQUE')
 const staged=fresh[0].id
 const [oldMeta,newMeta]=await Promise.all([info(state.old),info(staged)])
 const before=bindingSignature(oldMeta),after=bindingSignature(newMeta)
 if(JSON.stringify(before)!==JSON.stringify(after))fail('PROTECTED_BINDING_DRIFT')
 let attempted=false,pagesAttempted=false
 try{
  attempted=true
  await deploy(staged)
  if(!await visible(staged))fail('HOMEFLOW_ACTIVATION_NOT_CONFIRMED')
  if(!await healthy())fail('HOMEFLOW_SMOKE_FAILED')
  // Deploy the reviewed production Pages bundle only after HomeFlow is live.
  pagesAttempted=true
  const result=spawnSync('npx',['wrangler','pages','deploy','dist',
   '--project-name','kakeibo','--branch','main'],{
   cwd:'.contract-kakeibo',env:process.env,stdio:'inherit',timeout:240000
  })
  if(result.status!==0)fail('PAGES_DEPLOY_COMMAND_FAILED')
  await newPages(state.oldPages)
  if(!await pagesHealthy())fail('PAGES_NEW_ASSET_NOT_VISIBLE')
  console.log('DEPLOY_SUCCESS: HomeFlow signed consent + Kakeibo account-picker Pages are live; canonical Pages, health and bindings verified')
 }catch(e){
  console.error('RELEASE_FAILED_ROLLBACK_ATTEMPT:'+String(e.message))
  if(pagesAttempted){
   try{if(!await rollbackPages(state.oldPages))fail('PAGES_ROLLBACK_CONFIRMATION_FAILED')
    console.error('ROLLBACK_CONFIRMED: previous Kakeibo production Pages restored')}
   catch(rollback){console.error('PAGES_ROLLBACK_REQUIRES_MANUAL_INSPECTION:'+String(rollback))}
  }
  if(attempted){
   try{await deploy(state.old);if(!await visible(state.old))fail('WORKER_ROLLBACK_CONFIRMATION_FAILED')
    console.error('ROLLBACK_CONFIRMED: previous HomeFlow production Worker restored')}
   catch(rollback){console.error('WORKER_ROLLBACK_REQUIRES_MANUAL_INSPECTION:'+String(rollback))}
  }
  throw e
 }
}else fail('INVALID_PHASE')
