// The PRE-deploy half of G8: verify that all four reviewed repos declare the
// complete binding graph which will materialize *with* the production version.
// Never treat the old live Worker settings as proof of future deployments.
// The POST-deploy half remains scripts/release-g8-binding-preflight.mjs.
// No network, credentials, Preview resources, migrations or production writes.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SERVICE_TARGETS} from './release-g8-binding-preflight.mjs';

export const EXPECTED_OAUTH_REDIRECTS=Object.freeze({
  kakeibo:['https://kakeibo-f17.pages.dev/api/homeflow-sso/callback'],
  'it-study-platform':['https://it-study-platform.yupan6706.workers.dev/api/homeflow-sso/callback'],
  'jp-document-assistant':['https://jp-document-assistant.yupan6706.workers.dev/api/homeflow-sso/callback']
});
export const EXPECTED_HOMEFLOW_ORIGIN='https://homeflow.yupan6706.workers.dev';
export const EXPECTED_D1_IDS=Object.freeze({
 homeflow:'3e0205b0-77e2-4259-8ac2-4c56efc43f8a',
 'it-study-platform':'ed4ca935-5d00-4f38-b3c5-c0d53c5aad63',
 'jp-document-assistant':'22a671c0-3f6c-4707-adf1-b24ac95330c6',
 kakeibo:'4d790915-fc06-4073-b660-bbb51dc74463'
});
const sources=[
 ['homeflow','wrangler.toml'],
 ['it-study-platform','.contract-study/wrangler.toml'],
 ['jp-document-assistant','.contract-document/wrangler.jsonc'],
 ['kakeibo-homeflow-bridge','.contract-kakeibo/wrangler.homeflow-bridge.toml'],
 ['kakeibo','.contract-kakeibo/wrangler.toml']
];
export function loadG8SourcePlans(root=process.cwd()){
 return Object.fromEntries(sources.map(([name,p])=>[name,readFileSync(resolve(root,p),'utf8')]));
}
function parseTomlPlan(src){
 const services=[],dbs=[],r2=[];
 let group=null,record=null;
 const variables={};
 for(const literal of src.split(/\r?\n/)){
  const line=literal.trim();
  if(!line||line.startsWith('#'))continue;
  if(line.startsWith('[')){
   const header=line.match(/^\[\[?([a-zA-Z0-9_.-]+)\]?\]$/)?.[1];
   if(header==null){group='unknown';record=null;continue;}
   group=header;
   record=null;
   if(header==='services'){record={};services.push(record)}
   if(header==='d1_databases'){record={};dbs.push(record)}
   if(header==='r2_buckets'){record={};r2.push(record)}
   continue;
  }
  const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if(!m)continue;
  const [ ,key,part]=m;
  let value=part.replace(/\s+#.*$/,'').trim();
  if(value.startsWith('"')){try{value=JSON.parse(value)}catch{value='__INVALID_JSON__'}}
  else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
  if(record)record[key]=value;
  if(group==='vars')variables[key]=value;
 }
 return {services,dbs,r2,vars:variables};
}
function parseJsoncPlan(src){
 // Only full-line comments are supported by our reviewed Wrangler JSONC.
 // Do not remove // inside quoted https:// URL values.
 const clean=src.split(/\r?\n/).filter(line=>!/^\s*\/\//.test(line)).join('\n');
 const data=JSON.parse(clean);
 return {services:data.services||[],dbs:data.d1_databases||[],
  r2:data.r2_buckets||[],vars:data.vars||{},
  preview_urls:data.preview_urls};
}
export function checkG8SourcePlans(raw){
 const errors=[],parsed={};
 for(const [name] of sources){
  try{
   if(typeof raw?.[name]!=='string')throw Error('missing');
   parsed[name]=name==='jp-document-assistant'?
    parseJsoncPlan(raw[name]):parseTomlPlan(raw[name]);
  }catch{
   errors.push('source:'+name+':missing_or_invalid');continue;
  }
 }
 for(const [name,plan] of Object.entries(parsed)){
  const names=new Set();
  for(const item of plan.services){
   const binding=item.binding;
   if(!binding||names.has(binding)){
    errors.push('source:'+name+':duplicate_or_empty_service');continue;
   }
   names.add(binding);
  }
  const expected=name==='kakeibo'?
    {HOMEFLOW_IDENTITY_SERVICE:'homeflow'}:(SERVICE_TARGETS[name]||{});
  for(const [binding,target] of Object.entries(expected)){
   if(plan.services.find(s=>s.binding===binding)?.service!==target)
    errors.push('source:'+name+':wrong_or_missing_service:'+binding);
  }
  const expectedDb=name==='kakeibo-homeflow-bridge'?'kakeibo':name;
  if(plan.dbs.find(d=>d.binding==='DB')?.database_id!==EXPECTED_D1_IDS[expectedDb])
   errors.push('source:'+name+':wrong_production_D1');
 }
 if(!/^preview_urls\s*=\s*false\s*$/m.test(raw?.homeflow||''))
  errors.push('source:homeflow:preview_urls_must_be_false');
 const h=parsed.homeflow?.vars||{};
 try{
  if(JSON.stringify(JSON.parse(h.OAUTH_CLIENT_REDIRECTS))!==JSON.stringify(EXPECTED_OAUTH_REDIRECTS))
   errors.push('source:homeflow:oauth_redirect_allowlist_mismatch');
 }catch{errors.push('source:homeflow:oauth_redirect_allowlist_invalid')}
 for(const name of ['homeflow','kakeibo','it-study-platform','kakeibo-homeflow-bridge']){
  const p=parsed[name];
  if(!p)continue;
  if(p.vars.APP_ENV!=='production')
   errors.push('source:'+name+':APP_ENV_not_production');
  if(name!=='homeflow'&&p.vars.HOMEFLOW_OAUTH_ORIGIN!==EXPECTED_HOMEFLOW_ORIGIN)
   errors.push('source:'+name+':HOMEFLOW_OAUTH_ORIGIN_mismatch');
 }
 const doc=parsed['jp-document-assistant'];
 if(doc){
  if(doc.vars.APP_ENV!=='production')
   errors.push('source:jp-document-assistant:APP_ENV_not_production');
  if(doc.vars.HOMEFLOW_OAUTH_ORIGIN!==EXPECTED_HOMEFLOW_ORIGIN)
   errors.push('source:jp-document-assistant:HOMEFLOW_OAUTH_ORIGIN_mismatch');
  if(doc.preview_urls!==false)
   errors.push('source:jp-document-assistant:preview_urls_must_be_false');
 }
 const k=parsed.kakeibo;
 if(k?.r2.find(x=>x.binding==='RECEIPTS_R2')?.bucket_name!=='kakeibo-receipts')
  errors.push('source:kakeibo:wrong_R2');
 if(parsed.homeflow?.r2.find(x=>x.binding==='MEDIA')?.bucket_name!=='homeflow-family-media')
  errors.push('source:homeflow:wrong_R2');
 if(doc?.r2.find(x=>x.binding==='DOCUMENTS')?.bucket_name!=='jp-document-assistant-private')
  errors.push('source:jp-document-assistant:wrong_R2');
 return {source_plan_ok:errors.length===0,
   checked_sources:sources.map(x=>x[0]),
   enforced_service_targets:Object.values(SERVICE_TARGETS).reduce((s,o)=>s+Object.keys(o).length,1),
   errors:errors.sort(),
   production_G8_values_verified:false,
   live_worker_bindings_verified_after_deploy:false,
   production_deployment_authorized:false,
   required_next_steps:['stage_and_verify_secret_pairs','database_migration_release_controls',
    'coordinated_complete_deploy','post_deploy_live_G8','rollback_on_failure']};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  const r=checkG8SourcePlans(loadG8SourcePlans());
  console.log(JSON.stringify(r,null,2));
  if(!r.source_plan_ok)process.exitCode=1;
 }catch{
  console.error('Source-only G8 check unavailable: reviewed cross-repo checkouts missing');
  process.exitCode=2;
 }
}
