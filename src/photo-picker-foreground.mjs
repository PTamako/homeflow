// iOS Safari / PWA file selection causes focus/visibilitychange events that
// are not an actual app foreground return. Memory-only, no phone storage.
const RESUME_GRACE_MS=3000
const MAX_PICKER_MS=10*60*1000
let active=false,openedAt=0,suppressUntil=0

export function beginPhotoPicker(now=Date.now()){
 active=true
 openedAt=now
 suppressUntil=0
}
export function finishPhotoPicker(now=Date.now()){
 active=false
 openedAt=0
 suppressUntil=Math.max(suppressUntil,now+RESUME_GRACE_MS)
}
export function skipPhotoPickerForeground(now=Date.now()){
 if(active){
  // Avoid leaving a stale guard if an OS file picker never sends events.
  if(now-openedAt>=MAX_PICKER_MS){active=false;return false}
  finishPhotoPicker(now)
  return true
 }
 return now<suppressUntil
}
export function isPhotoPickerOpen(now=Date.now()){
 if(active&&now-openedAt>=MAX_PICKER_MS)active=false
 return active
}
export function resetPhotoPickerGuard(){
 active=false;openedAt=0;suppressUntil=0
}
