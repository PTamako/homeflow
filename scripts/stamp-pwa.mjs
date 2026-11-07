import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const CACHE_DECLARATION=/const CACHE='homeflow-shell-v6(?:-[0-9a-f]{12})?'/
export function stampServiceWorker(source,commitSha){
  if(typeof commitSha!=='string'||!/^[a-f0-9]{40}$/.test(commitSha))
    throw Error('A full git commit SHA is required for PWA releases')
  if(typeof source!=='string'||!CACHE_DECLARATION.test(source))
    throw Error('Unknown PWA cache template; update the release stamp script')
  return source.replace(CACHE_DECLARATION,
    "const CACHE='homeflow-shell-v6-"+commitSha.slice(0,12)+"'")
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=new URL('../public/sw.js',import.meta.url)
  const original=readFileSync(file,'utf8')
  writeFileSync(file,stampServiceWorker(original,process.argv[2]||process.env.GITHUB_SHA))
}
