import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {generateVapidPair} from '../public/vapid-crypto.mjs'
test('iPhone-only VAPID generator emits a valid, unique P-256 pair without any server calls', async()=>{
  const first=await generateVapidPair(webcrypto)
  const second=await generateVapidPair(webcrypto)
  assert.match(first.publicKey,/^[A-Za-z0-9_-]{87}$/)
  assert.notEqual(first.publicKey,second.publicKey)
  const jwk=JSON.parse(first.privateJwk)
  assert.equal(jwk.kty,'EC')
  assert.equal(jwk.crv,'P-256')
  assert.equal(jwk.ext,true)
  assert.ok(jwk.d && jwk.x && jwk.y)
  const pub=await webcrypto.subtle.importKey('raw',Buffer.from(first.publicKey,'base64url'),
    {name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  const prv=await webcrypto.subtle.importKey('jwk',jwk,
    {name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const message=new TextEncoder().encode('HomeFlow notification test')
  const sig=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},prv,message)
  assert.equal(await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,sig,message),true)
})
