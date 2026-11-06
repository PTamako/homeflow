// One semantic status vocabulary for list badges across the app.
// This is presentation-only; never infer or mutate business workflow state.
const definitions=Object.freeze({
  completed:['已完成','success'],met:['已达标','success'],linked:['已关联','success'],
  confirmed:['已确认','success'],read:['已读','success'],success:['成功','success'],
  active:['进行中','info'],planning:['规划中','info'],scheduled:['已安排','info'],
  deferred:['已延期','info'],sent:['已推送','info'],booked:['已预订','info'],
  reserved:['已预订','info'],paid:['已付款','success'],
  pending:['待处理','warning'],to_buy:['待购买','warning'],important:['重要','warning'],
  verification_pending:['待核验','warning'],partial:['部分推送成功','warning'],
  awaiting_network:['待同步','warning'],updated:['待更新','warning'],
  missed:['未完成','danger'],overdue:['逾期','danger'],failed:['失败','danger'],
  shortfall:['未达标','danger'],conflict:['同步冲突','danger'],unread:['未读','danger'],
  cancelled:['已取消','muted'],canceled:['已取消','muted'],skipped:['已跳过','muted'],
  wished:['想做','muted'],unscheduled:['待安排','muted'],not_started:['未开始','muted'],
  app_only:['仅应用内','muted'],unchanged:['未变化','muted'],new:['新旅行','info']
})
const aliases=Object.freeze({
  '已完成':'completed','今天已完成':'completed','本期已完成':'completed','完成':'completed',
  '已达标':'met','已关联':'linked','进行中':'active','规划中':'planning',
  '待处理':'pending','待购买':'to_buy','重要':'important','待核验':'verification_pending',
  '未完成':'missed','已逾期':'overdue','逾期':'overdue','未达标':'shortfall',
  '已跳过':'skipped','已取消':'cancelled','想做':'wished','待安排':'unscheduled',
  '未开始':'not_started','已截止':'verification_pending','已预订':'booked',
  '已确认':'confirmed','已付款':'paid','已延期':'deferred','已推送':'sent',
  '仅应用内':'app_only','待同步':'awaiting_network'
})
export function statusPresentation(code){
  const original=String(code??'').trim()
  const normalized=original.toLowerCase()
  const key=aliases[original]||normalized
  const [label,tone]=definitions[key]||[original||'状态未知','muted']
  return {label,tone}
}
