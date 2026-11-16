import test from 'node:test';
import assert from 'node:assert/strict';
import {MIGRATION_PLANS} from '../scripts/release-d1-migration-inventory.mjs';
import {ids,paths} from '../scripts/four-app-release-apply-migrations.mjs';
import {readFileSync} from 'node:fs';

test('every reviewed Stage F database key maps to exact production D1 ID and source tree',()=>{
 const dbs=MIGRATION_PLANS.map(p=>p.db).sort();
 assert.deepEqual(Object.keys(ids).sort(),dbs);
 assert.deepEqual(Object.keys(paths).sort(),dbs);
 const k=MIGRATION_PLANS.find(p=>p.repo==='kakebo_jp');
 assert.equal(k.db,'kakebo');
 assert.equal(ids[k.db],'4d790915-fc06-4073-b660-bbb51dc74463');
 assert.equal(paths[k.db],'.contract-kakeibo');
 assert.equal(k.files.length,40);
 assert.equal(k.files[0],'0020_recurring_multi_schedule.sql');
 assert.equal(k.files[1],'0021_sbi_transfer_purpose.sql');
});

test('remote Wrangler D1 migration command does not use unsupported --yes',()=>{
 const code=readFileSync(new URL('../scripts/four-app-release-apply-migrations.mjs',import.meta.url),'utf8');
 assert.ok(code.includes("'migrations','apply',database,'--remote','--config',config"));
 assert.ok(!code.includes("'--remote','--yes'"));
});
