import {json} from './security.js'

// Lightweight indexed D1 lookup: no scan of private plans or financial records.
export async function householdRevision(db,householdId){
 const row=await db.prepare('SELECT revision FROM household_revisions WHERE household_id=?1')
   .bind(householdId).first()
 return Number(row?.revision||0)
}
export async function syncStateRoute(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 // One D1 statement, two indexed lookups; no full plan or inbox scan.
 const state=await db.prepare(`SELECT
   (SELECT revision FROM household_revisions WHERE household_id=?1) AS revision,
   (SELECT revision FROM member_revisions WHERE household_id=?1 AND user_id=?2) AS personalRevision`)
   .bind(session.household_id,session.user_id).first()
 return json({revision:Number(state?.revision||0),
   personalRevision:Number(state?.personalRevision||0)})
}
// Every successful authenticated mutation increments one household version.
// A failed request must never trigger a remote refresh.
export async function bumpHouseholdRevision(db,session){
 if(!session?.household_id)return
 await db.prepare(`INSERT INTO household_revisions
   (household_id,revision,changed_at) VALUES(?1,1,CURRENT_TIMESTAMP)
   ON CONFLICT(household_id) DO UPDATE SET
     revision=household_revisions.revision+1,changed_at=CURRENT_TIMESTAMP`)
   .bind(session.household_id).run()
}

// Personal changes should not invalidate another member's household Today
// cache. Multiple devices of the same member still receive this version.
export async function bumpMemberRevision(db,session){
 if(!session?.household_id||!session?.user_id)return
 await db.prepare(`INSERT INTO member_revisions
   (household_id,user_id,revision,changed_at) VALUES(?1,?2,1,CURRENT_TIMESTAMP)
   ON CONFLICT(household_id,user_id) DO UPDATE SET
     revision=member_revisions.revision+1,changed_at=CURRENT_TIMESTAMP`)
   .bind(session.household_id,session.user_id).run()
}
export function personalMutation(path){
 return /^\/api\/notifications\/[a-f0-9-]{36}\/(read|unread)$/i.test(path)||
   ['/api/reminders/snooze','/api/reminders/preferences','/api/reminders/item',
     '/api/push/subscriptions','/api/auth/logout'].includes(path)
}
