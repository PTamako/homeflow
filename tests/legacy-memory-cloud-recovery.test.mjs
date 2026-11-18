import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const cache=readFileSync(new URL('../src/photo-session-cache.ts',import.meta.url),'utf8')
test('legacy memories are uploaded only for visible current owner and removed after exact R2 verification',()=>{
  assert.match(source,/props.mode==='memories'&&cloudEnabled.value&&navigator.onLine/)
  assert.match(source,/m.created_by===actor&&localPhotoBlobs.value\[m.id\]\?\.length/)
  assert.match(source,/props.userId!==actor/)
  assert.match(source,/await verifyMigratedPhoto\(remote.id,compressed\)/)
  assert.match(source,/await deleteLocalPhoto\(props.userId,memoryId,0\)/)
  assert.match(source,/crypto.subtle.digest\('SHA-256',bytes\)/)
  assert.match(source,/actual.byteLength!==expected.byteLength/)
})
test('viewed photos remain bounded in RAM only',()=>{
  assert.match(cache,/MAX_ITEMS=24/)
  assert.match(cache,/MAX_BYTES=8\*1024\*1024/)
  assert.doesNotMatch(cache,/indexedDB.open\(|localStorage.setItem\(/)
})
