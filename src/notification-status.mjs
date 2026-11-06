// Notification task state and recipient read state are independent UI dimensions.
const TASK_KINDS=new Set(['task','routine','shopping'])
const STATES=Object.freeze([
  {label:'已完成',tone:'completed'},
  {label:'已延期',tone:'deferred'},
  {label:'待处理',tone:'pending'},
  {label:'已跳过',tone:'skipped'}
])

export function notificationStatus(item){
  if(!item||!TASK_KINDS.has(item.kind))return null
  const title=String(item.title||''),message=String(item.message||'')
  return STATES.find(state=>
    title.endsWith(' · '+state.label)&&message.startsWith(state.label+' · ')
  )||null
}

export function notificationTitle(item){
  const state=notificationStatus(item)
  return state?item.title.slice(0,-(' · '+state.label).length):item.title
}

export function notificationMessageRemainder(item){
  const state=notificationStatus(item)
  return state?item.message.slice(state.label.length):item.message
}
