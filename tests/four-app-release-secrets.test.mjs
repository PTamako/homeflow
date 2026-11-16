import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReleaseSecrets,CONTRACT_PAIRS} from '../scripts/four-app-release-secrets.mjs';
test('all required production secrets are mapped without rotating legacy keys',()=>{
 let n=0;const x=buildReleaseSecrets(()=>String((++n)%10).repeat(64));
 assert.equal(CONTRACT_PAIRS.length,n);
 assert.equal('SESSION_HMAC_KEY' in x.D,false);
 assert.equal('KAKEIBO_SSO_ENCRYPTION_KEY' in x.P,false);
 for(const pair of CONTRACT_PAIRS){
  const values=pair.map(item=>{const [group,name]=item.split('.');return x[group][name]});
  assert.ok(values.every(v=>v===values[0]));
  assert.match(values[0],/^[a-f0-9]{64}$/);
 }
 assert.notEqual(x.H.BANK_TRANSFER_EXECUTION_SECRET,x.H.BANK_TRANSFER_SUBMISSION_SECRET);
});
test('rejects weak release keys before attempting any Cloudflare changes',()=>{
 assert.throws(()=>buildReleaseSecrets(()=>'weak'),/CRYPTOGRAPHIC_KEY_INVALID/);
});
