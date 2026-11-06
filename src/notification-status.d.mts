export type NotificationTone='completed'|'deferred'|'pending'|'skipped'
export type NotificationItem={kind:string;title:string;message:string}
export type NotificationStatus={readonly label:string;readonly tone:NotificationTone}
export declare function notificationStatus(item:NotificationItem):NotificationStatus|null
export declare function notificationTitle(item:NotificationItem):string
export declare function notificationMessageRemainder(item:NotificationItem):string
