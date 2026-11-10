export type MobileSelectChoice={value:string;label:string;group:string;disabled:boolean;index:number}
export function normalizeMobileSelectSearch(value:unknown):string
export function filterMobileSelectOptions<T extends MobileSelectChoice>(options:T[],term:string):T[]
export function shouldSearchMobileSelect(options:unknown[],forced?:boolean):boolean
