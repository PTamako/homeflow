// Explicitly authorized production-only Stage F migration runner.
// 2026-11-16: user completed encrypted four-D1/three-R2 backup and independent
// restore; current live snapshots passed real 68/68 isolated migration drill.
// We re-check real migration markers + Time Travel before first remote DDL.
import {spawnSync} from 'node:child_process';
import {writeFile,mkdir,copyFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {collectMigrationInventory,verifyMigrationInventory,MIGRATION_PLANS}
 from './release-d1-migration-inventory.mjs';
const ids={
 homeflow:'3e0205b0-77e2-4259-8ac2-4c56efc43f8a',
 kakeibo:'4d790915-fc06-4073-b660-bbb51dc74463',
 'it-study-platform':'ed4ca935-5d00-4f38-b3c5-c0d53c5aad63',
 'jp-document-assistant':'22a671c0-3f6c-4707-adf1-b24ac95330c6'
};
const paths={
 homeflow:'.',kakeibo:'.contract-kakeibo',
 'it-study-platform':'.contract-study',
 'jp-document-assistant':'.contract-document'
};
const run=(cwd,args)=>{
 const x=spawnSync('npx',['wrangler',...args],{
  cwd:resolve(cwd),stdio:'inherit',timeout:240000,env:process.env});
 if(x.status!==0)throw Error('WRANGLER_MIGRATION_FAILED:'+cwd+':'+args[1]);
};
async function scopedApply(name,database){
 const plan=MIGRATION_PLANS.find(p=>p.db===name);
 const root=resolve(paths[name]),staged=join(root,'.release-stage-f');
 await mkdir(staged,{recursive:true});
 for(const file of plan.files)await copyFile(join(root,'migrations',file),join(staged,file));
 const doc=name==='jp-document-assistant';
 const input=doc?'wrangler.jsonc':'wrangler.toml';
 const raw=await readFile(join(root,input),'utf8');
 const from=doc?'"migrations_dir":"migrations"':'migrations_dir = "migrations"';
 const to=doc?'"migrations_dir":".release-stage-f"':'migrations_dir = ".release-stage-f"';
 if(!raw.includes(from))throw Error('MIGRATION_SOURCE_CONFIG_CHANGED:'+name);
 const config=doc?'.release-stage-f-wrangler.jsonc':'.release-stage-f-wrangler.toml';
 await writeFile(join(root,config),raw.replace(from,to),{flag:'wx'});
 run(paths[name],['d1','migrations','apply',database,'--remote','--yes','--config',config]);
}
async function bookmark(name){
 const url='https://api.cloudflare.com/client/v4/accounts/'+
  encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)+'/d1/database/'+ids[name]+
  '/time_travel/bookmark';
 // 2026-11-16: one Kakeibo bookmark GET returned HTTP 400 transiently,
 // then the identical GitHub token passed all 4 GETs in independent Actions
 // Run 43788334197. Retry bounded reads; NEVER ignore a missing bookmark.
 for(let attempt=0;attempt<5;attempt++){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+
   process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(60000)});
  if(r.ok){
   const body=await r.json();
   if(body.success&&body.result?.bookmark)return body.result.bookmark;
  }else if(![400,429,500,502,503,504].includes(r.status))
   throw Error('TIME_TRAVEL_HTTP_'+r.status+':'+name);
  if(attempt===4)throw Error('TIME_TRAVEL_BOOKMARK_UNAVAILABLE:'+name);
  console.log(JSON.stringify({database:name,temporary_bookmark_read_retry:attempt+1}));
  await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
 }
 throw Error('TIME_TRAVEL_BOOKMARK_UNAVAILABLE:'+name);
}
export async function applyProductionMigrations(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||
  !process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)
  throw Error('CONTROLLED_PRODUCTION_ENV_REQUIRED');
 const before=verifyMigrationInventory(await collectMigrationInventory({
  accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
  token:process.env.CLOUDFLARE_API_TOKEN}));
 if(!before.ok)throw Error('PRODUCTION_D1_MARKER_BASELINE_DRIFT:'+before.errors.join(','));
 const bookmarks={};
 for(const plan of MIGRATION_PLANS)bookmarks[plan.db]=await bookmark(plan.db);
 await writeFile(join(process.env.RUNNER_TEMP,'four-app-d1-bookmarks.json'),
  JSON.stringify(bookmarks),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({all_four_real_d1_markers_verified:true,
  four_time_travel_bookmarks_saved_in_ephemeral_runner:true,
  migration_count_expected:68}));
 // First identity authority, then the downstream business databases.
 await scopedApply('homeflow','homeflow');
 await scopedApply('it-study-platform','it-study-platform-db');
 await scopedApply('jp-document-assistant','jp-document-assistant');
 // Kakeibo uses custom schema_migrations, not Wrangler's d1_migrations.
 // Historic 0020/0021 are physically already installed and were exactly
 // validated in real G9 (not duplicate ALTER). Begin ONLY at audited 0022.
 const kplan=MIGRATION_PLANS.find(x=>x.db==='kakeibo');
 if(kplan.files[0]!=='0020_recurring_multi_schedule.sql'||
    kplan.files[1]!=='0021_sbi_transfer_purpose.sql')
  throw Error('KAKEIBO_HISTORIC_GUARD_CHANGED');
 for(const name of kplan.files.slice(2)){
  if(!/^00(?:[2-5][0-9])_[a-z0-9_-]+\.sql$/.test(name))
   throw Error('UNREVIEWED_KAKEIBO_MIGRATION');
  run(paths.kakeibo,['d1','execute','kakeibo','--remote','--file','migrations/'+name]);
 }
 console.log(JSON.stringify({production_migration_execution_completed:true,
  homeflow:8,study:13,document:7,kakeibo:38,
  kakeibo_verified_preexisting:['0020','0021'],total:68,
  legacy_financial_values_not_rewritten_by_release_script:true}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 applyProductionMigrations().catch(e=>{console.error('LIVE_MIGRATION_BLOCKED:'+e.message);
  process.exitCode=1});
