import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeProfileBirthdays,BIRTHDAY_LEAD_DAYS} from '../worker/birthdays.js'
import {nextAnniversary,daysBetween} from '../worker/recurrence.js'

test('profile birthdays are virtual and repeat every year with four reminder offsets',()=>{
 const profile={id:'00000000-0000-4000-8000-000000000001',type:'person',display_name:'白ちゃん',birthday:'1994-11-05'}
 const merged=mergeProfileBirthdays([], [profile])
 assert.equal(merged.length,1)
 assert.equal(merged[0].event_date,'1994-11-05')
 assert.deepEqual(JSON.parse(merged[0].advance_days_json),BIRTHDAY_LEAD_DAYS)
 assert.equal(nextAnniversary(merged[0].event_date,'yearly','2026-11-04'),'2026-11-05')
 assert.equal(daysBetween('2026-11-04','2026-11-05'),1)
})
test('linked yearly birthday wins over virtual profile birthday without hiding other events',()=>{
 const id='00000000-0000-4000-8000-000000000001'
 const profile={id,type:'person',display_name:'白ちゃん',birthday:'1994-11-05'}
 const saved={id:'saved',subject_profile_id:id,title:'白ちゃん生日',event_date:'1994-11-05',
    repeat_mode:'yearly',advance_days_json:'[7,0]'}
 const result=mergeProfileBirthdays([saved], [profile])
 assert.deepEqual(result,[saved])
 const unrelated={id:'other',subject_profile_id:id,title:'相识纪念日',
    event_date:'2020-11-05',repeat_mode:'yearly'}
 assert.equal(mergeProfileBirthdays([unrelated],[profile]).length,2)
})
test('person and pet birthdays are independent and unknown dates are omitted',()=>{
 const profiles=[
  {id:'one',type:'person',display_name:'玉',birthday:'1994-11-05'},
  {id:'two',type:'pet',display_name:'豆沙',birthday:'2022-05-07'},
  {id:'three',type:'pet',display_name:'空',birthday:null}
 ]
 assert.deepEqual(mergeProfileBirthdays([],profiles).map(x=>x.title),['玉的生日','豆沙的生日'])
})
