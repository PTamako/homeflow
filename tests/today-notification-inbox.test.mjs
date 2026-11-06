import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {jstNotificationDay,saveNotification,purgeOldNotifications,notificationsRoute}
  from '../worker/notifications.js'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const ID='33333333-3333-4333-8333-333333333333'
const session={household_id:'home',user_id:B}
const request=(url,method='GET')=>new Request('https://homeflow.invalid'+url,{method})

test('JST calendar day changes at Tokyo midnight, not at UTC midnight',()=>{
 assert.equal(jstNotificationDay(Date.parse('2026-11-05T14:59:59Z')),'2026-11-05')
 assert.equal(jstNotificationDay(Date.parse('2026-11-05T15:00:00Z')),'2026-11-06')
})

test('notifications list uses recipient-only or sender-only scope, current day and LIMIT 6',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){
  queries.push({sql,args})
  return {sql,args}
 }}},async batch(){return [
   {results:[{id:ID,createdAt:'2026-11-05 07:00:00'}]},
   {results:[{count:2}]}
 ]}}
 const result=await notificationsRoute(request('/api/notifications/today?view=received'),db,
   '/api/notifications/today',session)
 assert.equal(result.status,200)
 assert.equal((await result.json()).unreadCount,2)
 assert.match(queries[0].sql,/n.recipient_user_id=\?3/)
 assert.doesNotMatch(queries[0].sql,/n.sent_devices>0/)
 assert.match(queries[0].sql,/n.local_day=\?2/)
 assert.match(queries[0].sql,/LIMIT 6/)
 assert.deepEqual(queries[0].args.slice(0,1),['home'])
 assert.equal(queries[0].args[2],B)
 assert.match(queries[1].sql,/read_at IS NULL/)
 const sent=await notificationsRoute(request('/api/notifications/today?view=sent'),db,
  '/api/notifications/today',session)
 assert.equal(sent.status,200)
 assert.match(queries[2].sql,/n.sender_user_id=\?3/)
 assert.doesNotMatch(queries[2].sql,/AND n.sent_devices>0/)
})

test('only recipient from current household can mark today delivery as read',async()=>{
 const queries=[]
 let changed=0
 const db={prepare(sql){return {bind(...args){
  queries.push({sql,args})
  return {run:async()=>({meta:{changes:changed}}),first:async()=>({count:0})}
 }}}}
 const path='/api/notifications/'+ID+'/read'
 const forbidden=await notificationsRoute(request(path,'POST'),db,path,session)
 assert.equal(forbidden.status,404)
 assert.match(queries[0].sql,/recipient_user_id=\?3/)
 assert.match(queries[0].sql,/local_day=\?4/)
 assert.equal(queries[0].args[2],B)
 changed=1
 const ok=await notificationsRoute(request(path,'POST'),db,path,session)
 assert.equal(ok.status,200)
 assert.equal((await ok.json()).unreadCount,0)
 assert.match(queries[2].sql,/recipient_user_id=\?2/)
})

test('saving a logical push uses one insert and typed delivery result',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){
  queries.push({sql,args})
  return {run:async()=>({meta:{changes:1}})}
 }}}}
 await saveNotification(db,{id:ID,householdId:'home',senderId:A,recipientId:B,
  kind:'task',sourceId:ID,title:'照顾豆沙',message:'记得喂药',
  sentDevices:1,failedDevices:1,localDay:'2026-11-05'})
 assert.equal(queries.length,1)
 assert.match(queries[0].sql,/ON CONFLICT DO UPDATE SET/)
 assert.equal(queries[0].args[8],'partial')
 assert.equal(queries[0].args[3],B)
})

test('old notification cleanup cannot delete any task or plan rows',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {
  run:async()=>({meta:{changes:3}})
 }}}}}
 await purgeOldNotifications(db,Date.parse('2026-11-05T21:00:00Z'))
 assert.match(queries[0].sql,/^DELETE FROM notification_inbox WHERE local_day<\?1$/)
 assert.equal(queries[0].args[0],'2026-11-06')
})

test('today UI, 06:00 push and installed PWA keep unread notification badges',()=>{
 const app=read('src/App.vue'),ui=read('src/components/TodayNotifications.vue')
 const sw=read('public/sw.js'),web=read('worker/webpush.js')
 const worker=read('worker/index.js')
 assert.match(app,/TodayNotifications ref="todayNotificationsRef"/)
 assert.match(app,/:today-entry-keys="todayEntryKeys"/)
 assert.doesNotMatch(app,/nav-alert-dot/)
 assert.match(ui,/notice-red-dot/)
 assert.match(ui,/unread>0/)
 assert.match(app,/badge.setAppBadge\?\./)
 assert.match(ui,/我收到的/)
 assert.match(ui,/我发送的/)
 assert.match(ui,/标记已读/)
 assert.match(sw,/self.navigator.setAppBadge/)
 assert.match(sw,/homeflow-open-notification/)
 assert.match(web,/saveNotification\(db/)
 assert.match(web,/dedupeKey:'scheduled:'\+key/)
 assert.match(web,/recordInInbox:true/)
 assert.match(worker,/purgeOldNotifications/)
})


test('opening a push deep-link loads a scoped, exact notification without affecting normal pagination',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {sql,args}}}},
  async batch(statements){
   assert.equal(statements.length,3)
   return [{results:[{id:A,createdAt:'2026-11-05 07:00:00'}]},
     {results:[{count:0}]},{results:[{id:ID,readAt:'2026-11-05 07:01:00'}]}]
  }}
 const result=await notificationsRoute(request('/api/notifications/today?view=received&focus='+ID),
   db,'/api/notifications/today',session)
 assert.equal(result.status,200)
 const data=await result.json()
 assert.equal(data.focusItem.id,ID)
 assert.equal(data.items.length,1)
 assert.match(queries[2].sql,/n.recipient_user_id=\?3/)
 assert.match(queries[2].sql,/n.local_day=\?4/)
 assert.deepEqual(queries[2].args,[ID,'home',B,jstNotificationDay()])
 const invalid=await notificationsRoute(request('/api/notifications/today?view=sent&focus='+ID),
   db,'/api/notifications/today',session)
 assert.equal(invalid.status,400)
})

test('push click opens the matching notification or plan and keeps badge state in sync',()=>{
 const app=read('src/App.vue'),ui=read('src/components/TodayNotifications.vue')
 const sw=read('public/sw.js')
 assert.match(app,/openIncomingNotification\(notificationId\)/)
 assert.match(app,/:focus-notification-id="notificationToOpen"/)
 assert.match(ui,/showIncomingNotification\(props.focusNotificationId\)/)
 assert.match(ui,/params.set\('focus',focusId\)/)
 assert.match(ui,/emit\('unreadChange',unread.value\)/)
 assert.match(ui,/notice-focused/)
 assert.match(sw,/else if\(target.searchParams.has\('notificationId'\)\)/)
 assert.match(sw,/notificationId:target.searchParams.get\('notificationId'\)/)
})

test('received and sent notifications display linked household member names, not login emails',()=>{
 const app=read('src/App.vue'),ui=read('src/components/TodayNotifications.vue')
 assert.match(app,/:member-profiles="profiles"/)
 assert.match(ui,/memberProfiles:Array<\{memberUserId:string\|null;displayName:string\}>/)
 assert.match(ui,/props\.memberProfiles\.find\(p=>p\.memberUserId===userId\)/)
 assert.match(ui,/profile\?\.displayName\?\.trim\(\)\|\|'未设置姓名'/)
 assert.match(ui,/'发送给：'\+memberDisplayName\(item\.recipientUserId\)/)
 assert.match(ui,/'来自：'\+memberDisplayName\(item\.senderUserId\)/)
 assert.doesNotMatch(ui,/\+item\.(senderName|recipientName)/)
})

test('sent notices show recipient read status separately from push delivery status',()=>{
 const ui=read('src/components/TodayNotifications.vue')
 const api=read('worker/notifications.js')
 assert.match(ui,/function readStateLabel\(item:Notice\)/)
 assert.match(ui,/view\.value==='sent'\?'对方已读':'已读'/)
 assert.match(ui,/return view\.value==='sent'\?'对方未读':'未读'/)
 assert.match(ui,/notice-state-read/)
 assert.match(ui,/notice-state-unread/)
 assert.match(ui,/notice-state-time/)
 assert.match(ui,/function deliveryDetail\(item:Notice\)/)
 assert.match(ui,/if\(item\.sentDevices===0\)return '仅应用内'/)
 assert.match(ui,/function deliveryTone\(item:Notice\)/)
 assert.match(ui,/return item\.failedDevices>0\?'partial':'sent'/)
 assert.match(ui,/notice-delivery-'\+deliveryTone\(item\)/)
 for(const tone of ['sent','partial','app-only']){
   assert.match(ui,new RegExp('\\.notice-delivery-'+tone+'\\{'))
 }
 assert.match(ui,/\.notice-state-read\{color:#216e4a/)
 assert.match(ui,/\.notice-state-unread\{color:#b33e44/)
 assert.match(api,/n\.read_at AS readAt/)
 assert.match(api,/n\.sender_user_id/)
})
