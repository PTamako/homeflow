import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Production releases are explicit only; no automatic Preview or main push deploys.
test('HomeFlow production release requires explicit confirmation; main push is forbidden',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/^on:/m);
 assert.match(workflow,/^\s+workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^\s+push\s*:/m);
 assert.match(workflow,/release_confirmation/);
 assert.match(workflow,/inputs\.release_confirmation == 'FOUR_APP_RELEASE_APPROVED'/);
 assert.match(workflow,/wrangler deploy/);
 assert.doesNotMatch(workflow,/preview_urls\s*:\s*true/i);
});

test('production deployment fails rather than reporting success when Cloudflare credentials are missing',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8')
 const wrangler=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
 assert.match(workflow,/Require production deployment credentials \(fail closed\)/)
 assert.match(workflow,/Cloudflare production credentials missing; deployment aborted/)
 assert.doesNotMatch(workflow,/Deployment skipped until Cloudflare repository secrets/)
 assert.doesNotMatch(workflow,/if:.*env.CLOUDFLARE_API_TOKEN != ''/)
 assert.match(workflow,/Reject stale cross-app main heads before production deploy/)
 assert.match(wrangler,/^preview_urls = false$/m)
})
