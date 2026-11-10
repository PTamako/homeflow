import {onScopeDispose,shallowRef} from 'vue'

export type ConfirmActionRequest={
 title:string
 message:string
 confirmLabel:string
 danger?:boolean
}

/** One explicit user confirmation at a time. A dismissed sheet never writes data.
 *  On route changes/unmount pending callers resume with false. */
export function useConfirmAction(){
 const request=shallowRef<ConfirmActionRequest|null>(null)
 let resolvePending:((confirmed:boolean)=>void)|null=null

 function confirmAction(options:ConfirmActionRequest):Promise<boolean>{
  if(resolvePending)return Promise.resolve(false)
  request.value=options
  return new Promise<boolean>(resolve=>{resolvePending=resolve})
 }
 function settle(confirmed:boolean){
  const done=resolvePending
  resolvePending=null
  request.value=null
  done?.(confirmed)
 }
 onScopeDispose(()=>settle(false))
 return {request,confirmAction,accept:()=>settle(true),cancel:()=>settle(false)}
}
