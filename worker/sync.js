import {json} from './security.js'

// Lightweight indexed D1 lookup: no scan of private plans or financial records.
export async function householdRevision(db,householdId){
 const row=await db.prepare('SELECT revision FROM household_revisions WHERE household_id=?1')
   .bind(householdId).first()
 return Number(row?.revision||0)
}
export async function syncStateRoute(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const revision=await householdRevision(db,session.household_id)
 return json({revision})
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
