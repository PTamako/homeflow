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
const feed=readFileSync(new URL('../worker/today-page.js',import.meta.url),'utf8')
test('Today combines one-off and recurring tasks in one checklist',()=>{
 assert.ok(app.includes('<h2>今日待办</h2>'))
 assert.ok(app.includes('v-for="row in visibleToday"'))
 assert.ok(app.includes('const visibleToday=computed(()=>unifiedToday.value)'))
 assert.ok(app.includes('scope="today-unified"'))
 assert.ok(feed.includes("key:'task:'+task.id"))
 assert.ok(feed.includes("key:'routine:'+routine.id"))
 assert.ok(feed.includes('Number(a.done)-Number(b.done)'),'incomplete rows should precede done')
 assert.ok(feed.includes("lifeRoute(internalGet('/api/routines/today?date='"))
 assert.ok(app.includes("api('/routines/'+r.id+'/mark'"))
 assert.ok(app.includes('toggleTask(row.task)'))
 assert.ok(app.includes('toggleRoutine(row.routine)'))
 assert.ok(app.includes(':allow-edit="!row.done&&!row.routine" :allow-delete="!row.done"'))
 assert.ok(app.includes('edit-label="延期" delete-label="跳过"'))
 assert.ok(app.includes('@edit="openPostpone(row)" @delete="skipToday(row)"'))
 assert.ok(!app.includes('delete-label="从今天移除"'))
 assert.ok(!app.includes('dismissedTodayKeys.value.includes(row.key)'))
 assert.ok(!app.includes('deleteRoutine(row.routine)'), 'Today must never delete the recurring source')
 assert.ok(!app.includes('deleteTask(row.task)'), 'Today must never delete the one-off source')
 assert.ok(!app.includes('editingRoutine'), 'Today must not embed a recurring-plan editor')
 assert.ok(!app.includes('editingTask'), 'Today must not embed a one-time editor')
 assert.ok(!app.includes('sendOrQueueTask'), 'Today should not write plan edits')
 assert.ok(app.includes("openPlans('task',row.task.id,'',row.done)"),
   'one-time items must navigate to Plans to edit')
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
 assert.ok(feed.includes("key:'plan:'+plan.kind+':'+plan.id"))
 assert.ok(feed.includes("todayPlansRoute(internalGet('/api/plans/today?date='"))
 assert.ok(app.includes('v-for="category in visibleTodayCategories"'))
 assert.ok(app.includes('v-for="row in visibleToday"'))
 assert.ok(app.includes('const visibleToday=computed(()=>unifiedToday.value)'))
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
 assert.match(feed,/done\?jstStamp\(task\.completedAt\)!==date:/);
 assert.match(app,/return '\/tasks\?status=all&today='\+date/);
 assert.match(app,/watch\(todayCategory,/);
 assert.ok(!app.includes('<b>事项分类</b>'),'the filter tabs should not have a redundant title');
 assert.match(feed,/const rows=\[\]/);
})

test('undated tasks go to Plans pending scheduling instead of Today',()=>{
 assert.ok(feed.includes('!task.dueOn||task.dueOn>date'))
 assert.ok(life.includes("type==='unscheduled'"))
 assert.ok(life.includes('安排到今天'))
})

test('search click targets the exact record, even beyond first five',()=>{
 const worker=readFileSync(new URL('../worker/tasks.js',import.meta.url),'utf8')
 assert.ok(app.includes('openPlans(result.kind,result.id)'))
 assert.ok(life.includes("task:'tasks',routine:'routines',memory:'memories',anniversary:'anniversaries'"))
  assert.ok(life.includes("document.getElementById('plan-item-'+id+"))
  assert.ok(life.includes('getBoundingClientRect().top+window.scrollY-176'))
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

test('Today add opens the unified Plans creation choices, while existing tasks remain in the Today list',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(app,/@click="openNewTaskInPlans">＋ 新增待办/)
 assert.match(app,/function openNewTaskInPlans\(\)\{\s+navigateTab\('plans'\)\s+focusPlanType\.value='all'\s+openPlanCreatorOnNavigate\.value=true/)
 assert.match(app,/:open-plan-creator="openPlanCreatorOnNavigate"/)
 assert.match(app,/return '\/tasks\?status=all&today='\+date/)
 assert.match(creator,/oneTimeTaskPayload\(onceDraft\.value,oncePet\.value\)/)
 assert.match(creator,/<OneTimeTaskFields v-if="form\.repeatType==='once'"/)
 assert.doesNotMatch(app,/<form class="task-form" @submit\.prevent="addTask"/)
})

test('undated one-time plan uses shared optional date and returns to pending list',()=>{
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(creator,/savedUnscheduled=kind\.value==='routine'&&form\.repeatType==='once'&&!onceDraft\.value\.dueOn/)
 assert.match(creator,/emit\('created',kind\.value,String\(result\.id\|\|''\),savedUnscheduled\)/)
 assert.match(creator,/function dismiss\(\)\{[^}]*onceDraft\.value=newOneTimeTaskDraft\(today\(\),props\.userId\)/)
 assert.match(life,/planType\.value=unscheduled\?'unscheduled':kind/)
 assert.match(life,/notify\(unscheduled\?'已添加到待安排'/)
})

test('the only one-off creation form is in Plans and shares optional dates and reminders',()=>{
 const fields=readFileSync(new URL('../src/components/OneTimeTaskFields.vue',import.meta.url),'utf8')
 const payload=readFileSync(new URL('../src/one-time-task.ts',import.meta.url),'utf8')
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(creator,/<OneTimeTaskFields v-if="form\.repeatType==='once'" v-model="onceDraft"/)
 assert.doesNotMatch(app,/<OneTimeTaskFields/)
 assert.ok(fields.includes('id="one-time-task-date-label"'))
 assert.ok(fields.includes('<DateField v-model="model.dueOn" aria-labelledby="one-time-task-date-label"/>'))
 assert.ok(fields.includes('aria-label="清空计划日期" @click="model.dueOn=\'\'"'))
 assert.ok(fields.includes('v-if="!model.dueOn"'))
 assert.ok(payload.includes('dueOn:draft.dueOn||null'))
 assert.ok(payload.includes('remindEnabled:!!draft.dueOn&&draft.remindEnabled'))
})

test('Today add navigates to Plans instead of showing its former modal',()=>{
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const creator=readFileSync(new URL('../src/components/PlanCreator.vue',import.meta.url),'utf8')
 assert.match(app,/@click="openNewTaskInPlans">＋ 新增待办/)
 assert.match(app,/function navigateTab\(value:typeof tab\.value\)\{\s+openPlanCreatorOnNavigate\.value=false/)
 assert.match(app,/function openPlans\(kind:string,id='',periodKey='',done=false\)\{\s+openPlanCreatorOnNavigate\.value=false/)
 assert.match(life,/:open-on-mount="props.openPlanCreator"/)
 assert.match(creator,/const opened=ref\(!!props.openOnMount\)/)
 assert.match(creator,/opened\?'收起新增计划':'＋ 新增计划'/)
 assert.match(creator,/v-if="opened"/)
 assert.doesNotMatch(app,/showAddTask|openAddTask|task-create-overlay|task-create-dialog|addTaskTrigger/)
 assert.doesNotMatch(app,/<Teleport to="body">/)
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


test('legacy Today dismissals retain their history, but swipe actions now skip or postpone',()=>{
 const api=readFileSync(new URL('../worker/tasks.js',import.meta.url),'utf8')
 const migration=readFileSync(new URL('../migrations/0023_today_dismissals.sql',import.meta.url),'utf8')
 assert.match(api,/path==='\/api\/tasks\/today\/dismiss'/)
 assert.match(api,/INSERT OR IGNORE INTO today_dismissals/)
 assert.match(api,/WHERE household_id=\?1 AND user_id=\?2 AND view_on=\?3/)
 assert.match(migration,/PRIMARY KEY \(household_id,user_id,view_on,item_key\)/)
 assert.match(app,/:allow-edit="!row.done&&!row.routine" :allow-delete="!row.done"/)
 assert.match(app,/@edit="openPostpone\(row\)" @delete="skipToday\(row\)"/)
 assert.doesNotMatch(app,/dismissToday\(row\)|从今天移除|从今日移除/)
})

test('Today swipe offers skip or postpone while full editing stays in Plans',()=>{
 const today=app.slice(app.indexOf('<template v-for="row in visibleToday"'),
   app.indexOf('加载更多今日待办（每次 5 条）'))
 assert.match(today,/:allow-edit="!row.done&&!row.routine" :allow-delete="!row.done"/)
 assert.match(today,/edit-label="延期" delete-label="跳过"/)
 assert.match(today,/@edit="openPostpone\(row\)" @delete="skipToday\(row\)"/)
 assert.doesNotMatch(today,/task-edit-form|<LifeItemEditor/)
 assert.doesNotMatch(today,/<div v-if="!row.done" class="today-decision-actions">/)
 assert.match(today, /row\.task\?openPlans\('task',row\.task\.id,'',row\.done\)/)
 assert.ok(life.includes('@edit="editOnce(t)"'), 'one-time edits remain in Plans')
 assert.ok(life.includes("@edit=\"edit('routines',r)\""), 'recurring edits remain in Plans')
 assert.match(app, /focusPlanScope\.value=done&&\(kind==='task'\|\|kind==='routine'/,
   'completed one-off task must navigate to the correct history tab')
})

test('Today plan digest does not silently drop items after the first 100 already-fetched entries',()=>{
 const source=readFileSync(new URL('../worker/plan-today.js',import.meta.url),'utf8')
 assert.match(source,/return json\(\{date,items:result,goalReviews:/)
 assert.doesNotMatch(source,/items:result\.slice\(0,100\)/)
})


test('Today notification and task heading use compact local spacing',()=>{
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8')
 assert.ok(app.includes('class="section-title today-task-heading"'))
 assert.match(css,/\.today-task-heading\{margin:10px 0 8px;gap:12px;align-items:center\}/)
 assert.match(css,/\.today-task-heading h2\{margin:0\}/)
 assert.match(css,/\.today-checklist-panel\{margin-top:10px;/)
})
