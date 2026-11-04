import test from 'node:test'
import assert from 'node:assert/strict'
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate'

test('ZIP backup includes JSON and photos without altering content',()=>{
 const snapshot={format:'homeflow.portable',schemaVersion:1,records:{memories:[{id:'abc',title:'豆沙'}]}}
 const jpeg=Uint8Array.from([255,216,255,40,0,255,217])
 const archive=zipSync({'homeflow.json':strToU8(JSON.stringify(snapshot)),'photos/abc/0001.jpg':jpeg},{level:0})
 const contents=unzipSync(archive)
 assert.deepEqual(JSON.parse(strFromU8(contents['homeflow.json'])),snapshot)
 assert.deepEqual(contents['photos/abc/0001.jpg'],jpeg)
})
test('ZIP filtering can reject non-HomeFlow files before expansion',()=>{
 const archive=zipSync({'homeflow.json':strToU8('{}'),'../../../secrets':strToU8('bad')})
 const files=unzipSync(archive,{filter:f=>f.name==='homeflow.json'})
 assert.deepEqual(Object.keys(files),['homeflow.json'])
})
