export type PlanRowIdentity = {id?:string;periodOn?:string|null;[key:string]:unknown}
export declare function uniquePlanRows<T extends PlanRowIdentity>(
  rows:T[],kind:string,scope:'active'|'history'
):T[]
