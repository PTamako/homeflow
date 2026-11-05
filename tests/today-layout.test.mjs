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

test('Today only shows completions from the current JST day, without archive toggle or extra D1 reads',()=>{
 assert.doesNotMatch(app,/显示历史完成|showDone|showHistory=1/);
 assert.match(app,/return t\.completedAt\?tokyoDate\(t\.completedAt\)===now:/);
 assert.match(app,/return '\/tasks\?status=all&today='\+date/);
 assert.match(app,/watch\(\[todayCategory,currentJstDay\]/);
 assert.ok(!app.includes('<b>事项分类</b>'),'the filter tabs should not have a redundant title');
 assert.match(app,/const visibleTasks=computed/);
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
 assert.ok(life.includes("document.getElementById('plan-item-'+id+(kind==='routine'&&item.periodOn?'-'+item.periodOn:''))?.scrollIntoView"))
 assert.ok(worker.includes("if(request.method==='GET'){"))
})

test('settings recycle bin is demand-loaded and recovery requires confirmation',()=>{
 const trash=readFileSync(new URL('../src/components/TrashPanel.vue',import.meta.url),'utf8')
 const management=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
 assert.ok(app.includes('<ManagePage v-show="tab===\'manage\'"'))
 assert.ok(management.includes('<TrashPanel v-if="active"/>'))
 assert.ok(trash.includes("if(expanded.value)void fetchTrash()"))
 assert.ok(trash.includes("const url='/api/recycle?limit=5'"))
 assert.ok(trash.includes("encodeURIComponent(cursor.value)"))
 assert.ok(app.includes('recoveryConfirm.value'))
})

test('Today defaults new tasks to today while clearly offering the undated list',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.ok(app.includes('newOneTimeTaskDraft(tokyoToday())'))
 assert.ok(app.includes("openPlans('unscheduled')"))
 assert.ok(app.includes('todayTasksUrl()'))
 assert.ok(app.includes('已存入「计划 → 待安排」'))
 assert.ok(life.includes("['unscheduled','shopping','wish','goal','trip']"))
 assert.ok(creator.includes('oneTimeTaskPayload(onceDraft.value,oncePet.value)'))
})

test('undated one-time plan uses shared optional date and returns to pending list',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(creator,/savedUnscheduled=kind\.value==='routine'&&form\.repeatType==='once'&&!onceDraft\.value\.dueOn/)
 assert.match(creator,/emit\('created',kind\.value,String\(result\.id\|\|''\),savedUnscheduled\)/)
 assert.match(creator,/function dismiss\(\)\{[^}]*onceDraft\.value=newOneTimeTaskDraft\(today\(\)\)/)
 assert.match(life,/planType\.value=unscheduled\?'unscheduled':kind/)
 assert.match(life,/notify\(unscheduled\?'已添加到待安排'/)
})

test('both one-off entry points share accessible optional dates and reminder defaults',()=>{
 const fields=readFileSync(new URL('../src/components/OneTimeTaskFields.vue',import.meta.url),'utf8')
 const payload=readFileSync(new URL('../src/one-time-task.ts',import.meta.url),'utf8')
 assert.ok(app.includes('<OneTimeTaskFields ref="newTaskFields" v-model="newTask" :profiles="profiles"/>'))
 assert.ok(fields.includes('id="one-time-task-date-label"'))
 assert.ok(fields.includes('<DateField v-model="model.dueOn" aria-labelledby="one-time-task-date-label"/>'))
 assert.ok(fields.includes('aria-label="清空计划日期" @click="model.dueOn=\'\'"'))
 assert.ok(fields.includes('v-if="!model.dueOn"'))
 assert.ok(payload.includes('dueOn:draft.dueOn||null'))
 assert.ok(payload.includes('remindEnabled:!!draft.dueOn&&draft.remindEnabled'))
 assert.ok(app.includes('const unscheduled=!newTask.value.dueOn'))
})

test('Today new-task dialog reuses the same input component but keeps offline save',()=>{
 const today=app.indexOf('<div class="section-title today-task-heading">')
 const overlay=app.indexOf('<Teleport to="body">',today)
 const form=app.indexOf('<form class="task-form" @submit.prevent="addTask">',overlay)
 const list=app.indexOf('<section class="panel today-checklist-panel">',overlay)
 assert.ok(today>=0&&overlay>today&&form>overlay&&list>form)
 assert.match(app,/const showAddTask=ref\(false\)/)
 assert.match(app,/@click="openAddTask">＋ 新增待办/)
 assert.match(app,/v-if="showAddTask" class="task-create-overlay"/)
 assert.match(app,/role="dialog" aria-modal="true" aria-labelledby="task-create-heading"/)
 assert.match(app,/<OneTimeTaskFields ref="newTaskFields" v-model="newTask" :profiles="profiles"\/>/)
 assert.match(app,/void nextTick\(\(\)=>newTaskFields\.value\?\.focusTitle\(\)\)/)
 assert.match(app,/async function addTask\(\)\{[\s\S]*?pendingTasks.value=await listPending\(user.value.id\)\s+dismissAddTask\(\)/)
 assert.match(app,/watch\(tab,value=>\{\s+clearToast\(\)\s+showAddTask.value=false/)
 assert.match(app,/@click="closeAddTask\(\);openPlans\('unscheduled'\)"/)
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 assert.match(css,/\.task-create-overlay\{position:fixed;inset:0;z-index:100/)
 assert.match(css,/\.task-create-dialog\{width:min\(100%,460px\);max-height:100%/)
 assert.match(app,/function closeAddTask\(\)\{\s+if\(loading.value\)return\s+dismissAddTask\(\)/)
})

test('Today checklist starts with compact category tabs and preserves item dividers',()=>{
 const start=app.indexOf('<section class="panel today-checklist-panel">')
 const tabs=app.indexOf('<div class="today-category-tabs" role="group"',start)
 const firstRow=app.indexOf('<template v-for="row in visibleToday"',tabs)
 assert.ok(start>=0 && tabs>start && firstRow>tabs,
   'Today category filters and tasks belong to the same card')
 const leading=app.slice(start,tabs)
 assert.ok(!leading.includes('<b>事项分类</b>'), 'redundant category heading removed')
 assert.ok(!leading.includes('class="row-between"') || leading.includes('v-if="pendingTasks.length"'),
   'no default spaced section header before the category filter')
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 assert.match(css,/\.today-checklist-panel\{margin-top:10px;padding-top:14px;padding-bottom:12px\}/)
 assert.match(css,/\.today-checklist-panel>\.today-category-tabs\{margin:0 0 6px/)
 assert.match(css,/\.task-row\{[^}]*border-top:1px solid/)
 assert.match(app,/v-for="category in visibleTodayCategories"/)
})
