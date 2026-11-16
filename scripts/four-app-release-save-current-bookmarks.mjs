// Read-only POST-MIGRATION production recovery checkpoints for final switch.
// The original PRE-migration 2026-11-16 Time Travel bookmarks were captured
// before all 68 Stage F DDL steps in Run 43789391609. This new checkpoint
// protects any newer writes; it does not pretend the old schema is restored.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ids} from './four-app-release-apply-migrations.mjs';
import {MIGRATION_PLANS} from './release-d1-migration-inventory.mjs';

async function bookmark(name){
 const path='https://api.cloudflare.com/client/v4/accounts/'+
  encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)+
  '/d1/database/'+ids[name]+'/time_travel/bookmark';
 for(let i=0;i<4;i++){
  const r=await fetch(path,{headers:{Authorization:'Bearer '+
   process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(60000)});
  if(r.ok){
   const d=await r.json();
   if(d.success&&typeof d.result?.bookmark==='string'&&d.result.bookmark)
    return d.result.bookmark;
  }else if(![400,429,500,502,503,504].includes(r.status))
   throw Error('POST_MIGRATION_TIME_TRAVEL_HTTP_'+r.status+':'+name);
  if(i<3)await new Promise(resolve=>setTimeout(resolve,1000*(i+1)));
 }
 throw Error('POST_MIGRATION_TIME_TRAVEL_BOOKMARK_UNAVAILABLE:'+name);
}
export async function capturePostMigrationRecovery(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||
  !process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN)
  throw Error('CONTROLLED_ACTIONS_RELEASE_ENV_REQUIRED');
 const out={};
 for(const p of MIGRATION_PLANS){
  if(!ids[p.db])throw Error('RELEASE_D1_ID_MAPPING_MISSING:'+p.db);
  out[p.db]=await bookmark(p.db);
 }
 await writeFile(join(process.env.RUNNER_TEMP,'four-app-d1-bookmarks.json'),
  JSON.stringify(out),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({post_migration_four_d1_time_travel_available:true,
  checkpoints_saved_ephemeral_only:true,
  production_writes:false,private_bookmarks_logged:false}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 capturePostMigrationRecovery().catch(e=>{
  console.error('POST_MIGRATION_BOOKMARK_CAPTURE_FAILED:'+e.message);
  process.exitCode=1});
