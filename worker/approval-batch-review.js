// DRAFT P0-4C: atomic owner review ONLY, not execution of any target ledger.
// A single SQLite INSERT invokes 0057 BEFORE/AFTER guards; no partial approvals.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const reject=(code,status=409)=>json({ok:false,code,applied:false},status);
const exact=(x,fields)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
const response=(r,replayed)=>json({ok:true,reviewed:true,applied:false,
 batch_id:r.batch_id,decision:r.decision,status:r.decision==='approve'?'approved':'rejected',
 count:r.item_count,request_ids:JSON.parse(r.item_manifest).map(x=>x.request_id),replayed});
export async function batchReviewRoute(request,env,session,role,path){
 if(env.APPROVAL_BATCH_REVIEW_ENABLED!=='true'||env.APPROVALS_ENABLED!=='true')
  return reject('batch_review_disabled',503);
 if(role!=='owner')return reject('only_owner_can_batch_review',403);
 if(!session?.user_id||!session.household_id||!env.DB?.prepare)
  return reject('batch_review_session_missing',403);
 const db=env.DB;
 if(request.method==='GET'){
  const m=/^\/api\/approvals\/batch-review\/([0-9a-f-]{36})$/i.exec(path);
  if(!m||!uuid.test(m[1]))return reject('not_found',404);
  const saved=await db.prepare('SELECT * FROM household_approval_review_batches '+
   'WHERE batch_id=? AND household_id=? AND reviewer_user_id=? LIMIT 1')
   .bind(m[1],session.household_id,session.user_id).first();
  return saved?response(saved,true):reject('not_found',404);
 }
 if(request.method!=='POST'||path!=='/api/approvals/batch-review')
  return reject('not_found',404);
 if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return reject('invalid_body',400);
 let b;
 try{const raw=await request.text();b=raw.length<=3200?JSON.parse(raw):null}
 catch{return reject('invalid_body',400)}
 if(!exact(b,['batch_id','decision','expected_user_id','items'])||
  b.expected_user_id!==session.user_id)return reject('batch_review_actor_changed',403);
 if(!uuid.test(b.batch_id)||!['approve','reject'].includes(b.decision)||
  !Array.isArray(b.items)||b.items.length<1||b.items.length>20||
  b.items.some(item=>!exact(item,['request_id','expected_version'])||
   !uuid.test(item.request_id)||!Number.isSafeInteger(item.expected_version)||
   item.expected_version<1)||
  new Set(b.items.map(x=>x.request_id)).size!==b.items.length)
  return reject('batch_review_invalid_items',400);
 // Stable user-provided order and expected versions form the exact replay payload.
 const manifest=JSON.stringify(b.items);
 const hash=await digest(session.household_id+'\0'+session.user_id+'\0'+b.decision+'\0'+manifest);
 const read=()=>db.prepare('SELECT * FROM household_approval_review_batches WHERE batch_id=? LIMIT 1')
  .bind(b.batch_id).first();
 const matches=r=>r?.household_id===session.household_id&&r?.reviewer_user_id===session.user_id&&
  r?.decision===b.decision&&r?.item_manifest===manifest&&r?.manifest_sha256===hash&&
  r?.item_count===b.items.length;
 const existing=await read();
 if(existing)return matches(existing)?response(existing,true):reject('batch_review_idempotency_conflict',409);
 try{
  const r=await db.prepare('INSERT INTO household_approval_review_batches '+
   '(batch_id,household_id,reviewer_user_id,decision,item_manifest,item_count,manifest_sha256,reviewed_at) '+
   'VALUES(?,?,?,?,?,?,?,?)')
   .bind(b.batch_id,session.household_id,session.user_id,b.decision,
    manifest,b.items.length,hash,Date.now()).run();
  if(r.meta?.changes!==1)return reject('batch_review_unconfirmed',503);
  const stored=await read();
  return matches(stored)?response(stored,false):reject('batch_review_receipt_unconfirmed',503);
 }catch{
  const raced=await read().catch(()=>null);
  return matches(raced)?response(raced,true):reject('batch_review_atomic_conflict',409);
 }
}
