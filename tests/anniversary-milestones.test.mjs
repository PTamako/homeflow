import test from 'node:test'
import assert from 'node:assert/strict'
import {anniversaryMilestoneLabel} from '../src/anniversary-milestones.mjs'

const event=(event_date,nextOn,title,extra={})=>({event_date,nextOn,title,repeat_mode:'yearly',...extra})

test('people and pet birthdays show the age reached on the upcoming date',()=>{
  assert.equal(anniversaryMilestoneLabel(event('1994-11-09','2026-11-09','白ちゃん的生日',{source:'profile_birthday'}),'2026-11-04'),'将满 32 岁')
  assert.equal(anniversaryMilestoneLabel(event('1994-11-09','2026-11-09','白ちゃん的生日'),'2026-11-09'),'满 32 岁')
  assert.equal(anniversaryMilestoneLabel(event('2022-05-02','2027-05-02','豆沙的生日',{source:'profile_birthday'}),'2026-11-04'),'将满 5 岁')
  assert.equal(anniversaryMilestoneLabel(event('2024-02-29','2027-02-28','宠物生日'),'2026-11-04'),'将满 3 岁')
})
test('yearly milestones show completed anniversaries, including across the year boundary',()=>{
  assert.equal(anniversaryMilestoneLabel(event('2025-06-13','2027-06-13','结婚纪念日'),'2026-11-04'),'第 2 周年')
  assert.equal(anniversaryMilestoneLabel(event('2020-12-31','2027-12-31','相识纪念日'),'2027-01-01'),'第 7 周年')
  assert.equal(anniversaryMilestoneLabel(event('2026-11-09','2026-11-09','结婚纪念日'),'2026-11-04'),'')
})
test('one-off, monthly, unknown and invalid dates do not invent ages or anniversaries',()=>{
  assert.equal(anniversaryMilestoneLabel({...event('2025-11-09','2026-11-09','旅行纪念日'),repeat_mode:'once'},'2026-11-04'),'')
  assert.equal(anniversaryMilestoneLabel({...event('2025-11-09','2026-11-09','旅行纪念日'),repeat_mode:'monthly'},'2026-11-04'),'')
  assert.equal(anniversaryMilestoneLabel(event('','2026-11-09','生日'),'2026-11-04'),'')
  assert.equal(anniversaryMilestoneLabel(event('2028-11-09','2026-11-09','生日'),'2026-11-04'),'')
  assert.equal(anniversaryMilestoneLabel(event('unknown','unknown','生日'),'2026-11-04'),'')
})
