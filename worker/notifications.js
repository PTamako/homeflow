import {json} from './security.js'

export const jstNotificationDay=(now=Date.now())=>
  new Date(now+9*3600000).toISOString().slice(0,10)

const PAGE_SIZE=5
const UUID=/^[0-9a-f-]{36}$/i
const CURSOR=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\|[0-9a-f-]{36}$/i

// One record per *logical* push, not per subscribed device.
export async function saveNotification(db,item){
  const day=item.localDay||jstNotificationDay()
  const status=item.sentDevices>0
    ?(item.failedDevices>0?'partial':'sent'):'failed'
  await db.prepare(`INSERT INTO notification_inbox
    (id,household_id,sender_user_id,recipient_user_id,kind,source_id,title,message,
      delivery_status,sent_devices,failed_devices,local_day,dedupe_key)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
    ON CONFLICT(recipient_user_id,local_day,dedupe_key) DO UPDATE SET
      delivery_status=CASE WHEN notification_inbox.sent_devices>0 AND excluded.sent_devices=0
        THEN notification_inbox.delivery_status ELSE excluded.delivery_status END,
      sent_devices=MAX(notification_inbox.sent_devices,excluded.sent_devices),
      failed_devices=excluded.failed_devices`)
    .bind(item.id,item.householdId,item.senderId||null,item.recipientId,
      item.kind,item.sourceId||null,String(item.title||'').slice(0,90),
      String(item.message||'').slice(0,160),status,
      item.sentDevices||0,item.failedDevices||0,day,item.dedupeKey||null).run()
}

// Called in the existing 06:00 JST schedule, not on every page request.
export async function purgeOldNotifications(db,now=Date.now()){
  return db.prepare('DELETE FROM notification_inbox WHERE local_day<?1')
    .bind(jstNotificationDay(now)).run()
}
export async function notificationsRoute(request,db,path,session){
  const day=jstNotificationDay()
  if(path==='/api/notifications/today'&&request.method==='GET'){
    const params=new URL(request.url).searchParams
    const view=params.get('view')||'received'
    if(view!=='received'&&view!=='sent')return json({error:'invalid_input'},400)
    const before=params.get('before')
    if(before&&!CURSOR.test(before))return json({error:'invalid_input'},400)
    const focus=params.get('focus')
    if(focus&&(view!=='received'||!UUID.test(focus)))return json({error:'invalid_input'},400)
    const [beforeAt,beforeId]=before?before.split('|'):[null,null]
    const column=view==='sent'?'n.sender_user_id':'n.recipient_user_id'
    const select=`SELECT n.id,n.kind,n.source_id AS sourceId,n.title,n.message,
       n.delivery_status AS deliveryStatus,n.sent_devices AS sentDevices,
       n.failed_devices AS failedDevices,n.created_at AS createdAt,
       n.read_at AS readAt,n.sender_user_id AS senderUserId,
       n.recipient_user_id AS recipientUserId,
       COALESCE(s.login_name,'系统') AS senderName,r.login_name AS recipientName
       FROM notification_inbox n
       LEFT JOIN users s ON s.id=n.sender_user_id
       JOIN users r ON r.id=n.recipient_user_id`
    const sql=`${select}
       WHERE n.household_id=?1 AND n.local_day=?2 AND ${column}=?3
       ${before?'AND (n.created_at<?4 OR (n.created_at=?4 AND n.id<?5))':''}
       ORDER BY n.created_at DESC,n.id DESC LIMIT 6`
    const query=db.prepare(sql).bind(...(before?
      [session.household_id,day,session.user_id,beforeAt,beforeId]:
      [session.household_id,day,session.user_id]))
    const unread=db.prepare(`SELECT COUNT(*) AS count FROM notification_inbox
      WHERE household_id=?1 AND recipient_user_id=?2 AND local_day=?3
        AND read_at IS NULL`)
      .bind(session.household_id,session.user_id,day)
    // The extra lookup runs only for a clicked push deep-link, not regular page loads.
    const focused=focus?db.prepare(`${select}
      WHERE n.id=?1 AND n.household_id=?2 AND n.recipient_user_id=?3
        AND n.local_day=?4 LIMIT 1`)
      .bind(focus,session.household_id,session.user_id,day):null
    const [result,summary,focusResult]=await db.batch(focused?[query,unread,focused]:[query,unread])
    const rows=result.results||[],items=rows.slice(0,PAGE_SIZE)
    const last=items[items.length-1]
    return json({day,view,items,unreadCount:Number(summary.results?.[0]?.count||0),
      focusItem:focusResult?.results?.[0]||null,
      nextCursor:rows.length>PAGE_SIZE&&last?last.createdAt+'|'+last.id:null})
  }
  const match=path.match(/^\/api\/notifications\/([0-9a-f-]{36})\/read$/i)
  if(match&&request.method==='POST'){
    if(!UUID.test(match[1]))return json({error:'invalid_input'},400)
    const result=await db.prepare(`UPDATE notification_inbox
      SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP)
      WHERE id=?1 AND household_id=?2 AND recipient_user_id=?3
      AND local_day=?4`)
      .bind(match[1],session.household_id,session.user_id,day).run()
    if(!result.meta?.changes)return json({error:'not_found'},404)
    const count=await db.prepare(`SELECT COUNT(*) AS count FROM notification_inbox
      WHERE household_id=?1 AND recipient_user_id=?2 AND local_day=?3
        AND read_at IS NULL`)
      .bind(session.household_id,session.user_id,day).first()
    return json({ok:true,unreadCount:Number(count?.count||0)})
  }
  return json({error:'not_found'},404)
}
