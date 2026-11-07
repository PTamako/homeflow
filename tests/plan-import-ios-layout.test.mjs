import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('history filter has its own spacing below status tabs on mobile',()=>{
 assert.match(source,/\.plan-view-toolbar \.archive-toolbar>\.life-filter-trigger\s*\{[^}]*margin:12px 0 3px auto/s)
 assert.match(source,/<button v-if="planScope==='history'" type="button" class="life-filter-trigger"/)
})

test('trip import dropdown uses consistent iOS styling rather than native gray pill',()=>{
 const css=source.slice(source.indexOf('.life-form select,.trip-import select,.archive-date-filters select'))
 assert.match(css,/appearance:none;-webkit-appearance:none/)
 assert.match(css,/background-image:linear-gradient/)
 assert.match(css,/padding:10px 36px 10px 12px/)
 assert.match(source, /<select v-model="importTargetId" aria-label="选择导入旅行项目"/)
 assert.match(source,/\.trip-import\{padding:2px 0 0;margin-top:0;background:transparent\}/)
 assert.match(source,/v-model="paste" rows="4"/)
})
