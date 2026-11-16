import {json} from './security.js'

// Read-only, same-household identity display contract.
// This is NOT an OAuth/OIDC token endpoint. The caller must already hold a
// valid HomeFlow server session, resolved by sessionFor() on each request.
const profileNameSQL = `SELECT f.display_name FROM family_profiles f
  WHERE f.household_id=?1 AND f.member_user_id=?2 AND f.type='person'
    AND f.archived_at IS NULL
  ORDER BY f.created_at, f.id LIMIT 1`

export async function identityRoute(request,db,path,session){
  if(!session?.user_id||!session?.household_id)
    return json({error:'not_authenticated'},401)
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  if(path==='/api/identity/me'){
    // A family profile, not the login name, is the canonical nickname.
    // Existing household revisions are also a safe, monotonic cache version.
    const row=await db.prepare(`SELECT
        COALESCE(NULLIF((${profileNameSQL}),''),?3) AS nickname,
        COALESCE((SELECT revision FROM household_revisions WHERE household_id=?1),0) AS profile_version`)
      .bind(session.household_id,session.user_id,session.login_name).first()
    return json({
      user_id:session.user_id,
      household_id:session.household_id,
      role:session.role,
      nickname:row?.nickname||session.login_name,
      profile_version:Number(row?.profile_version||0),
    })
  }
  if(path==='/api/identity/household-members'){
    // The household predicate is compulsory; do not return login names,
    // emails, password metadata, disabled members, or private profile notes.
    const rows=await db.prepare(`SELECT
        m.user_id AS user_id, m.role,
        COALESCE(NULLIF((
          SELECT f.display_name FROM family_profiles f
          WHERE f.household_id=m.household_id AND f.member_user_id=m.user_id
            AND f.type='person' AND f.archived_at IS NULL
          ORDER BY f.created_at, f.id LIMIT 1
        ),''),u.login_name) AS nickname
      FROM household_members m
      JOIN users u ON u.id=m.user_id
      WHERE m.household_id=?1 AND u.disabled_at IS NULL
      ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.user_id LIMIT 10`)
      .bind(session.household_id).all()
    return json({household_id:session.household_id,
      members:(rows.results||[]).map(m=>({
        user_id:m.user_id, role:m.role, nickname:m.nickname,
      }))})
  }
  return json({error:'not_found'},404)
}
