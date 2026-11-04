export type PendingTaskOp={
  id:string;userId:string;kind:'create'|'edit';targetId:string|null;
  payload:Record<string,unknown>;createdAt:string;status:'pending'|'conflict'
}
const DB='homeflow-offline-outbox-v1'
const STORE='operations'
function openDb():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(new Error('offline_storage_unavailable'))
    const req=indexedDB.open(DB,1)
    req.onupgradeneeded=()=>{
      const db=req.result
      if(!db.objectStoreNames.contains(STORE)){
        const store=db.createObjectStore(STORE,{keyPath:'id'})
        store.createIndex('userId','userId',{unique:false})
      }
    }
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error||new Error('offline_database_unavailable'))
  })
}
async function txn<T>(mode:IDBTransactionMode,request:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  const db=await openDb()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode)
    const query=request(tx.objectStore(STORE))
    let result:T
    query.onsuccess=()=>{result=query.result}
    tx.oncomplete=()=>{db.close();resolve(result)}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('offline_operation_failed'))}
    tx.onabort=()=>{db.close();reject(tx.error||new Error('offline_operation_aborted'))}
  })
}
export async function listPending(userId:string):Promise<PendingTaskOp[]>{
  const items=await txn<PendingTaskOp[]>('readonly',s=>s.index('userId').getAll(userId))
  return items.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
}
export async function savePending(op:PendingTaskOp):Promise<void>{
  if((await listPending(op.userId)).length>=100)throw new Error('离线任务已达到上限，请连接网络后同步')
  await txn('readwrite',s=>s.put(op))
}
export async function removePending(id:string):Promise<void>{
  await txn('readwrite',s=>s.delete(id))
}
export async function updatePending(op:PendingTaskOp):Promise<void>{
  await txn('readwrite',s=>s.put(op))
}
export async function sendOrQueueTask(userId:string,kind:'create'|'edit',
  payload:Record<string,unknown>,taskId:string|null=null):Promise<'synced'|'queued'>{
  const id=crypto.randomUUID()
  const envelope={...payload,...(kind==='create'?{clientRequestId:id}:{})}
  if(navigator.onLine){
    try{
      const response=await fetch('/api/tasks'+(kind==='edit'?'/'+encodeURIComponent(taskId||''):''),{
        method:kind==='create'?'POST':'PATCH',credentials:'same-origin',
        headers:{'content-type':'application/json'},body:JSON.stringify(envelope)})
      if(response.ok)return 'synced'
      if(response.status<500){
        const error=await response.json().catch(()=>({error:'validation_failed'}))
        const failure=Object.assign(new Error(String(error.error||'validation_failed')),{permanent:true})
        throw failure
      }
    }catch(e){
      // Server authorization/validation and conflict errors must never be queued as offline work.
      if(e && typeof e==='object' && 'permanent' in e)throw e
    }
  }
  await savePending({id,userId,kind,targetId:taskId,payload:envelope,createdAt:new Date().toISOString(),status:'pending'})
  return 'queued'
}
export async function syncPending(userId:string){
  const items=await listPending(userId)
  let synced=0,conflicts=0,remaining=0
  for(const op of items){
    if(op.status==='conflict'){conflicts++;continue}
    if(!navigator.onLine){remaining++;break}
    let response:Response
    try{
      response=await fetch('/api/tasks'+(op.kind==='edit'?'/'+encodeURIComponent(op.targetId||''):''),{
        method:op.kind==='create'?'POST':'PATCH',credentials:'same-origin',
        headers:{'content-type':'application/json'},body:JSON.stringify(op.payload)})
    }catch{remaining++;break}
    if(response.ok){await removePending(op.id);synced++;continue}
    if(response.status===409){
      await updatePending({...op,status:'conflict'})
      conflicts++;continue
    }
    // Stop at authorization/server errors; never delete pending content accidentally.
    remaining++;break
  }
  const rest=await listPending(userId)
  return {synced,conflicts:rest.filter(x=>x.status==='conflict').length,
    remaining:rest.filter(x=>x.status==='pending').length}
}
