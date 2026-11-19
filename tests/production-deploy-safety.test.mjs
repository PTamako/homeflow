import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {scheduledGoalPage} from '../worker/goal-settlements.js'

test('large savings populations rotate across all 60-item pages in JST days',()=>{
 const pages=Array.from({length:3},(_,n)=>{
  const date=new Date(Date.parse('2026-11-19T00:00:00Z')+n*86400000).toISOString().slice(0,10)
  return scheduledGoalPage(date,121)
 })
 assert.equal(new Set(pages).size,3)
 assert.equal(scheduledGoalPage('2026-11-19',2),0)
 assert.equal(scheduledGoalPage('2026-11-19',0),0)
})
test('normal-size daily settlements remain one bounded D1 read',()=>{
 const code=readFileSync(new URL('../worker/goal-settlements.js',import.meta.url),'utf8')
 assert.match(code,/LIMIT 61/)
 assert.ok(code.includes('if(firstPage.length>60)'))
 assert.match(code,/LIMIT 60 OFFSET \\?2/)
 assert.ok(code.includes('for(const goal of rotateGoalsForDate(goals,today))'))
})
test('obsolete production write entrypoints are removed, manual HomeFlow deploy remains',()=>{
 for(const file of [
  'four-app-production-release.yml','four-app-resume-staged-release.yml',
  'four-app-finalize-production.yml','study-homeflow-hotfix.yml'])
  assert.equal(existsSync(new URL('../.github/workflows/'+file,import.meta.url)),false,file)
 const deploy=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8')
 assert.match(deploy,/workflow_dispatch:/)
 assert.match(deploy,/HOMEFLOW_RELEASE_APPROVED/)
 assert.doesNotMatch(deploy,/wrangler d1 migrations apply/)
})
