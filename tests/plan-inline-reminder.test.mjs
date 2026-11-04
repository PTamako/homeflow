import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('plan reminders are configured from plan rows without background D1 polling',()=>{
 const plan=read('src/components/LifePanel.vue')
 const editor=read('src/components/ReminderItemEditor.vue')
 assert.match(plan,/toggleReminderEditor\('routine',r\.id\)/)
 assert.match(plan,/toggleReminderEditor\('task',t\.id\)/)
 assert.match(plan,/toggleReminderEditor\('trip',tripDetail\.id\+':'\+task\.externalId\)/)
 assert.match(plan,/v-if="reminderTarget\?\.kind==='routine'/)
 assert.match(plan,/v-if="reminderTarget\?\.kind==='task'/)
 assert.match(plan,/v-if="reminderTarget\?\.kind==='trip'/)
 assert.match(editor,/watch\(\(\)=>\[props\.kind,props\.itemId\]/)
 assert.match(editor,/\/api\/reminders\/item\?/)
 assert.match(editor,/method:reset\?'DELETE':'PUT'/)
 assert.match(editor,/<PageToast :toast="toast"\/>/)
})
