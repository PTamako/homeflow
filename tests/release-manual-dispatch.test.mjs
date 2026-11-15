import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// §111: merging HomeFlow #305 cannot publish a half-migrated OAuth/approval
// system before HomeFlow #306 and the three business apps are release-ready.
test('HomeFlow release cannot be triggered by a main push or an unconfirmed manual dispatch',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/^on:\s*\n\s+workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^\s+push\s*:/m);
 assert.match(workflow,/release_confirmation/);
 assert.match(workflow,/inputs\.release_confirmation == 'FOUR_APP_RELEASE_APPROVED'/);
 assert.match(workflow,/wrangler deploy/);
 assert.doesNotMatch(workflow,/preview_urls\s*:\s*true/i);
});
