import {ref} from 'vue'

// One unobtrusive, dismissible lesson for every swipe-capable list in HomeFlow.
// Never put a permanent red/blue marker on each record.
const key='homeflow:swipe-discovery-v1'
export const swipeHelpLearned=ref(false)
export const swipeHelpOwner=ref('')
let loaded=false

function load(){
 if(loaded)return
 loaded=true
 try{swipeHelpLearned.value=localStorage.getItem(key)==='1'}catch{/* Browsers with disabled storage can still use the UI. */}
}
export function claimSwipeHelp(rowKey:string){
 load()
 if(!swipeHelpLearned.value&&!swipeHelpOwner.value)swipeHelpOwner.value=rowKey
}
export function releaseSwipeHelp(rowKey:string){
 if(swipeHelpOwner.value===rowKey)swipeHelpOwner.value=''
}
export function acknowledgeSwipeHelp(){
 swipeHelpLearned.value=true
 swipeHelpOwner.value=''
 try{localStorage.setItem(key,'1')}catch{/* The current session still remembers. */}
}
