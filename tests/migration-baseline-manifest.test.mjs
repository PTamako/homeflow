import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('canonical historical migrations match ALL tracked .sql file names exactly once',()=>{
 const code=read('scripts/check_migrations.py')
 const block=code.split('MIGRATIONS=[')[1]?.split(']')[0]||''
 const names=[...block.matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
 const actual=readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql'))
 assert.equal(names.length,52)
 assert.equal(new Set(names).size,names.length)
 assert.deepEqual([...names].sort(),[...actual].sort())
 assert.deepEqual(names.filter(x=>x.startsWith('0009_')),
   ['0009_finance_target_settings.sql','0009_routine_pet_care.sql'])
})

test('CI does not automatically run non-idempotent migrations against deployed D1',()=>{
 const deploy=read('.github/workflows/deploy.yml')
 assert.doesNotMatch(deploy,/wrangler d1 migrations apply/)
 assert.doesNotMatch(deploy,/wrangler d1 execute .*--remote/)
 const docs=read('docs/d1-migration-baseline-2026-11-04.md')
 assert.match(docs,/migration names defined in/)
 assert.match(docs,/not replayed/i)
 assert.match(docs,/SELECT name, applied_at FROM d1_migrations/)
})
