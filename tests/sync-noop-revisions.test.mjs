import test from 'node:test'
import assert from 'node:assert/strict'
import {personalMutation,mutationChangesState} from '../worker/sync.js'
import {readFileSync} from 'node:fs'

test('read-all notifications are personal, not a household-wide refresh',()=>{
 assert.equal(personalMutation('/api/notifications/today/read-all'),true)
 assert.equal(personalMutation('/api/notifications/00000000-0000-4000-8000-000000000001/read'),true)
 assert.equal(personalMutation('/api/lottery/draw'),false)
})
test('replayed and unchanged mutations never advance revision',()=>{
 for(const result of [{ok:true,replayed:true},{ok:true,unchanged:true},
  {ok:true,reused:true},{ok:true,readOnly:true},{ok:true,changed:false}]){
  assert.equal(mutationChangesState('/api/lottery/draw',result),false)
 }
 assert.equal(mutationChangesState('/api/notifications/today/read-all',{markedCount:0}),false)
 assert.equal(mutationChangesState('/api/notifications/today/read-all',{markedCount:8}),true)
 assert.equal(mutationChangesState('/api/portable/restore',{inserted:0}),false)
 assert.equal(mutationChangesState('/api/portable/restore',{inserted:3}),true)
 assert.equal(mutationChangesState('/api/recycle/empty',{deleted:0}),false)
 assert.equal(mutationChangesState('/api/recycle/empty',{deleted:3}),true)
 assert.equal(mutationChangesState('/api/push/send-now',{sent:1}),false)
 assert.equal(mutationChangesState('/api/tasks',{ok:true,id:'task'}),true)
})
test('router consults the mutation outcome before shared and member revision writes',()=>{
 const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 assert.match(source,/response\.clone\(\)\.json\(\)/)
 assert.match(source,/if\(mutationChangesState\(path,outcome\)\)/)
 assert.match(source,/result\.newInboxRows>0\?bumpHouseholdRevision/)
})
