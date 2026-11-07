import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {stampServiceWorker} from '../scripts/stamp-pwa.mjs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url))
test('HomeFlow icon PNG files have expected sizes',()=>{
 for(const [path,dimension] of [['public/apple-touch-icon.png',180],['public/icon-192.png',192],['public/icon-512.png',512]]){
  const png=read(path)
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16),dimension)
  assert.equal(png.readUInt32BE(20),dimension)
  assert.equal(png[25],3)
 }
})
test('new icon family is used in manifest, Apple touch icon and SW caches',()=>{
 const html=read('index.html').toString(),sw=read('public/sw.js').toString()
 const manifest=JSON.parse(read('public/manifest.webmanifest').toString())
 assert.match(html,/rel="apple-touch-icon"/)
 assert.equal(manifest.icons[0].src,'/icon-192.png')
 assert.equal(manifest.icons[1].src,'/icon-512.png')
 assert.equal(manifest.icons[2].src,'/icon.svg')
 assert.match(sw,/homeflow-shell-v6/)
 assert.match(sw,/icon:'\/icon-192.png',badge:'\/icon-192.png'/)
})

test('selected DouSha tail icon replaces all PWA image variants',()=>{
 const expected={
   180:'28f9d97acbadff869056fccdababa60282668132b26c2dcd71b0ba27a479b387',
   192:'377eaab20a60113aede6a0b1646e3459532e6ba09bc8573bd74b54d8556a0fa5',
   512:'74d6390ee118f16419f61bf12093c7db17521c105836604ca4541b3fc8768820'
 }
 for(const [size,path] of [['180','public/apple-touch-icon.png'],['192','public/icon-192.png'],['512','public/icon-512.png']]){
   assert.equal(createHash('sha256').update(read(path)).digest('hex'),expected[size])
 }
 const svg=read('public/icon.svg').toString()
 assert.match(svg,/data:image\/png;base64,/)
 assert.match(svg,/aria-label="HomeFlow"/)
})

test('service worker gets fresh icons and manifest while retaining offline copies',()=>{
 const sw=read('public/sw.js').toString()
 const headers=read('public/_headers').toString()
 assert.ok(sw.includes('FRESH_ASSETS.has(url.pathname)'))
 assert.ok(sw.includes("fetch(req,{cache:'no-store'})"))
 assert.ok(sw.includes('caches.match(req)'))
 for(const path of ['/manifest.webmanifest','/icon.svg','/icon-192.png',
   '/icon-512.png','/apple-touch-icon.png']){
   assert.ok(sw.includes("'"+path+"'"),path)
   assert.ok(headers.includes(path+String.fromCharCode(10)+'  Cache-Control: no-cache'),path)
 }
})

test('running PWA gives a safe refresh action when a worker update activates',()=>{
 const app=read('src/App.vue').toString()
 assert.ok(app.includes('controllerchange'))
 assert.ok(app.includes('getRegistration()'))
 assert.ok(app.includes('updateReady'))
 assert.ok(app.includes('刷新到最新版本'))
})

test('every GitHub release changes service worker bytes without editing sw.js by hand',()=>{
 const original=read('public/sw.js').toString()
 const a=stampServiceWorker(original,'a'.repeat(40))
 const b=stampServiceWorker(original,'b'.repeat(40))
 assert.notEqual(a,b)
 assert.ok(a.includes("const CACHE='homeflow-shell-v6-aaaaaaaaaaaa'"))
 assert.ok(b.includes("const CACHE='homeflow-shell-v6-bbbbbbbbbbbb'"))
 assert.throws(()=>stampServiceWorker(original,'bad'))
 assert.ok(read('.github/workflows/deploy.yml').toString().includes('node scripts/stamp-pwa.mjs "$GITHUB_SHA"'))
})
