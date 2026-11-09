import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const management=readFileSync(new URL('../src/components/ManagePage.vue',import.meta.url),'utf8')
const points=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')

test('installed PWA can navigate to a genuinely new HTML document',()=>{
  const refresh=app.match(/function refreshToLatest\(\)\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(refresh)
  assert.ok(refresh.includes('window.confirm('),'protect unsaved data from accidental reload')
  assert.ok(refresh.includes("target.searchParams.set('_hf_refresh',String(Date.now()))"))
  assert.ok(refresh.includes('window.location.replace(target.pathname+target.search+target.hash)'))
  assert.ok(!refresh.includes('window.location.reload()'))
  // Keep the automatic new-version banner as the only refresh action.
  assert.ok(app.includes('v-if="updateReady" class="app-update-banner"'))
  assert.ok(app.includes('@click="refreshToLatest">刷新</button>'))
  assert.ok(!app.includes('@refresh-app="refreshToLatest"'))
})

test('management footer keeps only sign out, without a redundant manual refresh button',()=>{
  assert.ok(!management.includes('refreshApp:[]'))
  assert.ok(!management.includes('class="management-refresh"'))
  assert.ok(!management.includes("emit('refreshApp')"))
  assert.ok(!management.includes('刷新到最新版'))
  assert.match(management,/class="management-app-actions"[\s\S]*?class="management-logout" @click="emit\('logout'\)"/)
  assert.match(management,/\.management-app-actions>button\{flex:1 1 0;/)
})

test('lottery stays a game card and the single point ledger owns historical records',()=>{
 assert.ok(points.includes('class="lottery-card"'))
 assert.ok(points.includes('class="lottery-box"'))
 assert.ok(!points.includes('近一年抽奖明细'))
 assert.ok(!points.includes('class="lottery-history-row"'))
 assert.ok(points.includes('v-for="(entry,i) in visibleHistoryEntries"'))
 assert.ok(points.includes('<option value="lottery">抽奖</option>'))
})
