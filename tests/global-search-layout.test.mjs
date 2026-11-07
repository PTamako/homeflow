import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const component = readFileSync(new URL('../src/components/GlobalSearch.vue', import.meta.url), 'utf8')
const style = component.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1]
assert.ok(style, 'GlobalSearch should include scoped styles')

test('global search uses the shared mobile sheet instead of an anchored floating panel', () => {
  assert.match(component, /<EditBottomSheet v-if="open" title="全站搜索"/)
  assert.match(style, /\.search-panel\{position:static;width:100%;/)
  assert.doesNotMatch(style, /\.search-panel\{[^}]*right:-\d+px/)
})

test('search filters fit narrow phone screens without clipping', () => {
  assert.match(style, /grid-template-columns:minmax\(0,1\.2fr\) minmax\(0,1fr\) minmax\(0,\.75fr\)/)
  assert.match(style, /@media\(max-width:520px\)\{\.search-filters\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)
  assert.match(style, /\.search-filters select:first-child\{grid-column:1\/-1\}/)
})

test('long result titles wrap rather than overflow', () => {
  assert.match(style, /\.search-results button\{[^}]*overflow-wrap:anywhere;/)
})

test('closing search cancels and unlocks any in-flight query', () => {
 assert.match(component, /function cancelPending\(\)/)
 assert.match(component, /activeRequest\?\.abort\(\)/)
 assert.match(component, /busy\.value=false/)
 assert.match(component, /signal:controller\.signal/)
 assert.match(component, /function toggle\(\)\{open\.value=!open\.value;if\(!open\.value\)cancelPending\(\)/)
 assert.match(component, /if\(token===revision&&!controller\.signal\.aborted\)/)
})
