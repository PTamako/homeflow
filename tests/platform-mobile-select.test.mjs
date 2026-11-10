import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {filterMobileSelectOptions,normalizeMobileSelectSearch,shouldSearchMobileSelect}
 from '../src/mobile-select-options.mjs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const host=read('src/components/MobileSelectHost.vue')
const app=read('src/App.vue')

test('mobile local search matches Japanese, Chinese and fullwidth characters',()=>{
 const rows=[
  {index:0,value:'a',label:'家庭共享',group:'隐私设置',disabled:false},
  {index:1,value:'b',label:'今年全年',group:'年份',disabled:false},
  {index:2,value:'c',label:'２０２６年１１月',group:'年月',disabled:false},
  {index:3,value:'d',label:'東京',group:'場所',disabled:true}
 ]
 assert.equal(normalizeMobileSelectSearch(' ２０２６ 年 '),'2026 年')
 assert.deepEqual(filterMobileSelectOptions(rows,'2026 11').map(x=>x.value),['c'])
 assert.deepEqual(filterMobileSelectOptions(rows,' 年份 ').map(x=>x.value),['b'])
 assert.deepEqual(filterMobileSelectOptions(rows,'東京').map(x=>x.value),['d'])
 assert.deepEqual(filterMobileSelectOptions(rows,'没找到'),[])
 assert.equal(filterMobileSelectOptions(rows,'').length,4)
 assert.equal(shouldSearchMobileSelect(rows),false)
 assert.equal(shouldSearchMobileSelect([...rows,...rows]),true)
 assert.equal(shouldSearchMobileSelect(rows,true),true)
})

test('global mobile select host covers all tabs, dialogs and forms',()=>{
 assert.match(app,/import MobileSelectHost from '\.\/components\/MobileSelectHost.vue'/)
 assert.match(app,/<MobileSelectHost\/>/)
 assert.match(host,/document\.addEventListener\('pointerdown',onPointerDown,true\)/)
 assert.match(host,/document\.addEventListener\('click',onClick,true\)/)
 assert.match(host,/document\.addEventListener\('keydown',onKeydown,true\)/)
 assert.match(host,/document\.removeEventListener\('pointerdown',onPointerDown,true\)/)
 const components=readdirSync(new URL('../src/components/',import.meta.url))
  .filter(x=>x.endsWith('.vue'))
 const count=components.reduce((sum,file)=>sum+(read('src/components/'+file).match(/<select\b/g)||[]).length,0)
 assert.ok(count>=65,'expected global upgrade to cover 65+ native selects, found '+count)
})

test('native form value semantics, disabled fields and desktop mouse remain unchanged',()=>{
 assert.match(host,/!select\.disabled&&!select\.multiple&&/)
 assert.match(host,/select\.size<=1&&select\.options\.length>0/)
 assert.match(host,/!select\.hasAttribute\('data-native-select'\)/)
 assert.match(host,/if\(event\.pointerType==='mouse'\)return/)
 assert.match(host,/select\.value=option\.value/)
 assert.match(host,/select\.dispatchEvent\(new Event\('input',\{bubbles:true\}\)\)/)
 assert.match(host,/select\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/)
 assert.match(host,/if\(select\.value===option\.value\)return/)
 assert.match(host,/if\(!select\|\|option\.disabled\|\|!select\.isConnected\|\|select\.disabled\)/)
 assert.match(host,/const group=option\.parentElement instanceof HTMLOptGroupElement/)
 assert.match(host,/class="mobile-select-option"/)
 assert.match(host,/:aria-selected="item\.value===chosen"/)
 assert.match(host,/role="listbox"/)
 assert.match(host,/v-if="searchable"/)
 assert.match(host,/class="mobile-select-empty"/)
 assert.match(host,/matchMedia\('\(pointer: coarse\)'\)/)
})
