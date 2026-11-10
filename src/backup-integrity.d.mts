export declare const BACKUP_MANIFEST_NAME:string
export declare function createBackupManifest(files:Record<string,Uint8Array>):Promise<{
 format:string;schemaVersion:number;entries:Array<{path:string;size:number;sha256:string}>;
 totalBytes:number
}>
export declare function verifyBackupManifest(files:Record<string,Uint8Array>,
 manifest:unknown):Promise<{verifiedEntries:number;totalBytes:number}>
