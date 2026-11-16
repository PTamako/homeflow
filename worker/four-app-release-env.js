// Cloudflare Workers Free caps secrets + plain-text variables at 64.
// Keep 33 independently scoped HMAC keys INSIDE ONE encrypted secret binding.
// Only trusted server code can unpack it; no client API ever returns the bundle.
export const REQUIRED_FINANCE_SECRETS=Object.freeze([
  "APPROVAL_VERIFICATION_SECRET",
  "BANK_TRANSFER_APPROVAL_PROOF_SECRET",
  "BANK_TRANSFER_EXECUTION_SECRET",
  "BANK_TRANSFER_SUBMISSION_SECRET",
  "CARD_APPROVAL_PROOF_SECRET",
  "CARD_EXECUTION_SECRET",
  "CARD_SETTLEMENT_APPROVAL_PROOF_SECRET",
  "CARD_SETTLEMENT_EXECUTION_SECRET",
  "CARD_SETTLEMENT_SUBMISSION_SECRET",
  "CARD_SUBMISSION_SECRET",
  "CROSS_MEMBER_TRANSFER_PROOF_SECRET",
  "DOCUMENT_APPROVAL_SUBMISSION_SECRET",
  "DOCUMENT_APPROVAL_VERIFICATION_SECRET",
  "DOCUMENT_EXECUTION_SECRET",
  "DOCUMENT_STUDY_EXECUTION_SECRET",
  "POINTS_APPROVAL_PROOF_SECRET",
  "POINTS_EXECUTION_SECRET",
  "POINTS_SUBMISSION_SECRET",
  "PREPAID_APPROVAL_PROOF_SECRET",
  "PREPAID_EXECUTION_SECRET",
  "PREPAID_SUBMISSION_SECRET",
  "RECURRING_FINANCE_EXECUTION_PROOF_SECRET",
  "RECURRING_FINANCE_EXECUTION_RECORD_SECRET",
  "RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET",
  "RECURRING_FINANCE_POLICY_SUBMISSION_SECRET",
  "RECURRING_FINANCE_RESERVATION_SECRET",
  "SBI_CASH_APPROVAL_PROOF_SECRET",
  "SBI_CASH_EXECUTION_SECRET",
  "SBI_CASH_SUBMISSION_SECRET",
  "SHARED_ENTRY_APPROVAL_PROOF_SECRET",
  "SHARED_ENTRY_EXECUTION_SECRET",
  "SHARED_ENTRY_SUBMISSION_SECRET",
  "STUDY_APPROVAL_VERIFICATION_SECRET"
]);
export function withFourAppFinanceEnv(env){
 const raw=env?.FOUR_APP_FINANCE_SECRET_BUNDLE;
 if(raw===undefined)return env; // Legacy development, no new finance credentials.
 if(typeof raw!=='string'||raw.length>8000)
  throw Error('FOUR_APP_FINANCE_SECRET_BUNDLE_INVALID');
 let payload;
 try{payload=JSON.parse(raw)}catch{throw Error('FOUR_APP_FINANCE_SECRET_BUNDLE_INVALID')}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
  Object.keys(payload).length!==REQUIRED_FINANCE_SECRETS.length)
  throw Error('FOUR_APP_FINANCE_SECRET_BUNDLE_INCOMPLETE');
 for(const key of REQUIRED_FINANCE_SECRETS)
  if(!Object.hasOwn(payload,key)||typeof payload[key]!=='string'||
   !/^[a-f0-9]{64}$/.test(payload[key]))
   throw Error('FOUR_APP_FINANCE_SECRET_BUNDLE_INVALID');
 if(Object.keys(payload).some(k=>!REQUIRED_FINANCE_SECRETS.includes(k)))
  throw Error('FOUR_APP_FINANCE_SECRET_BUNDLE_UNEXPECTED_KEY');
 // Important: immutable original Cloudflare bindings (DB, MEDIA, old auth secrets)
 // remain on the runtime env object. Finance key overrides are request-local.
 return Object.assign(Object.create(env),payload);
}
