import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('new images are never persisted to the phones IndexedDB, even if cloud upload fails',()=>{
 const life=read('src/components/LifePanel.vue')
 const local=read('src/local-media.ts')
 assert.doesNotMatch(life,/saveLocalPhoto|restoreLocalPhoto/)
 assert.doesNotMatch(local,/objectStore\('photos'\)\.put\(|\.put\(blob,/)
 assert.match(life,/if\(photoFiles\.value\.length&&!cloudEnabled\.value\)/)
 assert.match(life,/failedPhotos\.push\(file\.name/)
 assert.match(life,/uploadAdditionalPhotos/)
 assert.match(local,/abortedNewDatabase=true/)
})

test('ZIP restores use private R2 directly and still preserve legacy read-only backup',()=>{
 const backup=read('src/components/BackupPanel.vue')
 assert.match(backup,/listLocalPhotos\(props.userId,id\)/)
 assert.match(backup,/compressPhoto\(new File\(\[raw\]/)
 assert.match(backup,/restoreKey/)
 assert.match(backup,/await fetch\('\/api\/media\/upload\?memoryId=/)
 assert.doesNotMatch(backup,/restoreLocalPhoto\(/)
 assert.match(backup,/云端照片下载失败/)
})

test('old photos are deleted locally only after idempotent confirmed cloud upload',()=>{
 const life=read('src/components/LifePanel.vue')
 assert.match(life,/await uploadPhoto\(memoryId,compressed,marker\)/)
 assert.match(life,/await deleteLocalPhoto\(props.userId,memoryId,0\)/)
 const from=life.indexOf('async function syncLocalPhotos(')
 const to=life.indexOf('async function addMemory(',from)
 assert.ok(from>=0&&to>from)
 const snippet=life.slice(from,to)
 assert.ok(snippet.indexOf('await uploadPhoto(')<snippet.indexOf('await deleteLocalPhoto('))
})
