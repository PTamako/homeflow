import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const backup=readFileSync(new URL('../src/components/BackupPanel.vue',import.meta.url),'utf8')
const template=backup.slice(backup.indexOf('<template>'),backup.indexOf('</template>')+11)
const style=backup.slice(backup.lastIndexOf('<style scoped>'))

test('backup page has two compact action areas rather than inline buttons embedded in paragraphs',()=>{
 assert.match(template,/<h2 id="backup-title" class="backup-title"/)
 assert.equal((template.match(/class="backup-section"/g)||[]).length,2)
 assert.match(template,/<h3>下载备份<\/h3>/)
 assert.match(template,/<h3>恢复备份<\/h3>/)
 assert.match(template,/class="backup-download" :disabled="pending" @click="exportArchive"/)
 assert.match(template,/class="backup-file-picker"/)
 assert.match(template,/@change="chooseArchive\(/)
 assert.doesNotMatch(template,/<p[^>]*>[^<]*<button/)
})

test('less prominent file chooser remains accessible and shows the chosen filename',()=>{
 assert.match(template,/<input class="backup-file-native" type="file"/)
 assert.match(template,/aria-label="选择 HomeFlow 备份文件"/)
 assert.match(template,/:disabled="pending"/)
 assert.match(template,/selectedFile\?\.name\|\|'未选择文件'/)
 assert.match(style,/\.backup-file-native\{position:absolute;inset:0/)
 assert.match(style,/opacity:0;cursor:pointer/)
 assert.match(style,/\.backup-file-row\{display:flex;align-items:center;gap:10px;min-width:0\}/)
 assert.match(style,/\.backup-file-name\{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis/)
 assert.match(style,/min-height:44px/)
})

test('essential recovery warnings remain available without flooding the main UI',()=>{
 assert.match(template,/<details class="backup-notes">/)
 assert.match(template,/<summary>备份与恢复说明<\/summary>/)
 assert.match(template,/恢复不会覆盖原记录/)
 assert.match(template,/两位家庭成员需各自备份/)
 assert.match(template,/不含密码、未同步任务和云端照片/)
 assert.match(template,/<div v-if="preview" class="backup-preview">/)
 assert.match(template,/previewRecordCount/)
 assert.match(template,/previewPhotoCount/)
 assert.match(template,/class="backup-restore" :disabled="pending" @click="restore"/)
 assert.match(backup,/if\(!confirm\('确定恢复吗？只补充缺失记录，不覆盖现有内容/)
 assert.match(backup,/await api\('\/portable\/restore','POST'/)
 assert.match(backup,/preview:true/)
 assert.match(backup,/confirm:true/)
})

test('backup and restore logic continues to preserve local photos and portable checks',()=>{
 assert.match(backup,/listLocalPhotos\(props.userId,id\)/)
 assert.match(backup,/restoreLocalPhoto\(props.userId,match\[1\]/)
 assert.match(backup,/snapshot.format!=='homeflow.portable'/)
 assert.match(backup,/zipSync\(files,\{level:0\}\)/)
 assert.match(backup,/unzipSync\(raw,/)
 assert.match(backup,/PageToast :toast="toast"/)
})

test('export entry warns about unsynced tasks and device-local pictures',()=>{
 assert.match(template,/仅备份当前账号与本机照片/)
 assert.match(template,/请先同步待办，其他设备需分别备份/)
})
