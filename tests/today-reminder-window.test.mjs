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


test('Important Reminders remains mounted in Management to keep the red dot ready',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const manage=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
 const important=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
 assert.ok(app.includes('<ManagePage v-show="tab===\'manage\'"'))
 assert.ok(app.includes(':today-entry-keys="todayEntryKeys"'))
 assert.ok(manage.includes('<ImportantReminders ref="reminders"'))
 assert.ok(manage.includes('compact @presence-change="emit('))
 assert.ok(!app.includes('settings-popover'))
 assert.match(important,/watch\(\(\)=>props.todayDate,[\s\S]*?immediate:true/)
 assert.match(important,/additionalReminders\(items.value,props.todayEntryKeys\)/)
 assert.match(important,/refreshIfStale/)
})
test('management collects invitation, password, push, trash, backup, and logout',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const manage=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
 for(const word of ['账号与家庭权限','通知与提醒设置','数据与回收箱','邀请家庭成员','退出登录']){
   assert.ok(manage.includes(word),word)
 }
 for(const component of ['SecurityPanel','PushPanel','TrashPanel','BackupPanel','ImportantReminders']){
   assert.ok(manage.includes('<'+component),component)
 }
 assert.ok(!app.includes('生成邀请码'))
 assert.ok(!app.includes('<BackupPanel v-if="tab===\'family\'"'))
 assert.match(app,/const nav=\[[^\n]*id:'manage'/)
})
test('Management red dot respects Today reminder presence without additional polling',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const important=readFileSync(new URL('../src/components/ImportantReminders.vue',import.meta.url),'utf8')
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 assert.ok(app.includes("n.id==='manage'&&(hasImportantReminders||goalReviews.length)"))
 assert.match(app,/@presence-change="hasImportantReminders=\$event"/)
 assert.match(important,/emit\('presenceChange',!isLoading&&!loadError&&rows.length>0\)/)
 assert.equal((important.match(/fetch\('\/api\/reminders\?date/g)||[]).length,1)
 assert.match(css,/\.nav-alert-dot\{position:absolute/)
 assert.deepEqual(additionalReminders([{kind:'routine',id:'r'}],['routine:r']),[])
 assert.equal(additionalReminders([{kind:'anniversary',id:'a'}],[]).length,1)
})

test('Today and Family keep their anniversary panels mounted',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(app, /<LifePanel v-if="tab==='today'\|\|tab==='family'\|\|tab==='plans'\|\|tab==='memories'"/)
 assert.match(app, /:mode="tab"/)
 assert.match(panel, /<template v-if="mode==='today'">[\s\S]*?未来 30 天的纪念日/)
 assert.match(panel, /<template v-else-if="mode==='family'">[\s\S]*?家人的重要日子/)
 assert.match(panel, /api\('\/anniversaries\/upcoming'\)/)
})
