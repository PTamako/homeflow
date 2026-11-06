import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {listFilters,listPage} from '../worker/list-pagination.js'

const session={household_id:'household-a',user_id:'user-a'}
function capturePage(){
 const executed=[]
 const db={prepare(sql){
  const query={sql,args:[],bind(...args){this.args=args;return this},async all(){executed.push({sql:this.sql,args:this.args});return {results:[]}}}
  return query
 }}
 return {db,executed}
}
async function shoppingList(scope){
 const {db,executed}=capturePage()
 const filters=listFilters('https://homeflow.example/api/shopping?limit=5&scope='+scope)
 const page=await listPage(db,'shopping_items',session,filters)
 assert.deepEqual(page,{items:[],nextCursor:null})
 assert.equal(executed.length,1)
 return executed[0]
}

test('shopping active never includes items completed earlier today',async()=>{
 const {sql,args}=await shoppingList('active')
 assert.match(sql,/completed_at IS NULL/)
 assert.doesNotMatch(sql,/completed_at>=|completed_at IS NOT NULL/)
 assert.ok(sql.includes("ORDER BY COALESCE(due_on,'9999-12-31') ASC,id ASC"))
 assert.equal(args.at(-1),6) // fetch one extra row for a five-item page
})
test('shopping history includes completed items immediately, including today',async()=>{
 const {sql,args}=await shoppingList('history')
 assert.match(sql,/completed_at IS NOT NULL/)
 assert.doesNotMatch(sql,/completed_at<|completed_at IS NULL/)
 assert.match(sql,/ORDER BY completed_at DESC,id DESC/)
 assert.equal(args.at(-1),6)
})
test('linking or unlinking a receipt reclassifies the local shopping list without a full dashboard refresh',()=>{
 const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const handler=source.split('async function shoppingLinksChanged(){')[1].split('async function removeItem(')[0]
 assert.match(handler,/const completed=!!data\.item\.completed_at/)
 assert.match(handler,/const belongsHere=scope==='history'\?completed:!completed/)
 assert.match(handler,/other\.value=other\.value\.filter\(x=>x\.id!==id\)/)
 assert.match(handler,/const page=await api\(path\)/)
 assert.match(handler,/assignRows\('shopping',page\.items\|\|\[\]\)/)
 assert.match(handler,/listCursors\.value\.shopping=page\.nextCursor\|\|null/)
})
test('opening a finished shopping item from Today selects the history tab',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(app,/focusPlanScope\.value=done&&\([^\n]*kind==='shopping'/)
})
