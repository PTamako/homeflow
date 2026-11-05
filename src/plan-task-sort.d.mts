export type TaskRow=Record<string,any>
export type TaskEntry={kind:'routine'|'task';item:TaskRow}
export declare function taskUrgencyKey(kind:'routine'|'task',item:TaskRow,scope?:'active'|'history'):string
export declare function sortPlanTasks(routines:TaskRow[],tasks:TaskRow[],scope?:'active'|'history'):TaskEntry[]
