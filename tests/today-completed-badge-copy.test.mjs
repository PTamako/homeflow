import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const today=app.slice(app.indexOf('<template v-for="row in visibleToday"'),app.indexOf('</template>',app.indexOf('<template v-for="row in visibleToday"')+3000))

test('completed recurring tasks have the same concise badge as one-time tasks',()=>{
 assert.match(app, /:label="row.routine.mark\?\.completed_at\?'已完成':'今天到期'"/)
 assert.match(app, /:label="row.done\?'已完成':row.task.dueOn/)
 assert.doesNotMatch(app, /:label="row.routine.mark\?\.completed_at\?'本期已完成'/)
 assert.match(app, /<span class="today-kind-label">{{ todayKindLabels\[row.kind\] }}<\/span>/)
})

test('short status does not change completed task state or plan navigation',()=>{
 assert.match(app, /:code="row.routine.mark\?\.completed_at\?'completed':'pending'"/)
 assert.match(app, /row.routine\?openPlans\('routine',row.routine.id,row.routine.occurrenceOn\|\|'',row.done\)/)
 assert.match(app, /@change="row.task\?toggleTask\(row.task\):row.routine\?toggleRoutine\(row.routine\):undefined"/)
})
