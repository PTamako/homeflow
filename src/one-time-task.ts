// Shared one-off task draft and API payload used by Today and Plans.
// Both entry points persist one task to /api/tasks (never /api/routines).
export type OneTimeTaskDraft={
  title:string
  visibility:'private'|'household'
  dueOn:string
  remindEnabled:boolean
  subjectProfileId:string
  healthRecordType:string
}
export function newOneTimeTaskDraft(today:string):OneTimeTaskDraft{
  return {title:'',visibility:'private',dueOn:today,remindEnabled:true,
    subjectProfileId:'',healthRecordType:'other'}
}
export function oneTimeTaskPayload(draft:OneTimeTaskDraft,isPet:boolean){
  return {
    title:draft.title.trim(),notes:'',visibility:draft.visibility,
    dueOn:draft.dueOn||null,remindEnabled:!!draft.dueOn&&draft.remindEnabled,
    subjectProfileId:draft.subjectProfileId||null,
    healthRecordType:isPet?(draft.healthRecordType||null):null
  }
}
