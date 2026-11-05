import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'

// The JS bundle and public build manifest share one commit identity.
// A PWA resumed from memory can compare them without touching D1.
function revision() {
  if(process.env.GITHUB_SHA)return process.env.GITHUB_SHA.slice(0,12)
  try{return execFileSync('git',['rev-parse','--short=12','HEAD'],{encoding:'utf8'}).trim()}
  catch{return 'local-dev'}
}
const buildRevision=revision()

export default defineConfig({
  plugins:[
    vue(),
    {
      name:'homeflow-build-version',
      apply:'build',
      generateBundle(){
        this.emitFile({
          type:'asset',
          fileName:'build-version.json',
          source:JSON.stringify({revision:buildRevision})
        })
      }
    }
  ],
  define:{__HOMEFLOW_BUILD_VERSION__:JSON.stringify(buildRevision)},
  build:{outDir:'dist'}
})
