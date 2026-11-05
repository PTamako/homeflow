import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
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
 assert.match(sw,/homeflow-shell-v3/)
 assert.match(sw,/icon:'\/icon-192.png',badge:'\/icon-192.png'/)
})
