import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const life=read('src/components/LifePanel.vue')
const app=read('src/App.vue')
const pet=read('src/components/PetHealthPanel.vue')
const swipe=read('src/components/SwipeActions.vue')
const main=read('src/main.ts')
const styles=read('src/style.css')
const icons=read('src/components/AppIcon.vue')

test('every record type shares the swipe row instead of showing permanent inline edit/delete buttons',()=>{
 for(const type of ['anniversaries','routines','wishes','goals','shopping','trips','memories'])
   assert.ok(life.includes('scope="'+type+'"'),'Missing swipe: '+type)
 for(const type of ['today-unified','pet-health']){
   const source=type==='today-unified'?app:pet
   assert.ok(source.includes('scope="'+type+'"'),'Missing swipe: '+type)
 }
 assert.equal((life.match(/<SwipeActions/g)||[]).length,
              (life.match(/<\/SwipeActions>/g)||[]).length)
 assert.ok(life.includes("editAnniversary(e)"))
 assert.ok(app.includes('openBirthdayProfileEditor'))
 assert.ok(life.includes("item.source==='profile_birthday'"))
 assert.ok(life.includes(':allow-delete="canEdit(e)"'),
   'Synthetic birthdays are edited through profiles, not deleted')
})
test('swipe supports horizontal motion and tap/keyboard alternative while keeping vertical scrolling',()=>{
 assert.match(swipe,/touch-action:pan-y/)
 assert.match(swipe,/@touchstart\.passive="start"/)
 assert.match(swipe,/@touchmove\.passive="move"/)
 assert.match(swipe,/@touchcancel="cancel"/)
 assert.match(swipe,/Math\.abs\(dx\)>Math\.abs\(dy\)\*1\.3/)
 assert.match(swipe,/aria-expanded="opened"/)
 assert.match(swipe,/aria-label="editLabel"/)
 assert.match(swipe,/aria-label="deleteLabel"/)
 assert.match(icons,/name==='ellipsis'/)
})
test('inactive swipe action backgrounds cannot bleed thin green/red lines into plan history rows',()=>{
 assert.match(swipe,/\.swipe-actions\{[^}]*visibility:hidden/);
 assert.match(swipe,/\.swipe-row\.is-open \.swipe-actions,\.swipe-row\.is-dragging \.swipe-actions\{visibility:visible\}/);
 assert.match(swipe,/:class="\{'is-open':opened,'is-dragging':dragging\}"/);
 assert.match(swipe,/:tabindex="opened\?0:-1"/);
})

test('installed PWA prevents accidental zoom without blocking Safari browser zoom',()=>{
 assert.ok(main.includes("display-mode: standalone"))
 assert.ok(main.includes("navigator as Navigator"))
 const block=main.slice(main.indexOf('if(installed){'))
 assert.ok(block.includes('maximum-scale=1,user-scalable=no'))
 assert.ok(block.includes("addEventListener('gesturestart'"))
 assert.ok(block.includes("addEventListener('gesturechange'"))
 assert.match(styles,/\.homeflow-installed input/)
 assert.match(styles,/font-size:16px!important/)
 assert.ok(!read('index.html').includes('user-scalable=no'),
   'Browser Safari should keep pinch zoom')
})
test('travel inner itinerary, task, packing and booking rows all have edit/delete swipe',()=>{
 for(const kind of ['it','task','piece','booking']){
   assert.ok(life.includes('<SwipeActions v-for="'+kind+' in '),kind)
   assert.ok(life.includes('@edit="editTripItem('+kind+')"'),kind)
   assert.ok(life.includes('@delete="removeTripItem('+kind+')"'),kind)
 }
})
