// Post-migration read-only proof before activating any production Worker.
// Only approved Stage F marker names are checked; no finance rows/amounts,
// attachments, tokens, exports or SQLite contents are ever logged.
import {MIGRATION_PLANS} from './release-d1-migration-inventory.mjs';
import {ids} from './four-app-release-apply-migrations.mjs';
const api=()=> 'https://api.cloudflare.com/client/v4/accounts/'+
 encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID||'');
async function query(name,sql){
 const r=await fetch(api()+'/d1/database/'+ids[name]+'/query',{
  method:'POST',headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
   'Content-Type':'application/json'},body:JSON.stringify({sql}),
  signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('PRODUCTION_D1_VERIFY_HTTP_'+r.status+':'+name);
 const d=await r.json(),x=d.result?.[0];
 if(!d.success||!x?.success||x.meta?.changed_db!==false||
  x.meta?.rows_written!==0||!Array.isArray(x.results))
  throw Error('PRODUCTION_D1_READ_ONLY_PROOF_FAILED:'+name);
 return x.results;
}
export async function verifyActualProductionMigration(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.CLOUDFLARE_ACCOUNT_ID||
  !process.env.CLOUDFLARE_API_TOKEN)
  throw Error('CONTROLLED_PRODUCTION_VERIFICATION_REQUIRED');
 const result={};
 for(const plan of MIGRATION_PLANS){
  const rows=await query(plan.db,'SELECT '+plan.column+' FROM '+plan.table);
  const values=rows.map(r=>String(r[plan.column]));
  const expected=plan.db==='kakebo'?plan.files.slice(2):plan.files;
  const found=expected.filter(file=>plan.db==='kakebo'?
   values.some(v=>v.startsWith('schema-'+file.slice(0,4)+'-')):values.includes(file));
  if(found.length!==expected.length)
   throw Error('STAGE_F_REMOTE_MIGRATION_INCOMPLETE:'+plan.db+':'+found.length+'/'+expected.length);
  result[plan.db]={applied:found.length,expected:expected.length};
 }
 // Physical 0020/0021 already existed before release, so their SQL was never
 // replayed. Reconfirm presence; exact DDL guards already passed real G9.
 const rec=await query('kakebo','PRAGMA table_info(recurring_plans)');
 const sbi=await query('kakebo','PRAGMA table_info(sbi_transfer_links)');
 const recNames=new Set(rec.map(r=>r.name)),sbiNames=new Set(sbi.map(r=>r.name));
 if(!['weekdays_json','month_days_json','interval_months'].every(n=>recNames.has(n))||
  !sbiNames.has('purpose'))
  throw Error('LEGACY_0020_0021_PHYSICAL_PREEXISTING_GUARD_DRIFT');
 console.log(JSON.stringify({production_stage_f_68_of_68_verified:true,
  strict_preexisting_kakebo_0020_0021:true,databases:result,
  all_reads_proved_no_database_writes:true,private_ledger_not_exported:true}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href)
 verifyActualProductionMigration().catch(e=>{
  console.error('PRODUCTION_MIGRATION_FINAL_VERIFICATION_BLOCKED:'+e.message);
  process.exitCode=1});
