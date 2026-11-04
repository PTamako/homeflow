import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('production daily push Cron is 06:00 JST (21:00 UTC), Preview disabled',()=>{
  const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
  const prod=toml.split('[env.preview]')[0]
  assert.match(prod,/crons\s*=\s*\["0 21 \* \* \*"\]/)
  assert.match(toml,/\[env.preview.triggers\]\s*crons\s*=\s*\[\]/)
  const utc=new Date('2026-11-04T21:00:00Z')
  assert.equal(new Date(utc.getTime()+9*3600000).toISOString().slice(11,16),'06:00')
  assert.equal(new Date(utc.getTime()+9*3600000).toISOString().slice(0,10),'2026-11-05')
})
