import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('production push runs at 06:00 and 08:00 JST, Preview disabled',()=>{
  const toml=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
  const prod=toml.split('[env.preview]')[0]
  assert.match(prod,/crons\s*=\s*\["0 21 \* \* \*", "0 23 \* \* \*"\]/)
  assert.match(toml,/\[env.preview.triggers\]\s*crons\s*=\s*\[\]/)
  const utc=new Date('2026-11-04T21:00:00Z')
  assert.equal(new Date(utc.getTime()+9*3600000).toISOString().slice(11,16),'06:00')
  assert.equal(new Date(utc.getTime()+9*3600000).toISOString().slice(0,10),'2026-11-05')
  const retry=new Date('2026-11-04T23:00:00Z')
  assert.equal(new Date(retry.getTime()+9*3600000).toISOString().slice(11,16),'08:00')
})
