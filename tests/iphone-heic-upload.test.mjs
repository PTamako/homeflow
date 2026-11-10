import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('native iPhone HEIC and HEIF are offered to the picker and JPEG-compressed',()=>{
 const local=readFileSync(new URL('../src/local-media.ts',import.meta.url),'utf8')
 const timeline=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(local,/heic\|heif\|heic-sequence\|heif-sequence/)
 assert.match(local,/createImageBitmap\(file\)/)
 assert.match(local,/image\/jpeg/)
 assert.match(local,/bitmap\?\.close\(\)/)
 assert.match(timeline,/accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif,\.heic,\.heif"/)
 assert.match(timeline,/failed\.push\(file\.name/)
 assert.doesNotMatch(timeline,/indexedDB\.open/)
})
