import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const inbox=read('components/TodayNotifications.vue')
const life=read('components/LifePanel.vue')
const app=read('App.vue')

test('received and sent tabs render only rows loaded for their selected view/day/account',()=>{
 assert.match(inbox,/const loadedNoticeScope=ref\(''\)/)
 assert.match(inbox,/noticeScope=computed\(\(\)=>\[props\.userId,props\.todayDate,view\.value\]\.join\('\|'\)\)/)
 assert.match(inbox,/visibleNotices=computed\(\(\)=>view\.value!=='pending'&&\s*loadedNoticeScope\.value===noticeScope\.value\?notices\.value:\[\]\)/)
 assert.match(inbox,/loadedNoticeScope\.value=requestedScope/)
 assert.match(inbox,/<div v-for="item in visibleNotices"/)
 assert.match(inbox,/v-else-if="!visibleNotices\.length"/)
 assert.doesNotMatch(inbox,/<div v-for="item in notices"/)
 assert.match(inbox,/loading\|\|\(!error&&loadedNoticeScope!==noticeScope\)/)
})

test('rapid category changes reject late old-view responses, including switching to pending',()=>{
 assert.match(inbox,/const request=\+\+generation,day=props\.todayDate,account=props\.userId/)
 assert.match(inbox,/const requestedView=view\.value,requestedScope=noticeScope\.value/)
 assert.match(inbox,/requestedView!==view\.value\|\|!props\.active\)return false/)
 assert.match(inbox,/requestedView==='pending'\)await pendingReminders\.value\?\.refresh\(\)/)
 assert.match(inbox,/watch\(view,\(\)=>\{[\s\S]*?generation\+\+[\s\S]*?if\(view\.value!=='pending'\)void load\(true\)/)
 assert.match(inbox,/!reset&&loadedNoticeScope\.value!==noticeScope\.value/)
})

test('read acknowledgments never invalidate the newly selected view mid-flight',()=>{
 assert.match(inbox,/const account=props\.userId,scope=noticeScope\.value,epoch=viewEpoch/)
 assert.match(inbox,/account!==props\.userId\|\|scope!==noticeScope\.value\|\|epoch!==viewEpoch\)return/)
 assert.match(inbox,/day!==props\.todayDate\|\|view\.value!=='received'\|\|epoch!==viewEpoch\)return/)
 assert.match(inbox,/focusedReceivedLoad&&view\.value==='received'\)return/)
 assert.match(inbox,/viewEpoch\+\+/)
 assert.match(inbox,/scope!==noticeScope\.value\|\|epoch!==viewEpoch\)return/)
 assert.match(inbox,/day!==props\.todayDate\|\|view\.value!=='received'\|\|epoch!==viewEpoch\)return/)
 assert.match(inbox,/try\{loaded=await load\(true,id\)\}/)
})

test('plan tab changes hide unrelated rows without collapsing the iPhone page height',()=>{
 assert.match(life,/const lastPlanQueryKey=ref\(''\)/)
 assert.match(life,/const planQueryKey=computed/)
 assert.match(life,/planGridStale=computed\(\(\)=>lastPlanQueryKey\.value!==planQueryKey\.value\)/)
 assert.match(life,/lastPlanQueryKey\.value=queryKey/)
 assert.match(life,/:class="\{'life-grid--stale':planGridStale\}"/)
 assert.match(life,/:inert="listLoading\|\|planGridStale"/)
 assert.match(life,/:aria-hidden="planGridStale"/)
 assert.match(life,/\.life-grid--stale\{visibility:hidden;pointer-events:none\}/)
 assert.doesNotMatch(life,/items\.value=\[\];other\.value=\[\];goals\.value=\[\];trips\.value=\[\]/)
})

test('other tab lists use their own invalidation guards',()=>{
 assert.match(app,/watch\(todayCategory,\(\)=>\{\s*todayRows\.value=\[\]/)
 assert.match(app,/generation!==todayPageGeneration\|\|user\.value\?\.id!==userId/)
 assert.match(life,/if\(!anniversaryRowsReady\.value\)return \[\]/)
 assert.match(life,/v-for="m in listLoading\?\[\]:items"/)
})
