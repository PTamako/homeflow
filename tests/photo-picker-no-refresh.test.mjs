import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {beginPhotoPicker,finishPhotoPicker,isPhotoPickerOpen,
 skipPhotoPickerForeground,resetPhotoPickerGuard} from '../src/photo-picker-foreground.mjs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('iOS photo picker focus does not refresh even if the user picks nothing',()=>{
 resetPhotoPickerGuard()
 beginPhotoPicker(10000)
 assert.equal(isPhotoPickerOpen(10005),true)
 assert.equal(skipPhotoPickerForeground(11000),true,'first foreground return is a picker event')
 assert.equal(isPhotoPickerOpen(11001),false)
 assert.equal(skipPhotoPickerForeground(11800),true,'duplicate focus or visibilitychange')
 assert.equal(skipPhotoPickerForeground(14100),false,'normal foreground resumes later')
 resetPhotoPickerGuard()
})

test('input cancel/change and stale session do not permanently stop normal refresh',()=>{
 resetPhotoPickerGuard()
 beginPhotoPicker(20000)
 finishPhotoPicker(20100)
 assert.equal(skipPhotoPickerForeground(22000),true)
 assert.equal(skipPhotoPickerForeground(23200),false)
 beginPhotoPicker(30000)
 assert.equal(skipPhotoPickerForeground(630001),false,'stale guard expires')
 resetPhotoPickerGuard()
})

test('native picker cancel preserves timeline pages and scroll; successful upload patches only one memory',()=>{
 const life=read('src/components/LifePanel.vue')
 const app=read('src/App.vue')
 assert.match(app,/if\(skipPhotoPickerForeground\(\)\)return/)
 assert.match(app,/\|\|isPhotoPickerOpen\(\)\)return/)
 assert.match(life,/if\(!files.length\|\|busy.value\)return/)
 assert.match(life,/@click.capture="beginPhotoPicker"/)
 assert.match(life,/@cancel="finishPhotoPicker"/)
 const from=life.indexOf('async function uploadAdditionalPhotos(')
 const to=life.indexOf('async function syncLocalPhotos(',from)
 assert.ok(from>=0&&to>from)
 const snippet=life.slice(from,to)
 assert.doesNotMatch(snippet,/fetchMode\(|loadPhotos\(|window.scrollTo|items.value=/)
 assert.match(snippet,/cloudPhotos.value\[memoryId\]=/)
 assert.match(snippet,/items.value.some\(item=>item.id===memoryId\)/)
 assert.match(snippet,/uploaded.length/)
})
