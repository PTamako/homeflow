// Coordinated four-app activation only after real Stage-F migrations and
// staged Cloudflare version checks. Roll back Worker traffic/Pages on failure.
// Never roll back D1 by guessing: additive schema remains, Time Travel
// bookmarks and encrypted owner backups provide the recovery boundary.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkG8Bindings,REQUIRED_WORKERS,REQUIRED_PAGES}
 from './release-g8-binding-preflight.mjs';
const names=['homeflow','kakeibo-homeflow-bridge','it-study-platform','jp-document-assistant'];
const apiRoot=()=> 'https://api.cloudflare.com/client/v4/accounts/'+
 encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID||'');
async function api(method,path,body){
 const r=await fetch(apiRoot()+path,{method,headers:{
  Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
  'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error('RELEASE_CLOUDFLARE_HTTP_'+r.status+':'+path.split('/').slice(-2).join('/'));
 const data=await r.json();if(!data.success)throw Error('RELEASE_CLOUDFLARE_API_UNSUCCESSFUL');
 return data.result;
}
async function current(name){
 const data=await api('GET','/workers/scripts/'+name+'/deployments');
 return data.deployments?.[0]?.versions?.find(x=>x.percentage===100)?.version_id||null;
}
export async function waitForVersion(name,id,{reads=15,delayMs=1200}={}){
 for(let attempt=0;attempt<reads;attempt++){
  if(await current(name)===id)return true;
  if(attempt<reads-1)await new Promise(resolve=>setTimeout(resolve,delayMs));
 }
 throw Error('ACTIVATION_VERSION_NOT_CONFIRMED_AFTER_POLLING:'+name);
}
async function setVersion(name,id){
 // Cloudflare deployments are asynchronous. POST success does not mean
 // the next immediate GET already reports 100% traffic for that version.
 if(await current(name)!==id)await api('POST','/workers/scripts/'+name+'/deployments',{
  strategy:'percentage',versions:[{percentage:100,version_id:id}]});
 return waitForVersion(name,id);
}
async function liveG8(){
 const snap={workers:{},pages:{}};
 for(const name of Object.keys(REQUIRED_WORKERS)){
  const x=await api('GET','/workers/scripts/'+name+'/settings');
  snap.workers[name]={bindings:(x.bindings||[]).map(b=>({
   name:b.name,type:b.type,...(b.type==='service'?{service:b.service}:{})}))};
 }
 const p=await api('GET','/pages/projects/kakeibo'),c=p.deployment_configs?.production||{};
 snap.pages.kakeibo={production:{
  env_vars:Object.fromEntries(Object.keys(c.env_vars||{}).map(k=>[k,true])),
  d1_databases:Object.fromEntries(Object.keys(c.d1_databases||{}).map(k=>[k,true])),
  r2_buckets:Object.fromEntries(Object.keys(c.r2_buckets||{}).map(k=>[k,true])),
  services:Object.fromEntries(Object.entries(c.services||{}).
   map(([k,v])=>[k,{service:v?.service}]))}};
 const result=checkG8Bindings(snap);
 if(!result.ok)throw Error('LIVE_G8_REQUIRED_BINDINGS_MISSING:'+result.missing.slice(0,12).join(','));
 return true;
}
export async function activate(){
 if(!process.env.RUNNER_TEMP||!process.env.CLOUDFLARE_API_TOKEN||
  !process.env.CLOUDFLARE_ACCOUNT_ID||process.env.GITHUB_ACTIONS!=='true')
  throw Error('CONTROLLED_RELEASE_ENV_MISSING');
 const plan=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,
  'four-app-staged-versions.json'),'utf8'));
 await readFile(join(process.env.RUNNER_TEMP,'four-app-d1-bookmarks.json'),'utf8');
 const oldPage=plan.pages_old_deployment;
 if(!oldPage||names.some(n=>!plan.workers?.[n]?.new_version||!plan.workers?.[n]?.old_version))
  throw Error('RELEASE_PLAN_INCOMPLETE');
 // Wait for a previous 100% rollback's eventual consistency before
 // starting a new coordinated cutover. Reject any truly unknown version.
 for(const name of names){
  await waitForVersion(name,plan.workers[name].old_version,{reads:15,delayMs:1000})
   .catch(()=>{throw Error('UNEXPECTED_PRODUCTION_VERSION_DRIFT:'+name)});
 }
 let pagesDeployed=false;
 const attempted=[];
 try{
  // Identity authority first; finance executors next; clients follow.
  for(const name of names){
   // Track attempt BEFORE POST, because a successful POST can time out
   // or return before the new version is visible to GET. We must roll
   // back even the version whose confirmation failed.
   attempted.push(name);
   await setVersion(name,plan.workers[name].new_version);
  }
  const child=spawnSync('npx',['wrangler','pages','deploy','dist',
   '--project-name','kakeibo','--branch','main'],{
   cwd:resolve('.contract-kakeibo'),stdio:'inherit',timeout:240000,
   env:process.env});
  if(child.status!==0)throw Error('PAGES_PRODUCTION_DEPLOY_FAILED');
  pagesDeployed=true;
  await liveG8();
  for(const [name,url] of [
   ['homeflow','https://homeflow.yupan6706.workers.dev/api/health'],
   ['kakeibo','https://kakeibo-f17.pages.dev/'],
   ['it-study-platform','https://it-study-platform.yupan6706.workers.dev/'],
   ['jp-document-assistant','https://jp-document-assistant.yupan6706.workers.dev/']
  ]){
   const res=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});
   if(![200,301,302,307,308].includes(res.status))
    throw Error('PRODUCTION_HTTP_SMOKE_FAILED:'+name+':'+res.status);
  }
  console.log(JSON.stringify({coordinated_production_activation:true,
   workers_active_full:4,pages_new_production_deployed:true,live_g8_presence_pass:true,
   initial_public_http_smoke_pass:true,external_institution_verified:false,
   two_iphone_verified:false}));
 }catch(e){
  console.error('RELEASE_ACTIVATION_FAILURE_BEGIN_ROLLBACK:'+e.message);
  if(pagesDeployed)try{
   await api('POST','/pages/projects/kakeibo/deployments/'+oldPage+'/rollback',{});
   console.error('PAGES_OLD_RELEASE_ROLLBACK_REQUESTED');
  }catch{console.error('PAGES_ROLLBACK_NEEDS_MANUAL_REVIEW')}
  for(const name of attempted.reverse()){
   try{await setVersion(name,plan.workers[name].old_version);
    console.error('WORKER_OLD_VERSION_RESTORED:'+name)}
   catch{console.error('WORKER_ROLLBACK_NEEDS_MANUAL_REVIEW:'+name)}
  }
  throw Error('PRODUCTION_ACTIVATION_FAILED_AND_ROLLBACK_ATTEMPTED');
 }
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 activate().catch(e=>{console.error('FOUR_APP_RELEASE_FAILURE:'+e.message);process.exitCode=1});
