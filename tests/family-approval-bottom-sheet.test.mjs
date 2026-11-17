import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const feed=readFileSync(new URL('../src/components/FamilyApprovalFeed.vue',import.meta.url),'utf8')

test('household ledger detail action is right aligned beside the member/date summary',()=>{
 assert.match(feed,/<div class="feed-meta">\s*<p>\{\{description\(row\)\}\}<\/p>\s*<button v-if="isSharedLedger\(row\)"/)
 assert.match(feed,/class="feed-text-button feed-detail-trigger"/)
 assert.match(feed,/\.feed-meta\{display:flex;align-items:center;justify-content:space-between/)
 assert.match(feed,/\.feed-detail-trigger\{flex:none;white-space:nowrap;text-align:right/)
})

test('complete approval details open in the existing accessible iPhone bottom sheet',()=>{
 assert.match(feed,/const detailSheetRow=ref<Item\|null>\(null\)/)
 assert.match(feed,/detailSheetRow\.value=row/)
 assert.match(feed,/<EditBottomSheet v-if="detailSheetRow"/)
 assert.match(feed,/@close="detailSheetRow=null"/)
 assert.match(feed,/details\[detailSheetRow\.id\]\.before/)
 assert.match(feed,/details\[detailSheetRow\.id\]\.entry/)
 assert.match(feed,/@click="ensureDetail\(detailSheetRow\)"/)
 assert.doesNotMatch(feed,/detailExpanded|toggleDetail\(/)
})

test('unreadable sealed household ledger detail still blocks approval',()=>{
 assert.match(feed,/if\(isSharedLedger\(row\)&&\['approve','reject'\]\.includes\(decision\)\)/)
 assert.match(feed,/const ready=await ensureDetail\(row\)/)
 assert.match(feed,/\!details\[row\.id\]/)
})
