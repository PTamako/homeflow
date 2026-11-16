// Resume EXACT staged release from successful Run 43787305799.
// Its four fully built versions passed G8 and share the already-configured
// Pages production secret pairs. Do not rekey or substitute later versions.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export const PINNED_RELEASE={
 workers:{
  homeflow:{new_version:'6eb2f2b2-dca8-41f1-ac42-058f4f06020a',old_version:'bdae82ce-49be-47bb-9eb5-6960fb1e375f'},
  'kakeibo-homeflow-bridge':{new_version:'f50312d0-060d-4179-b351-624dbc35b24f',old_version:'3db626a1-a865-4d67-872c-06f2a8abb279'},
  'it-study-platform':{new_version:'c82bb76e-f9eb-4488-a483-f7ced7b96bbe',old_version:'605ec3a7-ca3f-425e-b692-1039afc732c7'},
  'jp-document-assistant':{new_version:'90e23e83-1e9c-42b9-aa6b-df07cbb96dcc',old_version:'55963dbf-63f1-42b0-aaec-28113d3a23ca'}
 },
 pages_old_deployment:'a9075ac5-865c-47a4-b981-7ff97f6aced2'
};
export function assertPinnedRelease(actual){
 const err=[];
 for(const [name,reviewed] of Object.entries(PINNED_RELEASE.workers)){
  const found=actual?.workers?.[name];
  if(!found||found.new_version!==reviewed.new_version||
    found.old_version!==reviewed.old_version)err.push('STALE_OR_WRONG_STAGED_VERSION:'+name);
 }
 if(actual?.pages_old_deployment!==PINNED_RELEASE.pages_old_deployment)
  err.push('PRODUCTION_PAGES_DEPLOYMENT_DRIFT');
 if(err.length)throw Error(err.join(','));
 return {pinned_staged_production_release_verified:true,worker_versions:4,
  no_secret_rotation:true,no_traffic_activation:true};
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  if(!process.env.RUNNER_TEMP||process.env.GITHUB_ACTIONS!=='true')
   throw Error('CONTROLLED_ACTIONS_RUNNER_REQUIRED');
  const actual=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,
   'four-app-staged-versions.json'),'utf8'));
  console.log(JSON.stringify(assertPinnedRelease(actual)));
 }catch(e){console.error('STAGED_RELEASE_RESUME_BLOCKED:'+e.message);process.exitCode=1}
}
