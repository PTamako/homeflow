// Scan only today's eligible source rows in small, deterministic ID-keyset batches.
// Unlike OFFSET or a fixed top-N, this has no hidden truncation ceiling. The
// combined Today endpoint sorts and selects the requested five rows server-side.
// All source SQL is parameterized and must enforce household/visibility itself.
export async function readTodayRows(db,sourceSql,params,chunkSize=80){
 const out=[]
 let last=''
 for(;;){
  const sql='SELECT * FROM ('+sourceSql+') AS candidates WHERE candidates.id>?'+
   (params.length+1)+' ORDER BY candidates.id ASC LIMIT ?'+(params.length+2)
  const page=await db.prepare(sql).bind(...params,last,chunkSize).all()
  const rows=page.results||[]
  if(!rows.length)break
  out.push(...rows)
  last=rows[rows.length-1].id
  if(rows.length<chunkSize)break
 }
 return out
}
