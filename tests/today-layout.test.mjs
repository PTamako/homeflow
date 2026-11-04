import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const sections={
  today:life.slice(life.indexOf('<template v-if="mode===\'today\'">'),life.indexOf('<template v-else-if="mode===\'family\'">')),
  family:life.slice(life.indexOf('<template v-else-if="mode===\'family\'">'),life.indexOf('<template v-else-if="mode===\'plans\'">')),
  plans:life.slice(life.indexOf('<template v-else-if="mode===\'plans\'">'),life.indexOf('<template v-else-if="mode===\'memories\'">'))
}
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
test('Today combines one-off and recurring tasks in one checklist',()=>{
 assert.ok(app.includes('<h2>今日待办</h2>'))
 assert.ok(app.includes('v-for="row in unifiedToday"'))
 assert.ok(app.includes('scope="today-unified"'))
 assert.ok(app.includes("key:'task:'+task.id"))
 assert.ok(app.includes("key:'routine:'+routine.id"))
 assert.ok(app.includes('Number(a.done)-Number(b.done)'),'incomplete rows should precede done')
 assert.ok(app.includes("api('/routines/today?date='"))
 assert.ok(app.includes("api('/routines/'+r.id+'/mark'"))
 assert.ok(app.includes('toggleTask(row.task)'))
 assert.ok(app.includes('toggleRoutine(row.routine)'))
 assert.ok(app.includes('editRoutine(row.routine)'))
 assert.ok(app.includes('deleteRoutine(row.routine)'))
 assert.ok(app.includes('kind="routines" :item="row.routine"'))
 assert.ok(!sections.today.includes('今日定期事项'),'no duplicate routine card')
 assert.ok(!life.includes("api('/routines/today')"),'do not double-fetch routines from D1')
})
test('Today preserves anniversary countdown and keeps recurring creation in Plans',()=>{
 assert.ok(sections.today.includes('countdown(e.nextOn)'))
 assert.ok(sections.today.includes(':datetime="e.nextOn"'))
 assert.ok(!sections.today.includes('submit.prevent="addRoutine"'))
 assert.ok(!sections.today.includes('submit.prevent="addAnniversary"'))
 assert.ok(life.includes('text-decoration:line-through'))
})
test('routine creation belongs under Plans and anniversary creation under Family',()=>{
 assert.ok(sections.plans.includes('<PlanCreator'))
 assert.ok(sections.plans.includes('任务／定期计划'))
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.ok(creator.includes('submit.prevent="submit"'))
 assert.ok(creator.includes("repeatType:'once'"))
 assert.ok(sections.family.includes('submit.prevent="addAnniversary"'))
 assert.ok(!sections.plans.includes('submit.prevent="addAnniversary"'))
 assert.ok(!sections.family.includes('submit.prevent="addRoutine"'))
})

test('Today includes dated plans in the single default All checklist with category tabs',()=>{
 assert.ok(app.includes("const todayCategory=ref<'all'|TodayKind>('all')"))
 for(const kind of ['shopping','wish','goal','trip']){
   assert.ok(app.includes("kind:'"+kind+"'"),'missing category '+kind)
 }
 assert.ok(app.includes("key:'plan:'+plan.kind+':'+plan.id"))
 assert.ok(app.includes("api('/plans/today?date='"))
 assert.ok(app.includes('v-for="category in todayCategories"'))
 assert.ok(app.includes('v-for="row in unifiedToday"'))
 assert.ok(app.includes('toggleShoppingPlan(row.plan)'))
 assert.ok(app.includes('openPlans(row.plan.kind)'))
 assert.ok(!sections.today.includes('今天的其他计划'),'no second plan card')
 assert.ok(!sections.today.includes('todayPlans'),'plans fetched only in parent')
 assert.ok(!sections.today.includes("api('/plans/today')"),'avoid duplicate D1 read')
})
