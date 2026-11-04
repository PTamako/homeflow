/**
 * Upcoming ages/anniversaries are derived from the original event date, not
 * the reminder creation date. Runs locally: no extra D1 queries.
 */
export function anniversaryMilestoneLabel(event, asOf) {
  if (event?.repeat_mode !== 'yearly') return ''
  const original = event.event_date
  const next = event.nextOn
  if (typeof original !== 'string' || typeof next !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(original) || !/^\d{4}-\d{2}-\d{2}$/.test(next) ||
      next < original) return ''
  const years = Number(next.slice(0, 4)) - Number(original.slice(0, 4))
  if (!Number.isInteger(years) || years < 0) return ''
  const birthday = event.source === 'profile_birthday' ||
    /生日|誕生日|birthday/i.test(String(event.title || ''))
  if (birthday) return (next === asOf ? '满 ' : '将满 ') + years + ' 岁'
  // The first occurrence is the original event, not its first anniversary.
  return years > 0 ? '第 ' + years + ' 周年' : ''
}
