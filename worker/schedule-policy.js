// Classify the single two-hour Cloudflare Cron in UTC. Odd UTC hours correspond
// to even hours in Japan; 06:00 JST is the only daily settlement/cleanup run.
// Keep the old Cron names accepted only for events already in flight during
// migration, but never execute reminder checks on odd local hours.
// Existing manually invoked tests without a Cron keep legacy daily behavior.
const CRON_BIHOURLY='0 1-13/2,21,23 * * *'
const CRON_BIHOURLY_OLD='0 1-23/2 * * *'
const CRON_HOURLY='0 * * * *'
const CRON_PREVIOUS='0 21,23 * * *'
export function scheduledRunPhase(controller){
  if(!controller?.cron)return 'daily'
  if(![CRON_BIHOURLY,CRON_BIHOURLY_OLD,CRON_HOURLY,CRON_PREVIOUS].includes(controller.cron))return 'skip'
  const scheduledTime=controller.scheduledTime
  if(typeof scheduledTime!=='number'||!Number.isFinite(scheduledTime))return 'skip'
  const jstHour=new Date(scheduledTime+9*3600000).getUTCHours()
  if(jstHour===6)return 'daily'
  if(jstHour>=8&&jstHour<=22&&jstHour%2===0)return 'catchup'
  return 'skip'
}
