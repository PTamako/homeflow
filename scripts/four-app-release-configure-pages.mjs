// Pages has no Worker versions-secret workflow. Update its production
// configuration once with the SAME ephemeral paired values destined for staged
// Workers. The active Pages deployment remains unchanged until manual publish.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {REQUIRED_PAGES} from './release-g8-binding-preflight.mjs';
const project='kakeibo';
const required=['AUTH_TOKEN','JPDA_BRIDGE_SECRET','KAKEIBO_SSO_ENCRYPTION_KEY'];
const root=()=> 'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(
 process.env.CLOUDFLARE_ACCOUNT_ID||'')+'/pages/projects/'+project;
async function request(method,url,body){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+
  process.env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('PAGES_CONFIG_HTTP_'+r.status);
 const x=await r.json();
 if(!x.success)throw Error('PAGES_CONFIG_API_UNSUCCESSFUL');
 return x.result;
}
export async function configurePages(){
 if(!process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN||
  !process.env.RUNNER_TEMP||process.env.GITHUB_ACTIONS!=='true')
  throw Error('RELEASE_RUNNER_AUTH_MISSING');
 const old=await request('GET',root());
 const p=old?.deployment_configs?.production||{};
 if(!required.every(k=>p.env_vars?.[k])||!p.d1_databases?.DB||
  !p.r2_buckets?.RECEIPTS_R2||
  p.services?.HOMEFLOW_IDENTITY_SERVICE?.service!=='homeflow'||
  old.source?.config?.production_deployments_enabled!==false)
  throw Error('PAGES_EXISTING_PRODUCTION_BASELINE_FAILED');
 const v=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,
  'four-app-release-keys','P.json'),'utf8'));
 if(!Object.values(v).every(x=>/^[a-f0-9]{64}$/.test(x)))
  throw Error('PAGE_SECRET_INVALID');
 const flags=REQUIRED_PAGES.kakeibo.env.filter(n=>n.endsWith('_ENABLED')||
  n==='KAKEIBO_LEGACY_R2_WRITES_FROZEN');
 const env=Object.fromEntries(flags.map(k=>[k,{type:'plain_text',
  value:k==='KAKEIBO_LEGACY_R2_WRITES_FROZEN'?'false':'true'}]));
 for(const [k,value] of Object.entries(v))env[k]={type:'secret_text',value};
 await request('PATCH',root(),{deployment_configs:{production:{env_vars:env}}});
 const after=await request('GET',root());
 const now=after?.deployment_configs?.production||{};
 if(!required.every(k=>now.env_vars?.[k])||!now.d1_databases?.DB||
  !now.r2_buckets?.RECEIPTS_R2||
  now.services?.HOMEFLOW_IDENTITY_SERVICE?.service!=='homeflow'||
  !Object.keys(env).every(k=>now.env_vars?.[k])||
  old.latest_deployment?.id!==after.latest_deployment?.id)
  throw Error('PAGES_POST_PATCH_PRODUCTION_INTEGRITY_FAILED');
 console.log(JSON.stringify({pages_config_production:true,added_count:Object.keys(env).length,
  existing_secrets_preserved:true,active_deployment_changed:false,
  key_values_exposed:false}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 configurePages().catch(e=>{console.error('RELEASE_PAGES_BLOCKED:'+e.message);
  process.exitCode=1});
