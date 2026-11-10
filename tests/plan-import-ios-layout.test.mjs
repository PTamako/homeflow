import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')

test('history year and month selectors sit together below status tabs on mobile',()=>{
 assert.match(source,/\.plan-view-toolbar \.plan-history-date-filters\{margin:10px 0 4px\}/)
 assert.match(source,/<div v-if="planScope==='history'" class="archive-date-filters plan-history-date-filters"/)
 assert.match(source,/aria-label="历史记录年份"/)
 assert.match(source,/aria-label="历史记录月份"/)
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
