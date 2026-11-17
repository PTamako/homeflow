export declare const APPROVAL_RECONCILE_POLL_MS: 20000;
export declare function needsApprovalReconciliation<T extends {status?:string|null}>(
 rows:readonly T[]|null|undefined,
 predicate?:(row:T)=>boolean
):boolean;
export declare function createConditionalApprovalPoller(options:{
 shouldPoll:()=>boolean;
 onRefresh:()=>void|Promise<void>;
 intervalMs?:number;
 schedule?:(callback:()=>void|Promise<void>,delay:number)=>ReturnType<typeof setTimeout>;
 cancel?:(id:ReturnType<typeof setTimeout>)=>void;
}):{sync:()=>void;stop:()=>void;dispose:()=>void};
