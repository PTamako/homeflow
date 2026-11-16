// Verify non-deployed, freshly uploaded versions of all four production
// Workers. Persist only non-secret version IDs and rollback IDs on runner.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {checkG8Bindings,REQUIRED_WORKERS} from './release-g8-binding-preflight.mjs';
const names=Object.keys(REQUIRED_WORKERS);
const base=()=> 'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(
 process.env.CLOUDFLARE_ACCOUNT_ID||'');
async function get(path){
 const r=await fetch(base()+path,{headers:{Authorization:'Bearer '+
  process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('G8_STAGE_HTTP_'+r.status);
 const x=await r.json();if(!x.success)throw Error('G8_STAGE_API');
 return x.result;
}
export async function checkStaged(){
 if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.RUNNER_TEMP||
  process.env.GITHUB_ACTIONS!=='true')throw Error('RELEASE_ENV_REQUIRED');
 const plan={},snapshot={workers:{},pages:{}};
 for(const name of names){
  const versions=await get('/workers/scripts/'+name+'/versions?per_page=5');
  const x=versions?.items?.[0];
  const d=await get('/workers/scripts/'+name+'/deployments');
  const active=(d.deployments||[])[0]?.versions||[];
  if(!x?.id||active.some(v=>v.version_id===x.id&&v.percentage>0))
   throw Error('STAGED_WORKER_ACTIVE_OR_NOT_UPLOADED:'+name);
  const current=active.find(v=>v.percentage===100)?.version_id;
  if(!current)throw Error('ROLLBACK_ACTIVE_VERSION_NOT_FOUND:'+name);
  const v=await get('/workers/scripts/'+name+'/versions/'+x.id);
  const bindings=(v.resources?.bindings||[]).map(b=>({
   name:b.name,type:b.type,...(b.type==='service'?{service:b.service}:{})}));
  plan[name]={new_version:x.id,old_version:current,
   commit_sha:v.annotations?.['workers/commit_sha']||null};
  snapshot.workers[name]={bindings};
 }
 const p=await get('/pages/projects/kakeibo');
 const prod=p.deployment_configs?.production;
 if(!prod)throw Error('PAGES_PRODUCTION_MISSING');
 snapshot.pages.kakeibo={production:{
  env_vars:Object.fromEntries(Object.keys(prod.env_vars||{}).map(k=>[k,true])),
  d1_databases:Object.fromEntries(Object.keys(prod.d1_databases||{}).map(k=>[k,true])),
  r2_buckets:Object.fromEntries(Object.keys(prod.r2_buckets||{}).map(k=>[k,true])),
  services:Object.fromEntries(Object.entries(prod.services||{}).
   map(([k,v])=>[k,{service:v?.service}]))
 }};
 const validation=checkG8Bindings(snapshot);
 if(!validation.ok)throw Error('G8_STAGED_BINDINGS_INCOMPLETE:'+validation.missing.slice(0,12).join(','));
 if(p.source?.config?.production_deployments_enabled!==false)
  throw Error('UNCOORDINATED_AUTO_PAGES_RELEASE_ENABLED');
 const staging={workers:plan,pages_old_deployment:p.latest_deployment?.id};
 await writeFile(join(process.env.RUNNER_TEMP,'four-app-staged-versions.json'),
  JSON.stringify(staging),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({staged_g8_names_types_targets_pass:true,workers:names,
  pages_kakeibo_config:true,secret_values_not_read:true,active_workers_unchanged:true,
  production_release_authorized:false}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 checkStaged().catch(e=>{console.error('STAGED_G8_BLOCKED:'+e.message);
  process.exitCode=1});
