import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const code=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
const notify=readFileSync(new URL('../worker/notifications.js',import.meta.url),'utf8')

test('hourly delivery batch advances past the first 20 while protecting free-tier use',()=>{
 assert.doesNotMatch(code,/events=\(data\.items\|\|\[\]\)[\s\S]*?\.slice\(0,20\)/)
 assert.match(code,/let attemptsForDevice=0/)
 assert.match(code,/if\(attemptsForDevice>=20\)break/)
 assert.match(code,/if\(!claim\.meta\?\.changes\)continue\s+attemptsForDevice\+\+/)
 assert.doesNotMatch(code,/scheduledData\.items\.slice\(0,100\)/)
 assert.match(notify,/LIMIT 1000/)
})
