import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const api=readFileSync(new URL('../worker/today-page.js',import.meta.url),'utf8')
const icons=readFileSync(new URL('../src/components/AppIcon.vue',import.meta.url),'utf8')

test('Today reminder-only rows render the same system bell SVG instead of a checkbox',()=>{
 assert.match(app,/<AppIcon v-if="isReminderOnlyToday\(row\)"[^>]*name="bell"/)
 assert.match(app,/<input v-else-if="row.task\|\|row.routine" type="checkbox"/)
 assert.match(app,/isReminderOnlyToday\(row\)\?'仅提醒'/)
 assert.match(app,/row.done\|\|isReminderOnlyToday\(row\)\?'查看计划':'去处理'/)
 assert.match(icons,/<template v-else-if="name==='bell'">/)
})

test('reminder-only items do not inflate completion count or earn a Today completion action',()=>{
 assert.match(api,/completionTotal=filtered.filter\(row=>!reminderOnly\(row\)\).length/)
 assert.match(api,/completed=filtered.filter\(row=>row.done&&!reminderOnly\(row\)\).length/)
 assert.match(app,/todayCompletionTotal.value=Number\(data.completionTotal\?\?data.total\)\|\|0/)
 assert.match(app,/\{\{ completedTodayCount \}\} \/ \{\{ todayCompletionTotal \}\} 完成/)
 assert.match(app,/if\(!user.value\|\|isReminderOnlyToday\(row\)\)return false/)
})

test('today reminder-only rows refresh at Japanese midnight, including resumed iPhone PWAs',()=>{
 assert.match(app,/const untilMidnight=86400000-\(\(Date.now\(\)\+9\*3600000\)%86400000\)/)
 assert.match(app,/scheduleJstMidnightRefresh\(\)/)
 assert.match(app,/if\(user.value&&tab.value==='today'\)void reloadToday\(\)/)
 assert.match(app,/document.addEventListener\('visibilitychange',onForeground\)/)
 assert.match(app,/window.setInterval\(syncTick,SHARED_SYNC_MS\)/)
 assert.match(api,/task.dueOn!==date/)
 assert.match(api,/routine.occurrenceOn!==date/)
})
