// JST calendar dates are stored as YYYY-MM-DD. Count both travel endpoints.
export function tripDurationDays(start,end){
 if(typeof start!=='string'||typeof end!=='string'||
    !/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return 0
 const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z')
 if(!Number.isFinite(first)||!Number.isFinite(last)||last<first)return 0
 return Math.round((last-first)/86400000)+1
}
export const longTripNeedsConfirmation=days=>days>30
export const tripPointsPerPerson=days=>Math.max(0,days)*10
export function longTripWarning(days){
 return `这段旅行共 ${days} 天，超过 30 天。\n完成后每位参与人将获得 ${tripPointsPerPerson(days)} 积分（按实际天数计算，不设上限）。\n请再次检查旅行日期，确认结算吗？`
}
