// Classify a single hourly Cron without tying personal quiet hours to deployment.
// Cron ScheduledController.scheduledTime is milliseconds since the Unix epoch.
// Existing manually invoked tests without a Cron keep the legacy daily behavior.
const CRON_HOURLY='0 * * * *'
const CRON_PREVIOUS='0 21,23 * * *'
export function scheduledRunPhase(controller){
  if(!controller?.cron)return 'daily'
  if(controller.cron!==CRON_HOURLY&&controller.cron!==CRON_PREVIOUS)return 'skip'
  const scheduledTime=controller.scheduledTime
  if(typeof scheduledTime!=='number'||!Number.isFinite(scheduledTime))return 'skip'
  const jstHour=new Date(scheduledTime+9*3600000).getUTCHours()
  if(jstHour===6)return 'daily'
  if(jstHour>=7&&jstHour<=23)return 'catchup'
  return 'skip'
}
