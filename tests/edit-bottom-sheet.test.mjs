import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=(file)=>readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8')

test('all main record editors use one accessible bottom sheet',()=>{
 const sheet=source('EditBottomSheet.vue')
 assert.match(sheet,/<Teleport to="body">/)
 assert.match(sheet,/role="dialog" aria-modal="true"/)
 assert.match(sheet,/:aria-labelledby="titleId"/)
 assert.match(sheet,/@keydown="onKeydown"/)
 assert.match(sheet,/safe-area-inset-bottom/)
 assert.match(sheet,/document\.body\.style\.overflow='hidden'/)
 for(const file of ['LifeItemEditor.vue','ProfileEditor.vue','ReminderItemEditor.vue','PetHealthPanel.vue']){
  assert.match(source(file),/<EditBottomSheet[\s>]/,file+' editor')
 }
 assert.match(source('HouseholdPoints.vue'),/<EditBottomSheet v-if="formOpen"/)
 const life=source('LifePanel.vue')
 assert.match(life,/<EditBottomSheet v-if="onceEditing\?\.id===t\.id"/)
})

test('points store uses unified line icons for actions and no permanent pooling instructions',()=>{
 const board=source('HouseholdPoints.vue')
 const icons=source('AppIcon.vue')
 assert.match(board,/<AppIcon name="handshake"/)
 assert.match(board,/<AppIcon name="gift"/)
 assert.match(board,/<AppIcon name="award"/)
 assert.match(icons,/<template v-else-if="name==='handshake'">/)
 assert.doesNotMatch(board,/>🤝 合力/)
 assert.doesNotMatch(board,/“合力”允许双方自由分摊积分/)
 assert.match(board,/<EditBottomSheet v-if="formOpen"/)
})
