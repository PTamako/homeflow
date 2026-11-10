// ZIP-integrity manifest is intentionally audit-only; it grants no restore
// permissions and does not replay points, rewards or somebody else's memories.
export const BACKUP_MANIFEST_NAME='backup-integrity.json'
const format='homeflow.backup-integrity'
const allowed=path=>['homeflow.json','points-and-rewards-audit.json','shared-memories-readonly.json'].includes(path)||
  /^photos\/[0-9a-f-]{36}\/\d{4}\.jpg$/i.test(path)
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')
async function digest(bytes){
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
}
export async function createBackupManifest(files){
  if(!files||typeof files!=='object')throw Error('invalid_backup_files')
  const entries=[]
  for(const [path,bytes] of Object.entries(files).sort(([a],[b])=>a.localeCompare(b))){
    if(!allowed(path)||!(bytes instanceof Uint8Array))throw Error('invalid_backup_entry')
    entries.push({path,size:bytes.byteLength,sha256:await digest(bytes)})
  }
  if(!entries.some(e=>e.path==='homeflow.json'))throw Error('missing_homeflow_json')
  return {format,schemaVersion:1,entries,
    totalBytes:entries.reduce((sum,e)=>sum+e.size,0)}
}
export async function verifyBackupManifest(files,manifest){
  if(!manifest||manifest.format!==format||manifest.schemaVersion!==1||
     !Array.isArray(manifest.entries)||manifest.entries.length>100000||
     !Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes<0)
    throw Error('invalid_backup_manifest')
  const names=new Set(),provided=Object.keys(files).filter(k=>k!==BACKUP_MANIFEST_NAME)
  let totalBytes=0
  for(const entry of manifest.entries){
    if(!entry||typeof entry.path!=='string'||!allowed(entry.path)||
       names.has(entry.path)||!Object.hasOwn(files,entry.path)||
       !Number.isSafeInteger(entry.size)||entry.size<0||
       !/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('missing_or_invalid_backup_entry')
    const bytes=files[entry.path]
    if(!(bytes instanceof Uint8Array)||bytes.byteLength!==entry.size||
       await digest(bytes)!==entry.sha256)throw Error('backup_checksum_mismatch')
    names.add(entry.path);totalBytes+=entry.size
  }
  if(!names.has('homeflow.json')||provided.length!==names.size||
     provided.some(path=>!names.has(path))||manifest.totalBytes!==totalBytes)
    throw Error('backup_manifest_incomplete')
  return {verifiedEntries:names.size,totalBytes}
}
