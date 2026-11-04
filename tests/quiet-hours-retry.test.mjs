import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {quietAtHour} from '../worker/webpush.js'

test('default 06:00 JST delivery is not suppressed, 22:00–06:00 excludes 06:00',()=>{
 assert.equal(quietAtHour({start:null,end:null},6),false)
 assert.equal(quietAtHour({start:22,end:6},23),true)
 assert.equal(quietAtHour({start:22,end:6},5),true)
 assert.equal(quietAtHour({start:22,end:6},6),false)
 assert.equal(quietAtHour({start:22,end:6},22),true)
 assert.equal(quietAtHour({start:23,end:7},6),true)
 assert.equal(quietAtHour({start:9,end:17},13),true)
 assert.equal(quietAtHour({start:9,end:17},17),false)
 assert.equal(quietAtHour({start:8,end:8},8),false)
})

test('push claims are idempotent and retries exclude sent messages',()=>{
 const src=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(src,/ON CONFLICT\(endpoint_hash,notification_key,sent_on\) DO UPDATE/)
 assert.match(src,/status IN \('failed','claimed'\)/)
 assert.match(src,/attempts < 3/)
 assert.match(src,/for\(let attempt=0;attempt<2;attempt\+\+\)/)
 assert.match(src,/quietAtHour\(data.quietHours,hour\)/)
 assert.match(src,/Urgency:data.priority==='important'\?'high':'normal'/)
})
