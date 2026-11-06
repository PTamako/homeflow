import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('Management groups reminder rules without changing the existing preference controls',()=>{
  const manage=read('src/components/ManagePage.vue')
  const panel=read('src/components/ImportantReminders.vue')
  assert.match(manage,/>分类提醒规则<\/span>/)
  assert.match(manage,/compact mode="settings"/)
  assert.match(panel,/<h3>普通与定期计划<\/h3>/)
  assert.match(panel,/<h3>储值计划<\/h3>/)
  assert.match(panel,/<h3>心愿计划<\/h3>/)
  assert.match(panel,/<h3>生日与纪念日<\/h3>/)
  assert.match(panel,/<h3>自动提醒的安静时段<\/h3>/)
  assert.match(panel,/单项提醒设置优先/)
  assert.match(panel,/>默认提前提醒/)
  assert.match(panel,/@change="saveLead/)
  assert.match(panel,/@click="saveQuiet"/)
  assert.match(panel,/mode==='settings'/)
  assert.match(panel,/不影响手动通知家人或「今日通知」记录/)
})

test('ordinary advance preference cannot override savings, wishes or anniversaries',()=>{
  const reminders=read('worker/reminders.js')
  const savings=read('worker/savings-reminders.js')
  const wishes=read('worker/wish-reminders.js')
  const birthdays=read('worker/birthdays.js')
  for(const type of ['task','routine','shopping','trip']){
    assert.ok(reminders.includes("forItem('"+type+"'"),type)
  }
  for(const type of ['goal','wish','anniversary']){
    assert.ok(!reminders.includes("forItem('"+type+"'"),type)
  }
  assert.match(reminders,/JSON\.parse\(e\.advance_days_json\|\|'\[\]'\)/)
  assert.match(reminders,/savingsReminders\(goals,date/)
  assert.match(reminders,/wishReminders\(wishes,date\)/)
  assert.match(savings,/mode==='monthly'\?3:7/)
  assert.match(wishes,/wish\.remind_enabled!==1/)
  assert.match(birthdays,/BIRTHDAY_LEAD_DAYS = Object\.freeze\(\[30,7,1,0\]\)/)
})
