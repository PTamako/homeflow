// §114 Production D1 snapshot -> isolated GitHub Actions runner only.
// This script ONLY GETs D1 metadata and POSTs Cloudflare's immutable SQL
// export operation. It never writes to a production database or R2, never
// persists a signed URL in logs or artifacts, and erases scratch data.
import {mkdtemp,rm,open,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {MIGRATION_PLANS} from './release-d1-migration-inventory.mjs';

const SECRET_BASE='https://api.cloudflare.com/client/v4';
const MAX_SQL_BYTES=320*1024*1024;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=message=>{throw new Error(message)};
async function api(accountId,token,path,body=null){
 const res=await fetch(SECRET_BASE+'/accounts/'+encodeURIComponent(accountId)+path,{
  method:body===null?'GET':'POST',
  headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
  ...(body===null?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(120000)
 }).catch(()=>fail('CLOUDFLARE_API_TRANSPORT_ERROR'));
 if(!res.ok)fail('CLOUDFLARE_API_HTTP_'+res.status);
 const data=await res.json().catch(()=>fail('CLOUDFLARE_API_JSON_INVALID'));
 if(data?.success!==true)fail('CLOUDFLARE_API_RESULT_UNSUCCESSFUL');
 return data.result;
}
async function exportSql(accountId,token,uuid,dest){
 const path='/d1/database/'+encodeURIComponent(uuid)+'/export';
 let state=await api(accountId,token,path,{output_format:'polling'});
 let bookmark=state?.at_bookmark;
 if(typeof bookmark!=='string'||!bookmark)fail('EXPORT_BOOKMARK_MISSING');
 let url=state?.result?.signed_url;
 for(let tries=0;tries<45&&state?.status!=='error'&&!url;tries++){
  await sleep(2000);
  state=await api(accountId,token,path,{
   output_format:'polling',current_bookmark:bookmark});
  url=state?.result?.signed_url;
 }
 if(!url||state?.status!=='complete')fail('EXPORT_INCOMPLETE');
 const response=await fetch(url,{signal:AbortSignal.timeout(120000)})
   .catch(()=>fail('PRIVATE_SQL_DOWNLOAD_FAILED'));
 if(!response.ok||!response.body)fail('PRIVATE_SQL_DOWNLOAD_HTTP_ERROR');
 const length=Number(response.headers.get('content-length')||0);
 if(length>MAX_SQL_BYTES)fail('EXPORT_TOO_LARGE');
 const file=await open(dest,'wx',0o600);
 let total=0,hash=createHash('sha256');
 try{
  for await(const chunk of response.body){
   total+=chunk.length;
   if(total>MAX_SQL_BYTES)fail('EXPORT_TOO_LARGE');
   hash.update(chunk);
   await file.write(chunk);
  }
 }finally{await file.close()}
 if(total<256)fail('EXPORT_UNEXPECTEDLY_SMALL');
 return {bytes:total,sha256:hash.digest('hex'),bookmark_obtained:true};
}
async function main(){
 const accountId=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 const rawToken=process.env.CLOUDFLARE_API_TOKEN||'';
 const token=rawToken.trim();
 if(!accountId||!token)fail('GITHUB_CLOUDFLARE_READ_ACCESS_MISSING');
 // GitHub Actions can have an older run's environment. This fresh-commit
 // execution also diagnoses common copy mistakes with non-sensitive booleans.
 // Never print the credential, its length, a prefix or a digest.
 const diagnostic={
  token_present:true,
  surrounding_whitespace_ignored:rawToken!==token,
  bearer_prefix_in_secret:/^Bearer\s/i.test(token),
  surrounding_quotes_in_secret:/^['"]|['"]$/.test(token),
  embedded_whitespace_in_secret:/\s/.test(token),
  secret_value_exposed:false
 };
 console.log(JSON.stringify({github_secret_shape:diagnostic}));
 if(diagnostic.bearer_prefix_in_secret||diagnostic.surrounding_quotes_in_secret||
    diagnostic.embedded_whitespace_in_secret)
  fail('GITHUB_CLOUDFLARE_TOKEN_SECRET_FORMAT_INVALID');
 // Cloudflare /user/tokens/verify is NOT a reliable oracle for all
 // credentials: the connected Cloudflare account successfully queries D1
 // yet receives 401 from that verify endpoint. Demand actual scoped D1
 // read/export access instead of blocking on token introspection.
 // No token, signed URL or secret contents are written to logs.
 const listed=await api(accountId,token,'/d1/database?per_page=100');
 if(!Array.isArray(listed))fail('D1_LIST_INVALID');
 const root=await mkdtemp(join(tmpdir(),'four-app-g9-current-'));
 const dbPaths={};
 try{
  for(const p of MIGRATION_PLANS){
   const matches=listed.filter(x=>x.name===p.db&&x.version==='production');
   if(matches.length!==1)fail('PRODUCTION_D1_UNAVAILABLE:'+p.db);
   const sql=join(root,p.db+'.sql');
   const dest=join(root,p.db+'.sqlite');
   const meta=await exportSql(accountId,token,matches[0].uuid,sql);
   const process=spawnSync('python3',['scripts/restore-d1-sql-export.py',sql,dest],
    {cwd:resolve('.'),encoding:'utf8',maxBuffer:1024*1024,timeout:180000});
   await rm(sql,{force:true});
   if(process.status!==0)fail('SQL_ISOLATED_RESTORE_FAILED:'+p.db);
   dbPaths[p.db]=dest;
   // Never emit a URL, SQL, account identifier, token, contents or financial row.
   console.log(JSON.stringify({database:p.db,export_bytes:meta.bytes,
    exported_sha256:meta.sha256.slice(0,16),restored_to_temporary_runner:true}));
  }
  const command=['scripts/release-local-data-rehearsal.py',
    '--db-homeflow',dbPaths.homeflow,
    '--db-kakebo',dbPaths.kakebo,
    '--db-it-study-platform',dbPaths['it-study-platform'],
    '--db-jp-document-assistant',dbPaths['jp-document-assistant'],
    '--repo-kakebo',resolve('.contract-kakeibo'),
    '--repo-it-study-platform',resolve('.contract-study'),
    '--repo-jp-document-assistant',resolve('.contract-document')];
  const result=spawnSync('python3',command,{
   cwd:resolve('.'),stdio:'inherit',timeout:12*60*1000});
  if(result.status!==0)fail('REAL_DATA_MIGRATION_OR_ROLLBACK_REHEARSAL_FAILED');
  console.log(JSON.stringify({ok:true,source:'current_cloudflare_D1_snapshots',
   production_writes:false,private_data_uploaded_as_artifacts:false,
   real_data_migration_and_local_rollback_passed:true,
   production_release_authorized:false}));
 }finally{
  await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:250});
 }
}
try{await main()}catch(error){
 // No raw error objects, response or signed URL may enter GitHub logs.
 console.error('G9_READONLY_REHEARSAL_BLOCKED:'+String(error.message||'UNEXPECTED').slice(0,128));
 process.exitCode=1;
}
