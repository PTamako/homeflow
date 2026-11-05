import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {uniquePlanRows} from '../src/plan-list-identity.mjs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('active recurring plan is always one row per plan ID',()=>{
  const same={id:'plan-a',title:'喂咕噜酱',periodOn:'2026-11-05'}
  const old={...same,periodOn:'2026-11-04'}
  const other={id:'plan-b',title:'另一计划'}
  assert.deepEqual(uniquePlanRows([old,other,same], 'routines','active'),[old,other])
})
test('history keeps each separate occurrence but not duplicate copies of the same period',()=>{
  const dates=['2026-11-03','2026-11-04','2026-11-05']
  const history=dates.map(periodOn=>({id:'plan-a',periodOn}))
  assert.deepEqual(uniquePlanRows([...history,history[1]],'routines','history'),history)
})
test('all other plan lists are deduped per ID across pagination',()=>{
  for(const kind of ['tasks','wishes','shopping','trips','goals'])
    assert.equal(uniquePlanRows([{id:'a'},{id:'b'},{id:'a'}],kind,'active').length,2)
})
test('switching Plan status clears the previous Today deep-link focus',()=>{
  const life=read('src/components/LifePanel.vue')
  const app=read('src/App.vue')
  assert.match(life,/function changePlanScope\(value:'active'\|'history'\)/)
  assert.match(life,/emit\('clearPlanFocus'\)/)
  assert.match(app,/@clear-plan-focus="clearPlanFocus"/)
  assert.match(life,/target\.value=uniquePlanRows\(/)
  assert.match(life,/if\(!listed\)target\.value=uniquePlanRows\(/)
})
