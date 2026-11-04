import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {upcomingWithinDays,additionalReminders} from '../src/today-presentation.mjs'

test('Today anniversaries include today and the inclusive 30th day, not later events',()=>{
 const events=[
  {id:'past',nextOn:'2026-11-03'},
  {id:'today',nextOn:'2026-11-04'},
  {id:'soon',nextOn:'2026-11-11'},
  {id:'end',nextOn:'2026-12-04'},
  {id:'later',nextOn:'2026-12-05'},
  {id:'bad',nextOn:'not-a-date'}
 ]
 assert.deepEqual(upcomingWithinDays(events,'2026-11-04').map(x=>x.id),['today','soon','end'])
 assert.deepEqual(upcomingWithinDays(events,'2026-12-05'),[{id:'later',nextOn:'2026-12-05'}])
 assert.deepEqual(upcomingWithinDays(events,'wrong-date'),[])
})

test('30-day window works across leap day and year boundary',()=>{
 const events=[{nextOn:'2028-02-29'},{nextOn:'2028-03-01'},{nextOn:'2028-03-02'}]
 assert.equal(upcomingWithinDays(events,'2028-01-30').length,1)
 assert.equal(upcomingWithinDays([{nextOn:'2027-01-02'}],'2026-12-31').length,1)
})

test('Important Reminders only shows items not already in unified Today list',()=>{
 const reminders=[
  {kind:'task',id:'a',title:'购物'},
  {kind:'routine',id:'b',title:'梳毛'},
  {kind:'task',id:'c',title:'独立重要任务'},
  {kind:'anniversary',id:'birthday',title:'生日'},
  {kind:'trip',id:'t1',title:'整体旅行'},
  {kind:'trip',id:'t1:pack',title:'机票行李'},
  {kind:'shopping',id:'s1',title:'待买商品'}
 ]
 const keys=['task:a','routine:b','plan:trip:t1','plan:shopping:s1']
 assert.deepEqual(additionalReminders(reminders,keys).map(x=>x.id),['c','birthday','t1:pack'])
 assert.equal(additionalReminders([{kind:'task',id:'a'}],['task:a']).length,0)
})

test('Important Reminders loads in the hidden settings menu, keeping the red dot ready',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const important=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const i=app.indexOf('<ImportantReminders ref="importantRemindersRef"')
 assert.ok(app.includes('class="settings-popover"'))
 assert.ok(app.includes('class="settings-overlay"'))
 assert.ok(app.includes(':today-entry-keys="todayEntryKeys" compact'))
 assert.ok(!app.includes('<PushPanel v-if="tab='))
 assert.ok(i>0)
 assert.ok(i<app.indexOf('HOMEFLOW · TODAY'))
 assert.ok(i<app.indexOf('<h2>今日待办</h2>'))
 assert.ok(app.includes(':today-entry-keys="todayEntryKeys"'))
 assert.match(important,/watch\(\(\)=>props.todayDate,[\s\S]*?immediate:true/)
 assert.match(important,/additionalReminders\(items.value,props.todayEntryKeys\)/)
 assert.match(important,/onBeforeUnmount\(\(\)=>\{requestId\+\+\}\)/)
 assert.match(life,/todayAnniversaries=computed/)
 assert.match(life,/未来 30 天的纪念日/)
 assert.ok(!life.includes('查看今天的提醒'))
})

test('settings combines current account, push control, reminders and logout',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const push=readFileSync(new URL('../src/components/PushPanel.vue',import.meta.url),'utf8')
 const styles=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 const menu=app.slice(app.indexOf('class="settings-popover"'),app.indexOf('<span v-else class="phase">'))
 assert.match(menu,/当前账号[\s\S]*?<PushPanel[^>]*\/>[\s\S]*?<ImportantReminders[\s\S]*?退出登录/)
 assert.match(push,/开启推送/)
 assert.match(push,/关闭推送/)
 assert.match(push,/enabled\?disable\(\):enable\(\)/)
 assert.ok(!push.includes('重要日子与每日提醒'))
 assert.ok(!push.includes('setup-link'))
 assert.ok(app.includes('settingsOpen.value=false'))
 assert.ok(app.includes("event.key==='Escape'"))
 assert.match(styles,/\.settings-popover\{position:absolute/)
 assert.match(styles,/width:min\(336px,calc\(100vw - 32px\)\)/)
})

test('Settings shows a red dot only for outstanding additional reminders without extra D1 reads',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const important=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 assert.match(app,/:aria-label="hasImportantReminders\?'设置：今天有重要提醒':'设置'"/)
 assert.match(app,/v-if="hasImportantReminders" class="settings-alert-dot"/)
 assert.match(app,/v-show="settingsOpen" id="homeflow-settings"/)
 assert.match(app,/@presence-change="hasImportantReminders=\$event"/)
 assert.match(app,/<PushPanel v-if="settingsOpen" \/>/)
 assert.match(important,/watch\(\[visibleReminders,loading,error\]/)
 assert.match(important,/emit\('presenceChange',!isLoading&&!loadError&&rows.length>0\)/)
 assert.match(important,/loadedDate\.value===props\.todayDate/)
 assert.match(important,/refreshIfStale/)
 assert.equal((important.match(/fetch\('\/api\/reminders\?date/g)||[]).length,1)
 assert.match(css,/\.settings-alert-dot\{position:absolute/)
 assert.deepEqual(additionalReminders([{kind:'routine',id:'r'}],['routine:r']),[])
 assert.equal(additionalReminders([{kind:'anniversary',id:'a'}],[]).length,1)
})
