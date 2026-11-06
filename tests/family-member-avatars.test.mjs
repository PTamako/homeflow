import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')

test('family members show the two custom puppy avatars in editable and read-only rows',()=>{
  assert.match(app,/name==='白ちゃん'\|\|name==='小白'/)
  assert.match(app,/name==='鸡毛大王'\|\|name==='鸡毛'/)
  assert.equal((app.match(/<img v-if="personAvatar\(p\)"/g)||[]).length,2)
  assert.equal((app.match(/<AppIcon v-else name="users"/g)||[]).length,2)
})

test('family avatar graphics are standalone small vector assets',()=>{
  for(const name of ['xiaobai','jimao']){
    const svg=readFileSync(new URL('../public/avatars/'+name+'.svg',import.meta.url),'utf8')
    assert.match(svg,/<svg /)
    assert.match(svg,/fill="#276c51"/)
    assert.match(svg,/<path /)
    assert.ok(svg.length<5000)
  }
})
