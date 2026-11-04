// Source: Japan Cabinet Office, official 2026 and 2027 national holidays.
// https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
// Future years deliberately fail closed until their official holiday list is verified.
export const VERIFIED_YEARS = new Set([2026, 2027])
const dates = {
  2026: ['01-01','01-12','02-11','02-23','03-20','04-29','05-03','05-04','05-05','05-06',
    '07-20','08-11','09-21','09-22','09-23','10-12','11-03','11-23'],
  2027: ['01-01','01-11','02-11','02-23','03-21','03-22','04-29','05-03','05-04','05-05',
    '07-19','08-11','09-20','09-23','10-11','11-03','11-23']
}
export function isJapaneseWorkday(date) {
  const year = Number(date.slice(0, 4))
  if (!VERIFIED_YEARS.has(year)) return false
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !dates[year].includes(date.slice(5))
}
