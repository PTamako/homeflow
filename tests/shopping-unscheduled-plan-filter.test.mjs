import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {listFilters,listPage} from '../worker/list-pagination.js'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const session={household_id:'household-a',user_id:'user-a'}

function captureShopping(scope){
 const calls=[]
 const db={prepare(sql){
  return {sql,args:[],bind(...args){this.args=args;return this},
   async all(){calls.push({sql:this.sql,args:this.args});return {results:[]}}}
 }}
 return listPage(db,'shopping_items',session,listFilters('https://example.test/api/shopping?scope='+scope+'&limit=5'))
  .then(result=>({result,calls}))
}

test('shopping list uses the planned purchase date instead of the creator',()=>{
 const shopping=life.slice(life.indexOf('<template v-for="s in visibleShopping"'),
  life.indexOf('<p v-if="!visibleShopping.length'))
 assert.match(shopping, /<small class="shopping-plan-date">{{ s.due_on\?'计划日期：'\+s.due_on:'待安排' }}<\/small>/)
 assert.doesNotMatch(shopping, /发起人：{{ memberName\(s.created_by\) }}/)
 assert.match(shopping, /class="shopping-handler-row"/)
 assert.match(shopping, /class="shopping-more-trigger"/)
})

test('unscheduled tab fetches only one-time tasks plus undated shopping',()=>{
 assert.match(life, /if\(type==='unscheduled'\)return \['tasks','shopping'\]/)
 assert.match(life, /q.set\('scope',planType.value==='unscheduled'&&\['tasks','shopping'\].includes\(kind\)\?'unscheduled':planScope.value\)/)
 assert.match(life, /planType==='shopping'\|\|\(planType==='unscheduled'&&visibleShopping.length>0\)/)
 assert.match(life, /planType==='unscheduled'&&\(!visibleShopping.length\|\|visibleTaskRows.length>0\)/)
 assert.match(life, /if\(type==='unscheduled'\)planScope.value='active'/)
})

test('unscheduled shopping is filtered at SQL level before paging',async()=>{
 const {calls,result}=await captureShopping('unscheduled')
 assert.equal(calls.length,1)
 assert.deepEqual(result,{items:[],nextCursor:null})
 assert.match(calls[0].sql, /completed_at IS NULL/)
 assert.match(calls[0].sql, /\(due_on IS NULL OR due_on=''\)/)
 assert.match(calls[0].sql, /ORDER BY created_at DESC,id DESC/)
 assert.equal(calls[0].args.at(-1),6)
})

test('scheduled shopping remains in normal shopping tab but not unscheduled tab',async()=>{
 const a=(await captureShopping('active')).calls[0].sql
 const b=(await captureShopping('unscheduled')).calls[0].sql
 const history=(await captureShopping('history')).calls[0].sql
 assert.match(a,/completed_at IS NULL/)
 assert.doesNotMatch(a,/due_on IS NULL OR due_on=/)
 assert.match(b,/due_on IS NULL OR due_on=/)
 assert.match(history,/completed_at IS NOT NULL/)
 assert.doesNotMatch(history,/due_on IS NULL OR due_on=/)
})
