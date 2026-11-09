import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {encrypt,validSubscription} from '../worker/webpush.js'

function b64(v){
 return Buffer.from(v).toString('base64url')
}
async function h(input,salt,info,length){
 const key=await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits'])
 return crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length)
}
const concat=(...parts)=>{const b=parts.map(x=>new Uint8Array(x));const out=new Uint8Array(b.reduce((a,x)=>a+x.byteLength,0));let i=0;for(const v of b){out.set(v,i);i+=v.byteLength}return out}

test('VAPID push subscription accepts only supported push service hosts',()=>{
 const keys={p256dh:b64(new Uint8Array(65)),auth:b64(new Uint8Array(16))}
 assert.equal(validSubscription({endpoint:'https://fcm.googleapis.com/fcm/send/abc',keys}),true)
 assert.equal(validSubscription({endpoint:'https://web.push.apple.com/abc',keys}),true)
 assert.equal(validSubscription({endpoint:'https://evil.example/abc',keys}),false)
 assert.equal(validSubscription({endpoint:'http://fcm.googleapis.com/fcm/send/abc',keys}),false)
})

test('aes128gcm Web Push payload decrypts with recipient key',async()=>{
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits'])
 const p256dh=new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey))
 const auth=crypto.getRandomValues(new Uint8Array(16))
 const payload={title:'豆沙驱虫',body:'今天需要护理',url:'/'}
 const encrypted=await encrypt(payload,{p256dh:b64(p256dh),auth_secret:b64(auth)})
 assert.ok(encrypted.length>80)
 const salt=encrypted.slice(0,16)
 const recordSize=new DataView(encrypted.buffer).getUint32(16)
 assert.equal(recordSize,4096)
 assert.equal(encrypted[20],65)
 const ephemeralRaw=encrypted.slice(21,86)
 const sender=await crypto.subtle.importKey('raw',ephemeralRaw,{name:'ECDH',namedCurve:'P-256'},false,[])
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:sender},receiver.privateKey,256)
 const info=concat(new TextEncoder().encode('WebPush: info\0'),p256dh,ephemeralRaw)
 const ikm=await h(shared,auth,info,256)
 const cek=await h(ikm,salt,new TextEncoder().encode('Content-Encoding: aes128gcm\0'),128)
 const nonce=await h(ikm,salt,new TextEncoder().encode('Content-Encoding: nonce\0'),96)
 const key=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['decrypt'])
 const result=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,tagLength:128},key,encrypted.slice(86)))
 assert.equal(result[result.length-1],2)
 assert.deepEqual(JSON.parse(new TextDecoder().decode(result.slice(0,-1))),payload)
})

test('family push confirmation counts subscriptions, not physical devices',()=>{
 const source=readFileSync(new URL('../src/components/PushPanel.vue',import.meta.url),'utf8')
 assert.match(source,/已向 '\+recipientName\+' 发出推送通知/)
 assert.match(source,/订阅通道的请求（不等于手机数量）/)
 assert.doesNotMatch(source,/台设备|个设备请求/)
})
