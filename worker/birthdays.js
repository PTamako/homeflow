// Birthday reminders are virtual views derived from family_profiles.
// Changing the birthday or nickname updates the next reminder without writing
// duplicate anniversaries to D1 or needing a migration.
export const BIRTHDAY_LEAD_DAYS = Object.freeze([30,7,1,0])

export function mergeProfileBirthdays(events,profiles) {
  const source=Array.isArray(events)?events:[]
  const seen=new Set()
  for(const event of source) {
    if(event.subject_profile_id && event.repeat_mode==='yearly' &&
       typeof event.event_date==='string' &&
       (String(event.title||'').includes('生日')||String(event.title||'').toLowerCase().includes('birthday')))
      seen.add(event.subject_profile_id+':'+event.event_date.slice(5))
  }
  const synthetic=[]
  for(const p of profiles||[]) {
    if(!p?.id || !/^\d{4}-\d{2}-\d{2}$/.test(p.birthday||'') || !p.display_name)continue
    if(seen.has(p.id+':'+p.birthday.slice(5)))continue
    synthetic.push({
      id:'profile-birthday:'+p.id,
      title:p.display_name+'的生日',
      event_date:p.birthday,
      repeat_mode:'yearly',
      advance_days_json:JSON.stringify(BIRTHDAY_LEAD_DAYS),
      subject_profile_id:p.id,
      source:'profile_birthday',
      profile_type:p.type
    })
  }
  return [...source,...synthetic]
}
export const BIRTHDAY_PROFILES_SQL=`SELECT id,display_name,birthday,type FROM family_profiles
  WHERE household_id=?1 AND archived_at IS NULL AND birthday IS NOT NULL AND birthday!=''
  LIMIT 100`
