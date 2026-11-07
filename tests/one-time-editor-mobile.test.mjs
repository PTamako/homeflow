import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const editor=source.slice(source.indexOf('<EditBottomSheet v-if="onceEditing?.id===t.id"'),
  source.indexOf('<p v-if="!routines.length',source.indexOf('<EditBottomSheet v-if="onceEditing?.id===t.id"')))

test('one-time editor has its own scoped mobile styles and vertically stacked fields',()=>{
 assert.match(editor,/class="detail-editor once-task-editor"/)
 assert.match(editor,/class="once-edit-field"/)
 assert.match(editor,/<span>任务名称<\/span>/)
 assert.match(editor,/<span>截止日期<\/span>/)
 assert.match(editor,/class="once-edit-remind"/)
 assert.match(editor,/class="detail-actions once-edit-actions"/)
 assert.match(source,/\.once-task-editor\{\s*display:grid;grid-template-columns:minmax\(0,1fr\)/)
 assert.match(source,/\.once-task-editor \.once-edit-field>select\{white-space:nowrap;overflow:hidden\}/)
 assert.match(source,/\.once-task-editor \.once-edit-field :deep\(\.date-field\)/)
 assert.match(source,/\.once-task-editor \.once-edit-actions\{\s*display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(source,/\.once-task-editor \.once-edit-field>input,[\s\S]*?font-size:16px;/)
})
test('one-time card breaks task members into readable wrapped lines',()=>{
 assert.match(source,/class="once-task-identity"/)
 assert.match(source,/\.once-task-identity\{display:flex!important;flex-wrap:wrap/)
 assert.match(editor,/v-model="onceAssignee"/)
 assert.match(editor,/v-model="onceVisibility"/)
 assert.match(editor,/\{\{ memberName\(member.id\) \}\}/)
})
