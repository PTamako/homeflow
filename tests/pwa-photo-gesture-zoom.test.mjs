import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const photo=readFileSync(new URL('../src/components/PhotoViewer.vue',import.meta.url),'utf8')
const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')

test('installed PWA photo viewer has independent zoom despite global app zoom lock',()=>{
 assert.match(main,/homeflow-installed/)
 assert.match(main,/gesturestart/)
 assert.match(photo,/@touchstart.passive="onPhotoTouchStart"/)
 assert.match(photo,/@touchmove.prevent="onPhotoTouchMove"/)
 assert.match(photo,/@touchend="onPhotoTouchEnd"/)
 assert.match(photo,/@touchcancel="onPhotoTouchEnd"/)
 assert.match(photo,/touch-action:none/)
 assert.match(photo,/:style="\{transform:'translate\('\+panX\+'px,'\+panY\+'px\) scale\('\+zoom\+'\)'\}"/)
 assert.doesNotMatch(photo,/touch-action:pinch-zoom/)
})

test('zoom stays bounded and supports tap, double-tap, pinch and one-finger panning',()=>{
 assert.match(photo,/zoom\.value=Math\.max\(1,Math\.min\(4,/)
 assert.match(photo,/Math\.hypot\(a\.clientX-b\.clientX,a\.clientY-b\.clientY\)/)
 assert.match(photo,/dragStart\.panX\+dx/)
 assert.match(photo,/dragStart\.panY\+dy/)
 assert.match(photo,/function clampPan\(\)/)
 assert.match(photo,/image\.offsetWidth\*zoom\.value-container\.clientWidth/)
 assert.match(photo,/image\.offsetHeight\*zoom\.value-container\.clientHeight/)
 assert.match(photo,/now-lastTap<300/)
 assert.match(photo,/if\(justPinched\)\{justPinched=false;lastTap=0;return\}/)
 assert.match(photo,/@click="toggleZoom"/)
 assert.match(photo,/:aria-label="zoom>1\?'还原照片比例':'放大照片两倍'"/)
 assert.match(photo,/\.photo-viewer-zoom\{min-width:52px;min-height:44px;/)
})

test('photo edits and source switches reset zoom without writing device storage',()=>{
 assert.match(photo,/watch\(\(\)=>props\.src,resetZoom\)/)
 assert.match(photo,/editMode\.value=true;angle\.value=0;cropSquare\.value=false;resetZoom\(\)/)
 assert.match(photo,/function cancelEdit\(\)\{\s*resetZoom\(\)/)
 assert.match(photo,/if\(editedUrl\.value\)URL\.revokeObjectURL\(editedUrl\.value\)/)
 assert.match(photo,/@media\(prefers-reduced-motion:reduce\)/)
 const gestureCode=photo.slice(photo.indexOf('function resetZoom(){'),photo.indexOf('onMounted(()=>{'))
 assert.doesNotMatch(gestureCode,/fetch\(|localStorage|indexedDB|sessionStorage|caches\./)
})
