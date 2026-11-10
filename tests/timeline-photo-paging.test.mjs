import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('timeline shows photo tiles and a picture-upload icon, not a plus or cloud labels',()=>{
 const template=read('src/components/LifePanel.vue').split('<template>')[1]
 assert.match(template,/class="memory-add-photo"/)
 assert.match(template,/<AppIcon name="image-upload" :size="19" \/>/)
 assert.doesNotMatch(template,/<span aria-hidden="true">＋<\/span>/)
 assert.match(read('src/components/AppIcon.vue'),/name==='image-upload'/)
 assert.match(template,/@change="uploadAdditionalPhotos\(m.id,\$event\)"/)
 assert.match(template,/<PhotoThumbnail v-for="remote in cloudPhotos\[m.id\]"/)
 assert.match(template,/<PhotoViewer v-if="openPhoto"/)
 assert.doesNotMatch(template,/删除照片（含 R2）|继续添加照片（私人 R2/)
 assert.match(template,/查看更多照片/)
})
test('photo bytes are downloaded only when visible and stay only in bounded RAM',()=>{
 const photo=read('src/components/PhotoThumbnail.vue')
 const cache=read('src/photo-session-cache.ts')
 assert.match(photo,/IntersectionObserver/)
 assert.match(photo,/entry\.isIntersecting/)
 assert.match(cache,/MAX_ITEMS=24/)
 assert.match(cache,/MAX_BYTES=8\*1024\*1024/)
 assert.match(cache,/cache:'no-store'/)
 assert.match(cache,/URL\.revokeObjectURL/)
 assert.doesNotMatch(cache,/localStorage\.setItem|indexedDB\.open|caches\.open/)
})
test('fullscreen viewer contains edit/delete but the timeline cards do not',()=>{
 const viewer=read('src/components/PhotoViewer.vue')
 const life=read('src/components/LifePanel.vue')
 assert.match(viewer,/>编辑<\/button>/)
 assert.match(viewer,/>删除<\/button>/)
 assert.match(viewer,/旋转 90°/)
 assert.match(viewer,/裁剪正方形/)
 assert.match(life,/@save="saveViewedPhoto" @delete="deleteViewedPhoto"/)
 assert.match(life,/photoCursors\[m.id\]/)
 const zip=read('src/components/BackupPanel.vue')
 assert.match(zip,/while\(cursor\)/)
})
