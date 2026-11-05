// A saved plan is identified by its ID. Only archived routine occurrences
// have multiple legitimate rows, distinguished by their period date.
export function uniquePlanRows(rows,kind,scope){
  const seen=new Set()
  return rows.filter(row=>{
    if(!row || !row.id)return true
    const key=kind==='routines'&&scope==='history'
      ? row.id+'|'+(row.periodOn||'')
      : row.id
    if(seen.has(key))return false
    seen.add(key)
    return true
  })
}
