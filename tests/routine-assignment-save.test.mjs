import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseRoutineAssignmentBonus} from '../src/routine-assignment-validation.mjs'

test('numeric v-model value does not throw when saving another member assignment',()=>{
 assert.deepEqual(parseRoutineAssignmentBonus(5,true),{valid:true,bonus:5})
 assert.deepEqual(parseRoutineAssignmentBonus('5',true),{valid:true,bonus:5})
 assert.deepEqual(parseRoutineAssignmentBonus(' 5 ',true),{valid:true,bonus:5})
})

test('required bonuses must be positive integers up to 10000',()=>{
 for(const value of ['',null,undefined,0,'0',-1,1.5,'1.5','abc','10001',10001,Infinity]){
  assert.equal(parseRoutineAssignmentBonus(value,true).valid,false,String(value))
 }
 assert.deepEqual(parseRoutineAssignmentBonus(10000,true),{valid:true,bonus:10000})
})

test('unassigned and self-assigned periods never reserve bonuses',()=>{
 assert.deepEqual(parseRoutineAssignmentBonus('',false),{valid:true,bonus:0})
 assert.deepEqual(parseRoutineAssignmentBonus(99,false),{valid:true,bonus:0})
})

test('period assignment uses explicit tap handler and numeric-safe parsing',()=>{
 const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(source,/parseRoutineAssignmentBonus\(routineAssignBonus\.value,other\)/)
 assert.doesNotMatch(source,/routineAssignBonus\.value\.trim\(\)/)
 assert.match(source,/@click\.stop="saveRoutineAssignment"/)
})
