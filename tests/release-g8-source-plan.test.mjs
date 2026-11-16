import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {checkG8SourcePlans,loadG8SourcePlans} from
 '../scripts/release-g8-source-plan.mjs';

const reviewed=existsSync('.contract-kakeibo/wrangler.toml')&&
 existsSync('.contract-study/wrangler.toml')&&
 existsSync('.contract-document/wrangler.jsonc');
function source(){return loadG8SourcePlans()}

test('G8 predeploy source check validates all five exact production config files',
 {skip:!reviewed},()=>{
 const result=checkG8SourcePlans(source());
 assert.equal(result.source_plan_ok,true,JSON.stringify(result.errors));
 assert.equal(result.production_deployment_authorized,false);
 assert.equal(result.production_G8_values_verified,false);
 assert.equal(result.checked_sources.length,5);
});
test('G8 prevents wrong service target or missing bridge, rather than inventing it',
 {skip:!reviewed},()=>{
 const raw=source();
 raw.homeflow=raw.homeflow.replace(
  'binding = "KAKEIBO_EXECUTION_SERVICE"\nservice = "kakeibo-homeflow-bridge"',
  'binding = "KAKEIBO_EXECUTION_SERVICE"\nservice = "jp-document-assistant"');
 raw['kakeibo-homeflow-bridge']=raw['kakeibo-homeflow-bridge'].replace(
  'service = "jp-document-assistant"',
  'service = "homeflow"');
 const result=checkG8SourcePlans(raw);
 assert.equal(result.source_plan_ok,false);
 assert.ok(result.errors.includes('source:homeflow:wrong_or_missing_service:KAKEIBO_EXECUTION_SERVICE'));
 assert.ok(result.errors.includes('source:kakeibo-homeflow-bridge:wrong_or_missing_service:DOCUMENT_FINANCE_SOURCE_SERVICE'));
});
test('G8 rejects wrong production D1, Preview URL and tampered callback list',
 {skip:!reviewed},()=>{
 const raw=source();
 raw.kakeibo=raw.kakeibo.replace(
  'database_id = "4d790915-fc06-4073-b660-bbb51dc74463"',
  'database_id = "00000000-0000-0000-0000-000000000000"');
 raw['jp-document-assistant']=raw['jp-document-assistant'].replace(
  '"preview_urls": false','"preview_urls": true');
 raw.homeflow=raw.homeflow.replace(
  'https://kakeibo-f17.pages.dev/api/homeflow-sso/callback',
  'https://unreviewed.example/callback');
 const errors=checkG8SourcePlans(raw).errors;
 assert.ok(errors.includes('source:kakeibo:wrong_production_D1'));
 assert.ok(errors.includes('source:jp-document-assistant:preview_urls_must_be_false'));
 assert.ok(errors.includes('source:homeflow:oauth_redirect_allowlist_mismatch'));
});
test('G8 refuses missing reviewed source files',()=>{
 const r=checkG8SourcePlans({});
 assert.equal(r.source_plan_ok,false);
 assert.equal(r.errors.filter(e=>e.includes(':missing_or_invalid')).length,5);
});
