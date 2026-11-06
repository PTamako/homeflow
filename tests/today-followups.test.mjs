import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {earliestUnfinishedGoalPeriod,jstDayOf} from '../worker/today-periods.js'

test('monthly savings shortfalls remain overdue across months, period by period',()=>{
 const g={goal_mode:'monthly',start_on:'2026-09-01',target_on:null}
 assert.deepEqual(earliestUnfinishedGoalPeriod(g,'2026-11-04'),{
   periodKey:'2026-09',dueOn:'2026-09-30'})
 assert.deepEqual(earliestUnfinishedGoalPeriod(g,'2026-11-04',new Set(['2026-09'])),{
   periodKey:'2026-10',dueOn:'2026-10-31'})
 assert.equal(earliestUnfinishedGoalPeriod(g,'2026-11-04',new Set(['2026-09','2026-10'])),null)
 assert.deepEqual(earliestUnfinishedGoalPeriod(g,'2026-11-30',new Set(['2026-09','2026-10'])),{
   periodKey:'2026-11',dueOn:'2026-11-30'})
})

test('yearly savings follow up and explicit last-period completion',()=>{
 const g={goal_mode:'yearly',start_on:'2026-06-01',target_on:'2028-02-01'}
 assert.equal(earliestUnfinishedGoalPeriod(g,'2026-12-30'),null)
 assert.deepEqual(earliestUnfinishedGoalPeriod(g,'2027-01-01'),{periodKey:'2026',dueOn:'2026-12-31'})
 assert.deepEqual(earliestUnfinishedGoalPeriod(g,'2028-03-01',new Set(['2026','2027'])),
   {periodKey:'2028',dueOn:'2028-02-01'})
 assert.equal(earliestUnfinishedGoalPeriod(g,'2028-03-01',new Set(['2026','2027','2028'])),null)
})

test('Japan calendar completion timestamp determines same-day checked visibility',()=>{
 assert.equal(jstDayOf('2026-11-03T16:00:00.000Z'),'2026-11-04')
 assert.equal(jstDayOf('2026-11-04 00:00:00'),'2026-11-04')
 assert.equal(jstDayOf(null),'')
})

test('Today category tabs show actual due rows while wish/goal actions live only in Plans',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(app,/visibleTodayCategories=computed/)
 assert.match(app,/todayAvailableKinds\.value\.includes\(category\.id as TodayKind\)/)
 assert.match(app,/v-for="category in visibleTodayCategories"/)
 assert.match(app,/openPlans\(row\.plan\.kind,row\.plan\.id,row\.plan\.periodKey\|\|''/)
 assert.doesNotMatch(app,/completeDuePlan/)
 assert.doesNotMatch(app,/ShoppingLedgerPicker/)
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const finance=readFileSync(new URL('../src/components/FinancePanel.vue',import.meta.url),'utf8')
 assert.match(life,/finishWish\(w\)/)
 assert.match(life,/ShoppingLedgerPicker/)
 assert.match(finance,/confirmGoalCompleted/)
 assert.match(finance,/initialPeriodKey/)
 assert.doesNotMatch(app,/toggleShoppingPlan/)
})
