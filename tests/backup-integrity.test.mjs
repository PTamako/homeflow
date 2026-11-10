import test from 'node:test'
import assert from 'node:assert/strict'
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate'
import {BACKUP_MANIFEST_NAME,createBackupManifest,verifyBackupManifest} from '../src/backup-integrity.mjs'
import {readFileSync} from 'node:fs'

const memory='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
function files(){
 return {
  'homeflow.json':strToU8(JSON.stringify({format:'homeflow.portable',schemaVersion:1,records:{memories:[]}})),
  'shared-memories-readonly.json':strToU8(JSON.stringify({format:'homeflow.shared-memories',items:[]})),
  'points-and-rewards-audit.json':strToU8(JSON.stringify({format:'homeflow.points-audit',records:{lotteryDraws:[{points:6}]}})),
  ['photos/'+memory+'/0001.jpg']:Uint8Array.from([255,216,255,0,1,2,3,255,217])
 }
}
test('ZIP manifest verifies photos, shared archive and audit records with SHA-256',async()=>{
 const contents=files()
 contents[BACKUP_MANIFEST_NAME]=strToU8(JSON.stringify(await createBackupManifest(contents)))
 const unzipped=unzipSync(zipSync(contents,{level:0}))
 const report=await verifyBackupManifest(unzipped,JSON.parse(strFromU8(unzipped[BACKUP_MANIFEST_NAME])))
 assert.equal(report.verifiedEntries,4)
 assert.equal(report.totalBytes,Object.values(files()).reduce((a,b)=>a+b.length,0))
})
test('tampered image bytes, missing audit record or extra untracked file reject ZIP',async()=>{
 const original=files(),manifest=await createBackupManifest(original)
 const altered={...original,['photos/'+memory+'/0001.jpg']:Uint8Array.from([255,216,255,0,9,2,3,255,217])}
 await assert.rejects(verifyBackupManifest(altered,manifest),/backup_checksum_mismatch/)
 const missing={...original};delete missing['points-and-rewards-audit.json']
 await assert.rejects(verifyBackupManifest(missing,manifest),/missing_or_invalid_backup_entry/)
 const extra={...original,'photos/'+memory+'/0002.jpg':new Uint8Array([1])}
 await assert.rejects(verifyBackupManifest(extra,manifest),/backup_manifest_incomplete/)
})
test('malformed manifests cannot claim duplicate entries or write outside backup paths',async()=>{
 const data=files(),manifest=await createBackupManifest(data)
 await assert.rejects(verifyBackupManifest(data,{...manifest,entries:[...manifest.entries,manifest.entries[0]]}),/missing_or_invalid_backup_entry/)
 await assert.rejects(createBackupManifest({'../../outside':new Uint8Array([1])}),/invalid_backup_entry/)
})
test('existing client still does a server-side restore preview and never replays audit points',()=>{
 const source=readFileSync(new URL('../src/components/BackupPanel.vue',import.meta.url),'utf8')
 assert.match(source,/verifyBackupManifest\(files/)
 assert.match(source,/fileInfo\.name===BACKUP_MANIFEST_NAME/)
 assert.match(source,/preview:true/)
 assert.match(source,/points-and-rewards-audit\.json/)
 const portable=readFileSync(new URL('../worker/portable.js',import.meta.url),'utf8')
 assert.match(portable,/RESTORE_ORDER=queries\.map/)
 assert.match(portable,/audit-only/i)
})
