import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'

const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const rowStart=life.indexOf('<article v-for="m in listLoading?[]:items"')
const rowEnd=life.indexOf('</article>',rowStart)
const memory=life.slice(rowStart,rowEnd)

test('timeline swipes one complete memory: date, title, photos, story and visibility move together',()=>{
  assert.ok(rowStart>=0&&rowEnd>rowStart)
  const open=memory.indexOf('<SwipeActions :id="m.id" scope="memories"')
  const close=memory.indexOf('</SwipeActions>')
  assert.ok(open>=0&&close>open)
  const inside=memory.slice(open,close)
  for(const section of [
    'class="memory-swipe-body"',
    'class="memory-swipe-heading"',
    '<time>{{ m.happened_on }}</time>',
    '<h3>{{ m.title }}</h3>',
    'class="memory-photos cloud"',
    'class="memory-photos"',
    '<p>{{ m.story }}</p>',
    'class="memory-visibility"'
  ])assert.ok(inside.includes(section),section+' must move with timeline row')
  assert.ok(memory.indexOf('<LifeItemEditor')>close,
    'Inline edit form stays outside swipe surface for stable tap and keyboard interactions')
  assert.equal((memory.match(/<SwipeActions/g)||[]).length,1)
  assert.equal((memory.match(/<\/SwipeActions>/g)||[]).length,1)
})

test('blue edit/red delete stretch to the full memory height for long stories and photos',()=>{
  assert.match(life,/\.memory-swipe-body\{min-width:0;width:100%;overflow-wrap:anywhere/)
  assert.match(life,/\.memory :deep\(\.swipe-row\)\{border-radius:8px\}/)
  assert.match(life,/\.memory :deep\(\.swipe-actions\)\{align-items:stretch;background:#fff\}/)
  assert.match(life,/\.memory :deep\(\.swipe-actions button\)\{align-self:stretch;height:auto;min-height:0;flex:0 0 72px\}/)
  assert.match(memory,/@edit="edit\('memories',m\)" @delete="removeItem\('memories',m\)"/)
  assert.match(memory,/:allow-edit="canEdit\(m\)" :allow-delete="canEdit\(m\)"/)
})

test('swipe remains on the record, while photo edit/delete moves into fullscreen preview',()=>{
  assert.match(memory,/@open="url=>previewCloudPhoto\(remote,m.id,m.title,url\)"/)
  assert.match(memory,/@click.stop="previewDevicePhoto\(m.id,i,m.title,image\)"/)
  assert.match(memory,/@change="uploadAdditionalPhotos\(m.id,\$event\)"/)
  assert.doesNotMatch(memory,/removeCloudPhoto\(remote.id\)|删除照片（含 R2）/)
  assert.match(life,/<PhotoViewer v-if="openPhoto"/)
  assert.match(life,/@close="openPhoto=null" @save="saveViewedPhoto" @delete="deleteViewedPhoto"/)
})
