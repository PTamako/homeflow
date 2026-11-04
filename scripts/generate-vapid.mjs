// Run locally: node scripts/generate-vapid.mjs
// Never commit the output or paste private keys into issues / chat.
import { webcrypto } from 'node:crypto'
const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
const jwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey)
const raw=new Uint8Array(await webcrypto.subtle.exportKey('raw',pair.publicKey))
const publicKey=Buffer.from(raw).toString('base64url')
process.stdout.write('VAPID_PUBLIC_KEY='+publicKey+'\n')
process.stdout.write('VAPID_PRIVATE_JWK='+JSON.stringify(jwk)+'\n')
process.stdout.write('Save both values as encrypted Worker Secrets. Keep VAPID_PRIVATE_JWK private.\n')
