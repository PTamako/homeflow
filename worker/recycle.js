// Recover by toggling a marker; preserve original IDs and all linked records.
import {json,readBody,iso} from './security.js'
const sources=[
  ['task','tasks','creator_user_id'],
  ['routine','routines','created_by'],
  ['anniversary','anniversaries','created_by'],
  ['shopping','shopping_items','created_by'],
  ['wish','wishes','created_by'],
  ['goal','goals','created_by'],
  ['trip','trips','created_by'],
  ['memory','memories','created_by']
]
const byKind=new Map(sources.map(([kind,table,creator])=>[kind,{table,creator}]))
const uuid=/^[0-9a-f-]{36}$/i
const timestamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/
export async function recycleRoute(request,db,path,session){
 const h=session.household_id,u=session.user_id
 if(path==='/api/recycle'&&request.method==='GET'){
   const query=new URL(request.url).searchParams,raw=query.get('cursor')||''
   if(raw.length>145)return json({error:'invalid_cursor'},400)
   let cursor=null
   if(raw){
     const split=raw.split('|')
     if(split.length!==3||!timestamp.test(split[0])||!byKind.has(split[1])||!uuid.test(split[2]))
       return json({error:'invalid_cursor'},400)
     cursor=split
   }
   // D1 limits compound SELECT terms. Read two bounded groups rather than one
   // eight-way UNION, then merge in memory to retain the same global keyset order.
   // No COUNT(*), polling or scheduled reads; runs only when trash is opened.
   const filter=cursor?' WHERE (deletedAt<?3 OR (deletedAt=?4 AND (kind<?5 OR (kind=?6 AND id<?7))))':''
   const binds=cursor?[h,u,cursor[0],cursor[0],cursor[1],cursor[1],cursor[2]]:[h,u]
   const statements=[sources.slice(0,4),sources.slice(4)].map(group=>{
     const union=group.map(([kind,table,creator])=>
       `SELECT id,title,deleted_at AS deletedAt,'${kind}' AS kind FROM ${table}
         WHERE household_id=?1 AND ${creator}=?2 AND deleted_at IS NOT NULL`).join(' UNION ALL ')
     return db.prepare('SELECT * FROM ('+union+')'+filter+
       ' ORDER BY deletedAt DESC,kind DESC,id DESC LIMIT ?'+(binds.length+1))
       .bind(...binds,6)
   })
   const results=await db.batch(statements)
   const newest=(a,b)=>{
     for(const key of ['deletedAt','kind','id']){
       if(a[key]!==b[key])return a[key]>b[key]?-1:1
     }
     return 0
   }
   const all=results.flatMap(result=>result.results||[]).sort(newest).slice(0,6)
   const items=all.slice(0,5),last=items.at(-1)
   return json({items,nextCursor:all.length>5&&last?
     [last.deletedAt,last.kind,last.id].join('|'):null})
 }
 if(path==='/api/recycle/empty'&&request.method==='POST'){
   const body=await readBody(request)
   // Deliberately no automatic purge path. A destructive request requires a
   // separate, intentional client confirmation, plus a server-side token.
   if(body?.confirm!=='PERMANENTLY_EMPTY_RECYCLE_BIN')return json({error:'confirmation_required'},400)
   const owned=(table,creator)=>`household_id=?1 AND ${creator}=?2 AND deleted_at IS NOT NULL`
   const task=owned('tasks','creator_user_id')
   const routine=owned('routines','created_by')
   const anniversary=owned('anniversaries','created_by')
   const shopping=owned('shopping_items','created_by')
   const goal=owned('goals','created_by')
   // Keep relationships and photos intact: don't purge a plan linked from a
   // memory, a wish still referenced by a trip/goal, or a memory with media.
   const trip=owned('trips','created_by')+
     " AND NOT EXISTS (SELECT 1 FROM memories m WHERE m.linked_type='trip' AND m.linked_id=trips.id)"
   const wish=owned('wishes','created_by')+
     " AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.wish_id=wishes.id)"+
     " AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.wish_id=wishes.id)"+
     " AND NOT EXISTS (SELECT 1 FROM memories m WHERE m.linked_type='wish' AND m.linked_id=wishes.id)"
   const memory=owned('memories','created_by')+
     ' AND NOT EXISTS (SELECT 1 FROM media_assets a WHERE a.memory_id=memories.id)'
   const pre=[
     `DELETE FROM finance_links WHERE household_id=?1 AND target_type='trip'
         AND target_id IN (SELECT id FROM trips WHERE ${trip})`,
     `DELETE FROM finance_links WHERE household_id=?1 AND target_type='goal'
         AND target_id IN (SELECT id FROM goals WHERE ${goal})`,
     `DELETE FROM reminder_snoozes WHERE household_id=?1 AND (
       (kind='task' AND item_id IN (SELECT id FROM tasks WHERE ${task})) OR
       (kind='routine' AND item_id IN (SELECT id FROM routines WHERE ${routine})) OR
       (kind='anniversary' AND item_id IN (SELECT id FROM anniversaries WHERE ${anniversary})) OR
       (kind='trip' AND item_id IN (SELECT id FROM trips WHERE ${trip})))`,
     `DELETE FROM reminder_item_preferences WHERE household_id=?1 AND (
       (kind='task' AND item_id IN (SELECT id FROM tasks WHERE ${task})) OR
       (kind='routine' AND item_id IN (SELECT id FROM routines WHERE ${routine})) OR
       (kind='trip' AND item_id IN (SELECT id FROM trips WHERE ${trip})))`
   ]
   const deletions=[
     `DELETE FROM memories WHERE ${memory}`,
     `DELETE FROM tasks WHERE ${task}`,
     `DELETE FROM routines WHERE ${routine}`,
     `DELETE FROM anniversaries WHERE ${anniversary}`,
     `DELETE FROM shopping_items WHERE ${shopping}`,
     `DELETE FROM trips WHERE ${trip}`,
     `DELETE FROM goals WHERE ${goal}`,
     `DELETE FROM wishes WHERE ${wish}`
   ]
   // D1 batch is atomic. On any FK failure no partial purge is committed.
   try{
     const results=await db.batch([...pre,...deletions].map(sql=>db.prepare(sql).bind(h,u)))
     const deleted=results.slice(pre.length).reduce((sum,result)=>sum+(result.meta?.changes||0),0)
     return json({ok:true,deleted})
   }catch{
     return json({error:'related_records_prevent_purge'},409)
   }
 }
 if(path==='/api/recycle/restore'&&request.method==='POST'){
   const body=await readBody(request)
   const src=byKind.get(body?.kind),id=body?.id
   if(!src||typeof id!=='string'||!uuid.test(id))return json({error:'invalid_input'},400)
   const extra=['routines','wishes','goals','anniversaries','trips'].includes(src.table)?
     ',updated_at=?1':''
   const sql='UPDATE '+src.table+' SET deleted_at=NULL'+extra+
     ' WHERE id=?2 AND household_id=?3 AND '+src.creator+'=?4 AND deleted_at IS NOT NULL'
   const result=await db.prepare(sql).bind(iso(),id,h,u).run()
   if(!result.meta?.changes)return json({error:'not_found'},404)
   return json({ok:true,kind:body.kind,id,restored:true})
 }
 return json({error:'method_not_allowed'},405)
}
