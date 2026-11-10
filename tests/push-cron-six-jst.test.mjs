import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {scheduledRunPhase} from '../worker/schedule-policy.js'

test('Production uses only one hourly Cron trigger, Preview has none',()=>{
 const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
 const prod=toml.split('[env.preview]')[0]
 assert.match(prod,/crons\s*=\s*\["0 \* \* \* \*"\]/)
 assert.doesNotMatch(prod,/crons\s*=\s*\[[^\]]*,\s*"/)
 assert.match(toml,/\[env.preview.triggers\]\s*crons\s*=\s*\[\]/)
 const make=hour=>({cron:'0 * * * *',scheduledTime:Date.UTC(2026,10,10,hour-9)})
 assert.equal(scheduledRunPhase(make(6)),'daily')
 assert.equal(scheduledRunPhase(make(8)),'catchup')
 assert.equal(scheduledRunPhase(make(10)),'catchup')
})
