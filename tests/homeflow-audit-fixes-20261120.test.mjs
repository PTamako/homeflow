import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {readBody} from '../worker/security.js'
import {pushEventsForHour} from '../worker/webpush.js'

const ui=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')

test('bill and prepaid alerts both offer a direct Kakeibo action without disrupting card styles',()=>{
 assert.match(ui,/v-if="isPrepaidAlert\(item\)\|\|isKakeiboBill\(item\)\|\|/)
 assert.match(ui,/if\(isPrepaidAlert\(item\)\|\|isKakeiboBill\(item\)\)\{\s*window\.open\('https:\/\/kakeibo-f17\.pages\.dev\//)
 assert.match(ui,/\(isPrepaidAlert\(item\)\|\|isKakeiboBill\(item\)\)\?'打开记账本'/)
 assert.match(ui,/window\.open\('https:\/\/kakeibo-f17\.pages\.dev\/','_blank','noopener,noreferrer'\)\s*if\(view\.value==='received'\)await markRead\(item\)/)
 assert.match(ui,/m\[2\]==='下限'\?'达到或低于下限 '/)
 assert.match(ui,/\.notice-item\.notice-item--ledger\{[^}]*background:#fff/s)
 assert.match(ui,/\.notice-item--ledger-alert \.notice-ledger-badge\{background:#f8dedb/)
})

test('each member quiet window suppresses every scheduled OS push, including year-end expiry',()=>{
 const events=[{id:'annual-points-expiry'},{id:'regular-task'}]
 assert.deepEqual(pushEventsForHour(events,{start:22,end:8},6),[])
 assert.deepEqual(pushEventsForHour(events,{start:22,end:8},8),events)
 assert.deepEqual(pushEventsForHour(events,{start:22,end:6},6),events)
 assert.deepEqual(pushEventsForHour(events,{start:null,end:null},6),events)
 const source=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(source,/const events=pushEventsForHour\(data\.items,data\.quietHours,hour\)/)
 assert.doesNotMatch(source,/event\.id==='annual-points-expiry'\)/)
})

test('JSON body reader caps stream bytes even without Content-Length',async()=>{
 const payload={message:'a'.repeat(500)}
 const request=new Request('https://homeflow.invalid/api/tasks',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
 })
 assert.deepEqual(await readBody(request),payload)
 let cancelled=false
 const body=new ReadableStream({
  pull(controller){controller.enqueue(new Uint8Array(16001))},
  cancel(){cancelled=true}
 })
 const oversized=new Request('https://homeflow.invalid/api/tasks',{
  method:'POST',body,duplex:'half'
 })
 assert.equal(oversized.headers.get('content-length'),null)
 assert.equal(await readBody(oversized),null)
 assert.equal(cancelled,true)
})

test('JSON reader rejects oversized declarations and malformed input, preserving Unicode',async()=>{
 const endpoint='https://homeflow.invalid/api/tasks'
 const overDeclared=new Request(endpoint,{method:'POST',headers:{'content-length':'20000'},body:'{}'})
 assert.equal(await readBody(overDeclared),null)
 const array=new Request(endpoint,{method:'POST',body:'[1,2]'})
 assert.equal(await readBody(array),null)
 const invalid=new Request(endpoint,{method:'POST',body:new Uint8Array([0xc3,0x28])})
 assert.equal(await readBody(invalid),null)
 const unicode={title:'豆沙',body:'今天確認'}
 const valid=new Request(endpoint,{method:'POST',body:JSON.stringify(unicode)})
 assert.deepEqual(await readBody(valid),unicode)
})
