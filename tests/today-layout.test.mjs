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
 assert.ok(app.includes('v-for="row in visibleToday"'))
 assert.ok(app.includes('const visibleToday=computed(()=>unifiedToday.value.slice(0,todayVisibleCount.value))'))
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
   assert.ok(app.includes(kind+":'"),'missing category '+kind)
 }
 assert.ok(app.includes("key:'plan:'+plan.kind+':'+plan.id"))
 assert.ok(app.includes("api('/plans/today?date='"))
 assert.ok(app.includes('v-for="category in visibleTodayCategories"'))
 assert.ok(app.includes('v-for="row in visibleToday"'))
 assert.ok(app.includes('const visibleToday=computed(()=>unifiedToday.value.slice(0,todayVisibleCount.value))'))
 assert.ok(!app.includes('ShoppingLedgerPicker'))
 assert.ok(!app.includes('toggleShoppingLink(row.plan)'))
 assert.ok(!app.includes('completeDuePlan(row.plan)'))
 assert.ok(!app.includes('toggleShoppingPlan(row.plan)'))
 assert.ok(app.includes("openPlans(row.plan.kind,row.plan.id,row.plan.periodKey||'',row.done)"))
 assert.ok(sections.plans.includes('返回今天'))
 assert.ok(sections.plans.includes('确认心愿已实现'))
 assert.ok(sections.plans.includes('ShoppingLedgerPicker'))
 assert.ok(!sections.today.includes('今天的其他计划'),'no second plan card')
 assert.ok(!sections.today.includes('todayPlans'),'plans fetched only in parent')
 assert.ok(!sections.today.includes("api('/plans/today')"),'avoid duplicate D1 read')
})

test('undated tasks go to Plans pending scheduling instead of Today',()=>{
 assert.ok(app.includes('!!t.dueOn&&t.dueOn<=now'))
 assert.ok(life.includes("type==='unscheduled'"))
 assert.ok(life.includes('安排到今天'))
})

test('search click targets the exact record, even beyond first five',()=>{
 const worker=readFileSync(new URL('../worker/tasks.js',import.meta.url),'utf8')
 assert.ok(app.includes('openPlans(result.kind,result.id)'))
 assert.ok(life.includes("task:'tasks',routine:'routines',memory:'memories',anniversary:'anniversaries'"))
 assert.ok(life.includes("document.getElementById('plan-item-'+id)?.scrollIntoView"))
 assert.ok(worker.includes("if(request.method==='GET'){"))
})

test('settings recycle bin is demand-loaded and recovery requires confirmation',()=>{
 const trash=readFileSync(new URL('../src/components/TrashPanel.vue',import.meta.url),'utf8')
 const management=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
 assert.ok(app.includes('<ManagePage v-show="tab===\'manage\'"'))
 assert.ok(management.includes('<TrashPanel v-if="active"/>'))
 assert.ok(trash.includes("if(expanded.value)void fetchTrash()"))
 assert.ok(trash.includes("new URLSearchParams({limit:'5'})"))
 assert.ok(app.includes('recoveryConfirm.value'))
})

test('Today defaults new tasks to today while clearly offering the undated list',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.ok(app.includes("due=ref(tokyoToday())"))
 assert.ok(app.includes("openPlans('unscheduled')"))
 assert.ok(app.includes("todayTasksUrl()"))
 assert.ok(app.includes("已存入「计划 → 待安排」"))
 assert.ok(life.includes("['routine','unscheduled','shopping','wish','goal','trip']"))
 assert.ok(creator.includes("form.leaveUnscheduled?null:form.date"))
})

test('undated one-time plan stays in pending list and resets creation checkbox',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(creator,/savedUnscheduled=kind\.value==='routine'&&form\.repeatType==='once'&&form\.leaveUnscheduled/)
 assert.match(creator,/emit\('created',kind\.value,String\(result\.id\|\|''\),savedUnscheduled\)/)
 assert.match(creator,/function dismiss\(\)\{[^}]*form\.leaveUnscheduled=false/)
 assert.match(life,/planType\.value=unscheduled\?'unscheduled':kind/)
 assert.match(life,/notify\(unscheduled\?'已添加到待安排'/)
})
