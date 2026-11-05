import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const component = readFileSync(new URL('../src/components/GlobalSearch.vue', import.meta.url), 'utf8')
const style = component.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1]
assert.ok(style, 'GlobalSearch should include scoped styles')

test('global search stays anchored inside the viewport', () => {
  assert.match(style, /\.search-panel\{[^}]*right:0;/)
  assert.match(style, /width:min\(355px,calc\(100vw - 32px\)\)/)
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
