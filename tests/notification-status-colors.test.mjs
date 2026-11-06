import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {notificationStatus,notificationTitle,notificationMessageRemainder}
  from '../src/notification-status.mjs'

const sample=(label,kind='routine')=>({
  kind,title:'资源垃圾 · '+label,message:label+' · 鸡毛大王 · 2026-11-06',
  readAt:'2026-11-06T08:46:00Z'
})

test('task notification state maps to consistent colors and keeps actor/date intact',()=>{
  for(const [label,tone] of [
    ['已完成','completed'],['已延期','deferred'],['待处理','pending'],['已跳过','skipped']
  ]){
    const item=sample(label)
    assert.deepEqual(notificationStatus(item),{label,tone})
    assert.equal(notificationTitle(item),'资源垃圾')
    assert.equal(notificationMessageRemainder(item),' · 鸡毛大王 · 2026-11-06')
  }
})

test('completion visual state never modifies the read/unread or push delivery state',()=>{
  const read=sample('已完成')
  const unread={...read,readAt:null}
  assert.deepEqual(notificationStatus(read),notificationStatus(unread))
  assert.equal(notificationTitle(read),notificationTitle(unread))
  assert.equal(notificationMessageRemainder(read),notificationMessageRemainder(unread))
  assert.equal(read.readAt!==null,true)
  assert.equal(unread.readAt,null)
})

test('family messages and normal reminders remain unchanged',()=>{
  for(const item of [
    {...sample('已完成','family')},
    {kind:'routine',title:'抽纸一卷',message:'提前 1 天提醒'},
    {kind:'task',title:'家务 · 已完成',message:'请确认任务是否完成'}
  ]){
    assert.equal(notificationStatus(item),null)
    assert.equal(notificationTitle(item),item.title)
    assert.equal(notificationMessageRemainder(item),item.message)
  }
})

test('notification colors are used for title badge and inline body, not read status',()=>{
  const ui=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
  assert.match(ui, /notificationTitle\(item\)/)
  assert.match(ui, /notice-task-status/)
  assert.match(ui, /notice-message-status/)
  for(const tone of ['completed','deferred','pending','skipped']){
    assert.match(ui,new RegExp('\\.notice-task-status-'+tone+'\\{'))
    assert.match(ui,new RegExp('\\.notice-message-status-'+tone+'\\{'))
  }
  assert.match(ui,/notice-state-unread/)
  assert.match(ui,/@click="markUnread\(item\)"/)
})
