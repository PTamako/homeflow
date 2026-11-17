import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The current four-app contract heads have passed CI, and this one reviewed
// release permits one exactly named main-push deployment (never arbitrary pushes).
test('HomeFlow release requires either explicit confirmation or exactly named one-time ledger-only merge',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/^on:/m);
 assert.match(workflow,/^\s+workflow_dispatch:/m);
 assert.match(workflow,/^\s+push\s*:/m);
 assert.match(workflow,/github\.event_name == 'push' && startsWith\(github\.event\.head_commit\.message, 'fix\(approvals\): ledger-only release'\)/);
 assert.match(workflow,/branches:\s*\[main\]/);
 assert.doesNotMatch(workflow,/github\.event_name == 'push'\s*\}\}/);
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
