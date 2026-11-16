// Safe standalone Study production hotfix. Cloudflare versions upload
// inherits existing encrypted secrets; NEVER rotate SSO or document signing
// credentials for an already-linked family.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const name='it-study-platform';
const expectedOld='c82bb76e-f9eb-4488-a483-f7ced7b96bbe';
const expectedSha='e4e8efd7be555e247500d9581c08e31b8a0d1be7';
const flags=[
 'HOMEFLOW_STUDY_SSO_ENABLED','HOMEFLOW_STUDY_VOCAB_ENABLED',
 'HOMEFLOW_STUDY_DAILY_PROGRESS_ENABLED','HOMEFLOW_STUDY_DAILY_WORDS_ENABLED',
 'HOMEFLOW_STUDY_GRAMMAR_ENABLED','HOMEFLOW_STUDY_LISTENING_ENABLED',
 'HOMEFLOW_STUDY_LANGUAGE_ENABLED','HOMEFLOW_STUDY_EXAMS_ENABLED',
 'HOMEFLOW_STUDY_MOCK_ENABLED','HOMEFLOW_STUDY_SENTENCES_ENABLED'
];
const root=()=> 'https://api.cloudflare.com/client/v4/accounts/'+
 encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID||'');
const file=()=>join(process.env.RUNNER_TEMP||'/nonexistent','study-homeflow-hotfix.json');
async function api(method,path,body){
 const response=await fetch(root()+path,{
  method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
  'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('CLOUDFLARE_'+method+'_HTTP_'+response.status);
 const j=await response.json();
 if(!j.success)throw Error('CLOUDFLARE_'+method+'_API_UNSUCCESSFUL');
 return j.result;
}
const deployments=()=>api('GET','/workers/scripts/'+name+'/deployments');
const active=async()=>{
 const d=await deployments();
 return d.deployments?.[0]?.versions?.find(v=>v.percentage===100)?.version_id||null;
};
const version=id=>api('GET','/workers/scripts/'+name+'/versions/'+id);
const bindingMap=bindings=>new Map((bindings||[]).map(b=>[b.name,b]));
async function preflight(){
 if(await active()!==expectedOld)throw Error('STUDY_PRODUCTION_VERSION_DRIFT');
 const v=await version(expectedOld);
 const live=await api('GET','/workers/scripts/'+name+'/settings');
 const b=bindingMap(live.bindings);
 for(const n of ['DB','ASSETS','HOMEFLOW_STUDY_SERVICE',
  'DOCUMENT_STUDY_HOMEFLOW_SERVICE','DOCUMENT_STUDY_SOURCE_SERVICE',
  'STUDY_SSO_ENCRYPTION_KEY','AUTH_SESSION_SECRET','AUTH_PASSWORD'])
   if(!b.has(n))throw Error('MISSING_OLD_BINDING:'+n);
 for(const [n,target] of [['HOMEFLOW_STUDY_SERVICE','homeflow'],
  ['DOCUMENT_STUDY_HOMEFLOW_SERVICE','homeflow'],
  ['DOCUMENT_STUDY_SOURCE_SERVICE','jp-document-assistant']]){
  if(b.get(n)?.type!=='service'||b.get(n)?.service!==target)
   throw Error('INVALID_OLD_SERVICE_TARGET:'+n);
 }
 const previous=await api('GET','/workers/scripts/'+name+'/versions?per_page=5');
 const data={
  oldId:expectedOld,
  previousLatestId:previous.items?.[0]?.id||null,
  oldBindingNames:[...b.keys()],
  oldEncryptedNames:[...b].filter(([k,val])=>val.type==='secret_text').map(([k])=>k),
  codeSha:expectedSha
 };
 if(!data.previousLatestId||!data.oldEncryptedNames.length)
  throw Error('STUDY_PREVIEW_INCOMPLETE');
 await writeFile(file(),JSON.stringify(data),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({baseline_study_active_version_verified:true,
  encrypted_name_count:data.oldEncryptedNames.length,
  service_bindings_verified:true,code_sha_pinned:true,no_traffic_changes:true}));
}
async function waitFor(id){
 for(let n=0;n<20;n++){
  if(await active()===id)return;
  if(n<19)await new Promise(resolve=>setTimeout(resolve,1200));
 }
 throw Error('STUDY_VERSION_ACTIVATION_NOT_CONFIRMED');
}
async function activate(){
 const data=JSON.parse(await readFile(file(),'utf8'));
 if(data.oldId!==expectedOld||data.codeSha!==expectedSha)
  throw Error('STUDY_PREPARED_BASELINE_MISMATCH');
 if(await active()!==expectedOld)throw Error('STUDY_CONCURRENT_ACTIVE_VERSION_DRIFT');
 const v=await api('GET','/workers/scripts/'+name+'/versions?per_page=5');
 const newId=v.items?.[0]?.id;
 if(!newId||newId===data.previousLatestId||newId===expectedOld)
  throw Error('STUDY_NEW_VERSION_NOT_STAGED');
 const newest=await version(newId);
 const b=bindingMap(newest.resources?.bindings);
 for(const old of data.oldBindingNames)
  if(!b.has(old))throw Error('PREVIOUS_BINDING_LOST:'+old);
 for(const old of data.oldEncryptedNames)
  if(b.get(old)?.type!=='secret_text')
   throw Error('ENCRYPTED_BINDING_NOT_PRESERVED:'+old);
 for(const flag of flags)
  if(b.get(flag)?.type!=='plain_text'||b.get(flag)?.text!=='true')
   throw Error('STUDY_MODULE_FLAG_NOT_ENABLED:'+flag);
 for(const [binding,target] of [['HOMEFLOW_STUDY_SERVICE','homeflow'],
  ['DOCUMENT_STUDY_HOMEFLOW_SERVICE','homeflow'],
  ['DOCUMENT_STUDY_SOURCE_SERVICE','jp-document-assistant']])
  if(b.get(binding)?.type!=='service'||b.get(binding)?.service!==target)
   throw Error('STUDY_SERVICE_BINDING_CHANGED:'+binding);
 if(b.get('DB')?.type!=='d1'||!b.has('ASSETS'))
  throw Error('STUDY_DB_OR_ASSETS_MISSING');
 console.log(JSON.stringify({new_study_version_staged:true,
  flags_count:flags.length,prior_encrypted_binding_count:data.oldEncryptedNames.length,
  existing_bindings_preserved:true,verified_before_activation:true}));
 let attempted=false;
 try{
  attempted=true;
  await api('POST','/workers/scripts/'+name+'/deployments',{
   strategy:'percentage',versions:[{percentage:100,version_id:newId}]});
  await waitFor(newId);
  const final=await api('GET','/workers/scripts/'+name+'/settings');
  const enabled=bindingMap(final.bindings);
  for(const flag of flags)
   if(enabled.get(flag)?.type!=='plain_text'||enabled.get(flag)?.text!=='true')
    throw Error('STUDY_POST_DEPLOY_FLAG_MISSING:'+flag);
  // Production API never includes an access token or a private study record.
  const status=await fetch('https://it-study-platform.yupan6706.workers.dev/api/homeflow-sso/status',
   {headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(!status.ok||(await status.json()).enabled!==true)
   throw Error('STUDY_OAUTH_HEALTH_CHECK_FAILED');
  const unauthorized=await fetch('https://it-study-platform.yupan6706.workers.dev/api/homeflow-study/vocabulary',
   {headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(unauthorized.status!==401&&unauthorized.status!==403)
   throw Error('STUDY_UNAUTHENTICATED_PERSONAL_DATA_ACCESS_CHECK_FAILED');
  console.log(JSON.stringify({study_homeflow_production_live:true,
   active_version:newId,traffic:100,all_personal_modules_enabled:true,
   original_encrypted_secrets_preserved:true,unauthed_private_data_blocked:true}));
 }catch(err){
  console.error('STUDY_PRODUCTION_SMOKE_FAILURE_ROLLBACK:'+String(err).slice(0,220));
  if(attempted){
   try{
    await api('POST','/workers/scripts/'+name+'/deployments',{
     strategy:'percentage',versions:[{percentage:100,version_id:expectedOld}]});
    await waitFor(expectedOld);
    console.error('STUDY_PREVIOUS_STABLE_VERSION_RESTORED');
   }catch{console.error('STUDY_ROLLBACK_REQUIRES_MANUAL_REVIEW')}
  }
  throw Error('STUDY_HOTFIX_ACTIVATION_FAILED');
 }
}
if(!process.env.GITHUB_ACTIONS||!process.env.CLOUDFLARE_API_TOKEN||
 !process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.RUNNER_TEMP)
 throw Error('CONTROLLED_GITHUB_CLOUDFLARE_RELEASE_ONLY');
const task=process.argv[2];
if(task==='preflight')await preflight();
else if(task==='activate')await activate();
else throw Error('PREPARE_OR_ACTIVATE_REQUIRED');
