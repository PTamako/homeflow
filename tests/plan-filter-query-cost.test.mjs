import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('plan tabs fetch only selected category plus dependent goals for wishes',()=>{
  assert.match(source,/if\(type==='routine'\)return \['routines','tasks'\]/)
  assert.match(source,/if\(type==='wish'\)return \['wishes','goals'\]/)
  assert.match(source,/if\(type==='shopping'\)return \['shopping'\]/)
  assert.match(source,/if\(type==='goal'\)return \['goals'\]/)
  assert.match(source,/if\(type==='trip'\)return \['trips'\]/)
  assert.match(source,/const kinds=planRequestKinds\(selected\)/)
  assert.match(source,/@click="selectPlanType\(tab\.id as PlanType\)"/)
  assert.match(source,/const paths=kinds\.map\(kind=>listPath\(kind\)\)/)
  assert.match(source,/const pageLimit=5/)
})
