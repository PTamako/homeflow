import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { documentAssistantBridge } from '../worker/document-assistant-bridge.js'
if (!globalThis.crypto) globalThis.crypto = webcrypto

const secret = 'fixture_bridge_secret_with_40_randomish_chars_12345'
const actor = 'family_actor_123'
const id = 'jda:homeflow:1234567890abcdef'
const url = 'https://homeflow.example.test/api/bridge/document-assistant'
const body = (overrides={}) => ({
  source:'jp-document-assistant', actor_user_id:actor,
  idempotency_key:id,
  payload:{operation:'task', title:'安全测试任务', dueOn:'2026-12-01',
    visibility:'household', assignee:'another_user_456', bonusPoints:0,
    remindEnabled:true, ...overrides},
})
const env = (overrides={}) => ({
  JPDA_BRIDGE_ENABLED:'true', JPDA_BRIDGE_SECRET:secret,
  JPDA_BRIDGE_ALLOWED_USERS:actor,
  DB:{prepare(){return {bind(){return {first:async()=>({household_id:'h1',user_id:actor})}}}}},
  ...overrides,
})
async function signed(payload=body(), stamp=Date.now()) {
  const raw=JSON.stringify(payload),time=String(stamp)
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign'])
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+'\n'+raw)))
  const hex=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('')
  return new Request(url,{method:'POST',headers:{
    'X-DA-Timestamp':time,'X-DA-Signature':hex,'Idempotency-Key':id,
    'Content-Type':'application/json'
  },body:raw})
}
test('document assistant bridge is disabled unless explicitly opted in',async()=>{
  const r=await documentAssistantBridge(new Request(url,{method:'POST'}),env({JPDA_BRIDGE_ENABLED:'false'}))
  assert.equal(r.status,404)
})
test('rejects expired signatures and signatures over a different body',async()=>{
  assert.equal((await documentAssistantBridge(await signed(body(),Date.now()-400000),env())).status,401)
  const r=await signed()
  const tampered=new Request(url,{method:'POST',headers:r.headers,body:JSON.stringify(body({title:'篡改标题'}))})
  assert.equal((await documentAssistantBridge(tampered,env())).status,401)
})
test('valid signed request cannot impersonate an unapproved member',async()=>{
  const r=await documentAssistantBridge(await signed(),env({JPDA_BRIDGE_ALLOWED_USERS:'different_user'}))
  assert.equal(r.status,403)
})
test('assignment to a different member requires explicitly funded bonus',async()=>{
  const denied=await documentAssistantBridge(await signed(),env())
  assert.equal(denied.status,422)
  assert.equal((await denied.json()).error,'other_assignee_requires_confirmed_bonus')
  const ownBonus=await documentAssistantBridge(await signed(body({assignee:actor,bonusPoints:2})),env())
  assert.equal(ownBonus.status,422)
  assert.equal((await ownBonus.json()).error,'bonus_only_for_other_assignee')
})
