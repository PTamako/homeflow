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
   // On-demand one bounded query: no background scans or COUNT(*).
   const union=sources.map(([kind,table,creator])=>
     `SELECT id,title,deleted_at AS deletedAt,'${kind}' AS kind FROM ${table}
       WHERE household_id=?1 AND ${creator}=?2 AND deleted_at IS NOT NULL`).join(' UNION ALL ')
   const binds=[h,u]
   const filter=cursor?' WHERE (deletedAt<?3 OR (deletedAt=?4 AND (kind<?5 OR (kind=?6 AND id<?7))))':''
   if(cursor)binds.push(cursor[0],cursor[0],cursor[1],cursor[1],cursor[2])
   const {results}=await db.prepare('SELECT * FROM ('+union+')'+filter+
      ' ORDER BY deletedAt DESC,kind DESC,id DESC LIMIT ?'+(binds.length+1))
      .bind(...binds,6).all()
   const all=results||[],items=all.slice(0,5),last=items.at(-1)
   return json({items,nextCursor:all.length>5&&last?
      [last.deletedAt,last.kind,last.id].join('|'):null})
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
