export declare function executeApprovedBatch(
 ids: readonly string[],
 execute: (id:string)=>Promise<{ok?:boolean;applied?:boolean;status?:string;approval_id?:string;remote_id?:string}>,
 isCurrent: ()=>boolean,
 max?: number
): Promise<{ok:boolean;applied:string[];stopped_at:string|null;code:string|null}>;
