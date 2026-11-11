import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {scheduledRunPhase} from '../worker/schedule-policy.js'

test('Production uses one hourly Cron trigger and no Preview deployment config',()=>{
 const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
 assert.match(toml,/crons\s*=\s*\["0 \* \* \* \*"\]/)
 assert.doesNotMatch(toml,/crons\s*=\s*\[[^\]]*,\s*"/)
 assert.doesNotMatch(toml,/\[env\.preview(?:\.|\])/)
 const make=hour=>({cron:'0 * * * *',scheduledTime:Date.UTC(2026,10,10,hour-9)})
 assert.equal(scheduledRunPhase(make(6)),'daily')
 assert.equal(scheduledRunPhase(make(8)),'catchup')
 assert.equal(scheduledRunPhase(make(10)),'catchup')
})
