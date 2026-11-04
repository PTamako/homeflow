import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('HomeFlow production Worker allows secure public fetch to Pages ledger endpoint',()=>{
  const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
  const production=config.split(/^\[env\.preview\]/m)[0]
  assert.match(production,/^compatibility_flags\s*=\s*\["global_fetch_strictly_public"\]/m)
  assert.match(production,/^KAKEBO_LEDGER_API_URL\s*=\s*"https:\/\/kakeibo-f17\.pages\.dev\/api\/homeflow-ledger"/m)
  assert.doesNotMatch(production,/HOMEFLOW_LEDGER_READ_TOKEN\s*=/)
  assert.doesNotMatch(production,/KAKEBO_LEDGER_READ_TOKEN\s*=/)
})
