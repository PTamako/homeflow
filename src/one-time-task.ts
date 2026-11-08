// Shared one-off task draft and API payload used by Today and Plans.
// Both entry points persist one task to /api/tasks (never /api/routines).
export type OneTimeTaskDraft={
  title:string
  visibility:'private'|'household'
  dueOn:string
  remindEnabled:boolean
  subjectProfileId:string
  assigneeUserId:string
  secondAssigneeUserId:string
  healthRecordType:string
  bonusPoints:number
}
export function newOneTimeTaskDraft(today:string,userId=''):OneTimeTaskDraft{
  return {title:'',visibility:'private',dueOn:today,remindEnabled:true,
    subjectProfileId:'',assigneeUserId:userId,secondAssigneeUserId:'',healthRecordType:'other',bonusPoints:0}
}
export function oneTimeTaskPayload(draft:OneTimeTaskDraft,isPet:boolean){
  return {
    title:draft.title.trim(),notes:'',visibility:draft.visibility,
    dueOn:draft.dueOn||null,remindEnabled:!!draft.dueOn&&draft.remindEnabled,
    assigneeUserId:draft.assigneeUserId||null,
    secondAssigneeUserId:draft.secondAssigneeUserId||null,
    bonusPoints:draft.assigneeUserId&&!draft.secondAssigneeUserId?draft.bonusPoints||0:0,
    subjectProfileId:draft.subjectProfileId||null,
    healthRecordType:isPet?(draft.healthRecordType||null):null
  }
}
