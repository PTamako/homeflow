import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('anniversary tabs never display rows from an earlier tab or date filter',()=>{
  // The anniversary list shares items with Today's reminders, wishes and memories.
  // A tab or date-filter change must invalidate the *visible* rows immediately,
  // before the new API response arrives.
  assert.match(life,/const anniversaryLoadedKey=ref\(''\)/)
  assert.match(life,/anniversaryExpectedKey=computed\(\(\)=>props\.userId\+'\|'\+anniversaryRequestPath\(\)\)/)
  assert.match(life,/anniversaryRowsReady=computed\(\(\)=>anniversaryLoadedKey\.value===anniversaryExpectedKey\.value\)/)
  assert.match(life,/if\(!anniversaryRowsReady\.value\)return \[\]/)
  assert.match(life,/const path=anniversaryRequestPath\(\)/)
  assert.match(life,/loadedKey!==anniversaryExpectedKey\.value\)return/)
  assert.match(life,/anniversaryLoadedKey\.value=loadedKey/)
  assert.match(life,/v-for="e in upcomingAnniversaries"/)
})

test('loading or changing accounts cannot flash cached anniversary rows',()=>{
  assert.match(life,/if\(currentMode!=='family'\)anniversaryLoadedKey\.value=''/)
  assert.match(life,/watch\(\(\)=>\[props\.mode,props\.userId,props\.profileRevision,props\.syncRevision\],fetchMode/)
  assert.match(life,/v-if="!anniversaryRowsReady&&listLoading"/)
  assert.match(life,/v-else-if="anniversaryRowsReady&&!listLoading&&!error&&!upcomingAnniversaries\.length"/)
  assert.match(life,/anniversaryView==='past'&&anniversaryRowsReady&&listCursors\.anniversaries/)
})

test('refreshing the same anniversary view keeps visible rows until the new response',()=>{
  // Rendering is gated by the completed query key, *not* by the generic loading
  // boolean; sync refreshes of the active tab retain their existing list height.
  const block=life.slice(life.indexOf('const upcomingAnniversaries=computed'),life.indexOf('const visibleShopping=computed'))
  assert.match(block,/if\(!anniversaryRowsReady\.value\)return \[\]/)
  assert.doesNotMatch(block,/listLoading/)
})
