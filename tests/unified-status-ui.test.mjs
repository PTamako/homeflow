import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {statusPresentation} from '../src/status-presentation.mjs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('one semantic palette covers every workflow status, including status aliases',()=>{
  const expectations=[
    ['completed','已完成','success'],['met','已达标','success'],
    ['linked','已关联','success'],['confirmed','已确认','success'],
    ['active','进行中','info'],['planning','规划中','info'],
    ['deferred','已延期','info'],['sent','已推送','info'],
    ['pending','待处理','warning'],['to_buy','待购买','warning'],
    ['verification_pending','待核验','warning'],['important','重要','warning'],
    ['overdue','逾期','danger'],['missed','未完成','danger'],
    ['shortfall','未达标','danger'],['conflict','同步冲突','danger'],
    ['skipped','已跳过','muted'],['cancelled','已取消','muted'],
    ['deleted','已删除','danger'],['enabled','已开启','success'],
    ['disabled','已关闭','muted'],['unavailable','不可用','warning'],
    ['unscheduled','待安排','muted'],['not_started','未开始','muted']
  ]
  for(const [code,label,tone] of expectations){
    assert.deepEqual(statusPresentation(code),{label,tone},code)
  }
  assert.deepEqual(statusPresentation('已达标'),statusPresentation('met'))
  assert.deepEqual(statusPresentation('进行中'),statusPresentation('active'))
  assert.deepEqual(statusPresentation('unknown-integration'),{
    label:'unknown-integration',tone:'muted'
  })
})

test('all workflow list surfaces use one StatusBadge implementation',()=>{
  const app=read('src/App.vue')
  const life=read('src/components/LifePanel.vue')
  const reminders=read('src/components/ImportantReminders.vue')
  const finance=read('src/components/FinancePanel.vue')
  const shopping=read('src/components/ShoppingLedgerPicker.vue')
  const push=read('src/components/PushPanel.vue')
  const trash=read('src/components/TrashPanel.vue')
  const component=read('src/components/StatusBadge.vue')
  const palette=read('src/style.css')
  for(const [name,file] of [
    ['Today tasks',app],['Plans/history',life],['Pending reminders',reminders],
    ['Savings ledger',finance],['Shopping ledger picker',shopping],
    ['Push settings',push],['Recycle bin',trash]
  ]){
    assert.match(file,/import StatusBadge from/,name)
    assert.match(file,/<StatusBadge/,name)
  }
  for(const tone of ['success','info','warning','danger','muted']){
    assert.match(component,new RegExp('hf-status-'+tone))
    assert.match(palette,new RegExp('--hf-'+tone+'-text'))
    assert.match(palette,new RegExp('--hf-'+tone+'-bg'))
  }
  assert.match(component,/font-size:11px/)
  assert.match(component,/white-space:nowrap/)
  assert.match(component,/computed\(\(\)=>statusPresentation\(props.code\)\)/)
})

test('plans, histories and trip sublists no longer expose raw status strings',()=>{
  const life=read('src/components/LifePanel.vue')
  assert.doesNotMatch(life,/\{\{ w\.status \}\}/)
  assert.doesNotMatch(life,/\{\{ booking\.status \}\}/)
  assert.match(life,/:code="w.status"/)
  assert.match(life,/:code="t.status"/)
  assert.match(life,/:code="period.status==='pending'\?'verification_pending':period.status"/)
  assert.match(life,/:code="s.completed_at\?'completed':'to_buy'"/)
  assert.match(life,/:code="itemDone\(it.externalId\)\?'completed':'pending'"/)
  assert.match(life,/:code="itemDone\(task.externalId\)\?'completed':'pending'"/)
  assert.match(life,/:code="itemDone\(piece.externalId\)\?'completed':'pending'"/)
  assert.match(life,/:code="booking.status\|\|'pending'"/)
})

test('today, notifications, reminders and finance share statuses without changing state',()=>{
  const app=read('src/App.vue')
  const notifications=read('src/components/TodayNotifications.vue')
  const reminder=read('src/components/ImportantReminders.vue')
  const finance=read('src/components/FinancePanel.vue')
  const picker=read('src/components/ShoppingLedgerPicker.vue')
  assert.match(app,/op.status==='conflict'\?'conflict':'awaiting_network'/)
  assert.match(app,/row.done\?'completed':'pending'/)
  assert.match(reminder,/item.dueOn<todayDate/)
  assert.match(finance,/periodDisplay.status.startsWith\('进行中'\)\?'active'/)
  assert.match(picker,/linkedEntryIds.has\(String\(entry.id\)\)/)
  assert.match(read('src/components/PushPanel.vue'),/!available\?'unavailable':enabled\?'enabled':'disabled'/)
  assert.match(read('src/components/TrashPanel.vue'),/<StatusBadge code="deleted" \/>/)
  assert.match(notifications,/var\(--hf-success-text\)/)
  assert.match(notifications,/var\(--hf-danger-text\)/)
  assert.match(notifications,/function readStateLabel\(item:Notice\)/)
  assert.match(notifications,/function deliveryTone\(item:Notice\)/)
  assert.doesNotMatch(finance,/状态：\{\{ periodDisplay.status \}\}/)
})
