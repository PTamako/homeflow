// Explicit keyword search only: bounded, demand-loaded reads. Split source sets for D1's UNION limit.
import {json} from './security.js'
import {monthWindow} from './list-pagination.js'
const uuid=/^[0-9a-f-]{36}$/i
const sources=[
  ['task','tasks',"COALESCE(due_on,substr(created_at,1,10))",'creator_user_id',"AND deleted_at IS NULL"],
  ['routine','routines',"COALESCE(next_due_on,anchor_date)",'created_by',"AND deleted_at IS NULL"],
  ['anniversary','anniversaries','event_date','created_by',"AND deleted_at IS NULL"],
  ['shopping','shopping_items',"COALESCE(due_on,substr(created_at,1,10))",'created_by',"AND deleted_at IS NULL"],
  ['wish','wishes',"COALESCE(target_on,substr(created_at,1,10))",'created_by',"AND deleted_at IS NULL"],
  ['goal','goals',"COALESCE(target_on,start_on,substr(created_at,1,10))",'created_by',"AND deleted_at IS NULL"],
  ['trip','trips',"COALESCE(start_on,substr(created_at,1,10))",'created_by',"AND deleted_at IS NULL"],
  ['memory','memories','happened_on','created_by',"AND deleted_at IS NULL"]
]
export async function searchRoute(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const params=new URL(request.url).searchParams
 const q=(params.get('q')||'').trim(),kind=params.get('kind')||'all'
 const year=params.get('year')||'',month=params.get('month')||''
 const raw=params.get('cursor')||''
 if(q.length>60||(!/[^\x00-\x7f]/.test(q)&&q.length<2)||!q||
    (kind!=='all'&&!sources.some(row=>row[0]===kind))||
    (year&&!/^(19|20|21)\d{2}$/.test(year))||
    (month&&!/^(0?[1-9]|1[0-2])$/.test(month))||
    (month&&!year)||raw.length>130)return json({error:'invalid_search'},400)
 let cursor=null
 if(raw){
  const m=raw.match(/^(\d{4}-\d{2}-\d{2})\|([a-z]+)\|([0-9a-f-]{36})$/i)
  if(!m||!sources.some(row=>row[0]===m[2])||!uuid.test(m[3]))
    return json({error:'invalid_search_cursor'},400)
  cursor={date:m[1],kind:m[2],id:m[3]}
 }
 const selected=kind==='all'?sources:sources.filter(row=>row[0]===kind)
 const args=[session.household_id,session.user_id,
   '%'+q.replace(/[\^%_]/g,x=>'^'+x)+'%']
 const where=[]
 const window=monthWindow(year,month?month.padStart(2,'0'):'')
 if(window){
  where.push('event_date>=?'+(args.length+1)+' AND event_date<?'+(args.length+2))
  args.push(window.start,window.end)
 }
 if(cursor){
  const n=args.length+1
  where.push('(event_date<?'+n+' OR (event_date=?'+(n+1)+
   ' AND (kind<?'+(n+2)+' OR (kind=?'+(n+3)+' AND id<?'+(n+4)+'))))')
  args.push(cursor.date,cursor.date,cursor.kind,cursor.kind,cursor.id)
 }
 // D1 has a low compound SELECT term ceiling. A single eight-source UNION
 // fails in production, so query at most four allowlisted sources per group.
 // Each group returns its top six rows: enough for the global five-row page
 // and lookahead, including when the next page crosses a source boundary.
 const statements=[]
 for(let i=0;i<selected.length;i+=4){
   const union=selected.slice(i,i+4).map(([label,table,dateExpr,creator,extra])=>
     `SELECT id,title,'${label}' AS kind,${dateExpr} AS event_date FROM ${table}
       WHERE household_id=?1 AND (visibility='household' OR ${creator}=?2)
         AND title LIKE ?3 ESCAPE '^' ${extra}`).join(' UNION ALL ')
   const sql='SELECT * FROM ('+union+')'+(where.length?' WHERE '+where.join(' AND '):'')+
     ' ORDER BY event_date DESC,kind DESC,id DESC LIMIT ?'+(args.length+1)
   statements.push(db.prepare(sql).bind(...args,6))
 }
 const batches=statements.length===1?[await statements[0].all()]:await db.batch(statements)
 const all=batches.flatMap(part=>part.results||[])
   .sort((a,b)=>String(b.event_date).localeCompare(String(a.event_date))||
     String(b.kind).localeCompare(String(a.kind))||String(b.id).localeCompare(String(a.id)))
 const items=all.slice(0,5),last=items.at(-1)
 return json({items,nextCursor:all.length>5&&last?
   last.event_date+'|'+last.kind+'|'+last.id:null})
}
