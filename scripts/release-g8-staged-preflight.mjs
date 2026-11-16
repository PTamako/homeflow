// G8 pre-deploy: inspect immutable NON-ACTIVE Worker versions, not legacy live settings.
// Read-only. A PASS proves names/types/targets and reviewed SHAs, NEVER secret equality,
// OAuth runtime, migration safety, or release authorization.
import {fileURLToPath} from 'node:url';
import {REQUIRED_WORKERS, checkG8Bindings} from './release-g8-binding-preflight.mjs';

const names=Object.keys(REQUIRED_WORKERS).sort();
export function parseStagedPlan(raw){
 let obj;
 try{obj=JSON.parse(raw||'')}catch{throw Error('Invalid staged version plan JSON')}
 if(!obj||Array.isArray(obj)||typeof obj!=='object'||
  JSON.stringify(Object.keys(obj).sort())!==JSON.stringify(names))
  throw Error('Staged version plan must name exactly the four reviewed Workers');
 for(const n of names){
  const x=obj[n];
  if(!x||typeof x!=='object'||!/^[-a-f0-9]{36}$/i.test(x.version_id||'')||
   !/^[a-f0-9]{40}$/i.test(x.commit_sha||''))
   throw Error('Invalid staged version ID or reviewed commit SHA for '+n);
 }
 return obj;
}
export function verifyStagedSnapshot(snapshot,plan){
 const fail=[];
 for(const name of names){
  const s=snapshot.workers?.[name];
  if(!s){fail.push('staged:'+name+':unavailable');continue;}
  if(s.id!==plan[name].version_id)fail.push('staged:'+name+':version_mismatch');
  if(s.commit_sha!==plan[name].commit_sha)
   fail.push('staged:'+name+':reviewed_commit_mismatch');
  if(s.active)fail.push('staged:'+name+':already_active');
 }
 const live=checkG8Bindings({workers:Object.fromEntries(
  names.map(n=>[n,{bindings:snapshot.workers?.[n]?.bindings||[]}])),
  pages:snapshot.pages});
 return {staged_source_and_binding_presence_ok:fail.length===0&&live.ok,
  errors:[...fail,...live.missing].sort(),
  checked_workers:names,
  values_verified:false,
  financial_signatures_paired_verified:false,
  migration_applied_verified:false,
  production_deployment_authorized:false};
}
export async function collectStagedSnapshot({accountId,token,plan,fetcher=fetch}){
 if(!accountId||!token)throw Error('Cloudflare credentials unavailable');
 const root='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(accountId);
 const get=async(path,label)=>{
  const res=await fetcher(root+path,{method:'GET',headers:{Authorization:'Bearer '+token}});
  if(!res.ok)throw Error('Cloudflare staged G8 read denied for '+label+': HTTP '+res.status);
  const body=await res.json();
  if(!body?.success||!body.result)throw Error('Cloudflare staged G8 invalid response for '+label);
  return body.result;
 };
 const snapshot={workers:{},pages:{}};
 for(const name of names){
  const w=encodeURIComponent(name),id=encodeURIComponent(plan[name].version_id);
  const [version,deployments]=await Promise.all([
   get('/workers/scripts/'+w+'/versions/'+id,'version '+name),
   get('/workers/scripts/'+w+'/deployments','deployments '+name)]);
  snapshot.workers[name]={
   id:version.id,
   commit_sha:version.annotations?.['workers/commit_sha']||null,
   active:(deployments.deployments||[]).some(d=>
    (d.versions||[]).some(v=>v.version_id===plan[name].version_id&&v.percentage>0)),
   bindings:(version.resources?.bindings||[]).map(b=>({
    name:b.name,type:b.type,...(b.type==='service'?{service:b.service}:{})}))
  };
 }
 const pages=await get('/pages/projects/kakeibo','Pages kakeibo production');
 const p=pages.deployment_configs?.production;
 if(!p)throw Error('Pages production config missing');
 snapshot.pages.kakeibo={production:{
  env_vars:Object.fromEntries(Object.keys(p.env_vars||{}).map(k=>[k,true])),
  d1_databases:Object.fromEntries(Object.keys(p.d1_databases||{}).map(k=>[k,true])),
  r2_buckets:Object.fromEntries(Object.keys(p.r2_buckets||{}).map(k=>[k,true])),
  services:Object.fromEntries(Object.entries(p.services||p.service_bindings||{}).
   map(([k,v])=>[k,{service:v?.service||null}]))
 }};
 return snapshot;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  const plan=parseStagedPlan(process.env.FOUR_APP_STAGED_VERSIONS_JSON);
  const snapshot=await collectStagedSnapshot({
   accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
   token:process.env.CLOUDFLARE_API_TOKEN,plan});
  const result=verifyStagedSnapshot(snapshot,plan);
  console.log(JSON.stringify(result,null,2));
  if(!result.staged_source_and_binding_presence_ok)process.exitCode=1;
 }catch(e){
  // No token, version code, account ID, response body or binding values in logs.
  console.error('Staged G8 validation blocked: '+String(e.message||e));
  process.exitCode=2;
 }
}
