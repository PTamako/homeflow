// FINAL coordinated switch after reviewed full Stage F 68/68 remote migrations.
// Never use Pages project.latest_deployment as a rollback target: disabled
// Git builds can create queued/idle entries that were never live!
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PINNED_RELEASE,assertPinnedRelease}
 from './four-app-release-assert-resume.mjs';
const account=()=>encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID||'');
async function get(path){
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account()+path,
  {headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},
   signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('RELEASE_FINAL_READ_HTTP_'+r.status);
 const j=await r.json();if(!j.success)throw Error('RELEASE_FINAL_CLOUDFLARE_READ_FAILED');
 return j.result;
}
export async function prepareFinalSwitch(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||
  !process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN)
  throw Error('CONTROLLED_FINAL_RELEASE_ENV_REQUIRED');
 const target=join(process.env.RUNNER_TEMP,'four-app-staged-versions.json');
 const plan=JSON.parse(await readFile(target,'utf8'));
 for(const [name,expected] of Object.entries(PINNED_RELEASE.workers)){
  const actual=plan.workers?.[name];
  if(!actual||actual.new_version!==expected.new_version||
   actual.old_version!==expected.old_version)
   throw Error('UNEXPECTED_STAGED_VERSION:'+name);
 }
 const project=await get('/pages/projects/kakeibo');
 const cfg=project.deployment_configs?.production||{};
 const f=cfg.env_vars?.KAKEIBO_LEGACY_R2_WRITES_FROZEN;
 if(!f||f.type!=='plain_text'||f.value!=='false')
  throw Error('PAGES_R2_WRITES_FROZEN_CONFIG_NOT_PERSISTED');
 if(project.source?.config?.production_deployments_enabled!==false||
  project.source?.config?.preview_deployment_setting!=='none'||
  !cfg.env_vars?.AUTH_TOKEN||!cfg.env_vars?.JPDA_BRIDGE_SECRET||
  !cfg.env_vars?.KAKEIBO_SSO_ENCRYPTION_KEY||
  !cfg.d1_databases?.DB||!cfg.r2_buckets?.RECEIPTS_R2||
  cfg.services?.HOMEFLOW_IDENTITY_SERVICE?.service!=='homeflow')
  throw Error('PAGES_ORIGINAL_BINDINGS_OR_AUTO_BUILD_POLICY_DRIFT');
 const releases=await get('/pages/projects/kakeibo/deployments?env=production&per_page=25');
 const old=releases.find(d=>d.id===PINNED_RELEASE.pages_old_deployment);
 if(!old||old.environment!=='production'||old.latest_stage?.status!=='success'||
  old.deployment_trigger?.metadata?.commit_hash!=='3bac4610078729556a7068c761e3e7c1729ab27d')
  throw Error('PRE_RELEASE_SUCCESSFUL_PAGES_ROLLBACK_TARGET_UNAVAILABLE');
 // Previously active source 7013... has new identity/finance UI but lacked
 // the frozen flag. Always restore the pre-release 2026-11-13 version on fail.
 plan.pages_old_deployment=old.id;
 const report=assertPinnedRelease(plan);
 await writeFile(target,JSON.stringify(plan),{mode:0o600});
 console.log(JSON.stringify({...report,
  original_successful_pages_rollback_target_verified:true,
  new_finance_pages_flag_persisted:true,
  existing_oauth_and_r2_preserved:true,
  production_activation_not_yet_started:true}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 prepareFinalSwitch().catch(e=>{console.error('FINAL_RELEASE_PRECHECK_BLOCKED:'+e.message);
  process.exitCode=1});
