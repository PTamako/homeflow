// Pure UI presentation filters. No additional D1 queries are needed.
const dayPattern=/^\d{4}-\d{2}-\d{2}$/

export function upcomingWithinDays(items, today, days=30) {
  if(!Array.isArray(items)||!dayPattern.test(today)||!Number.isInteger(days)||days<0)return []
  const start=Date.parse(today+'T00:00:00Z')
  if(!Number.isFinite(start))return []
  const end=new Date(start+days*86400000).toISOString().slice(0,10)
  return items.filter(item=>typeof item?.nextOn==='string'&&dayPattern.test(item.nextOn)
    &&item.nextOn>=today&&item.nextOn<=end)
}

// Existing Today rows are authoritative. A checked/due task or routine is
// displayed once, in the checklist, not repeated in Important Reminders.
// Trip-specific itinerary reminders are distinct from the generic trip row.
export function additionalReminders(items, todayEntryKeys) {
  const existing=new Set(todayEntryKeys||[])
  return (Array.isArray(items)?items:[]).filter(item=>{
    if(!item||typeof item.kind!=='string'||typeof item.id!=='string')return false
    if(item.kind==='task'||item.kind==='routine')return !existing.has(item.kind+':'+item.id)
    if(['shopping','wish','goal','trip'].includes(item.kind))
      return !existing.has('plan:'+item.kind+':'+item.id)
    return true
  }).sort((a,b)=>String(a.dueOn||'9999-12-31').localeCompare(String(b.dueOn||'9999-12-31'))||
    String(a.kind).localeCompare(String(b.kind))||String(a.id).localeCompare(String(b.id)))
}
