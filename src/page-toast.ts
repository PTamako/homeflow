import {onScopeDispose,ref} from 'vue'
export type ToastKind='success'|'warning'|'error'
export type PageToast={message:string;kind:ToastKind}
/** Each page owns its toast. No global event bus and no persistence across navigation. */
export function usePageToast(){
 const toast=ref<PageToast|null>(null)
 let timer:ReturnType<typeof setTimeout>|null=null
 function clear(){
   if(timer!==null)clearTimeout(timer)
   timer=null
   toast.value=null
 }
 function notify(message:string,kind:ToastKind='success'){
   clear()
   if(!message)return
   toast.value={message,kind}
   timer=setTimeout(()=>{toast.value=null;timer=null},3000)
 }
 onScopeDispose(clear)
 return {toast,notify,clear}
}
