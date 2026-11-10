import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
test('logout actively forgets all private in-memory image object URLs',()=>{
 const source=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(source,/import \{clearPhotoCache\} from '\.\/photo-session-cache'/)
 assert.match(source,/async function logout\(\)\{\s*clearPhotoCache\(\)/)
 const cache=readFileSync(new URL('../src/photo-session-cache.ts',import.meta.url),'utf8')
 assert.match(cache,/URL\.revokeObjectURL\(entry\.url\)/)
 assert.match(cache,/function setPhotoCacheUser\(userId:string\)/)
})
