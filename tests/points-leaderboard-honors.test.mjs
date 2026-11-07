import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const panel=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
const points=readFileSync(new URL('../worker/points.js',import.meta.url),'utf8')

test('leaderboards show separate first-place honors on their respective member titles',()=>{
 assert.match(panel,/const contributionLeaderId=computed\(\(\)=>data\.value\?\.members\[0\]/)
 assert.match(panel,/const walletLeaderId=computed\(\(\)=>data\.value\?\.members\.reduce/)
 assert.match(panel,/member\.availablePoints>leader\.availablePoints/)
 const section=panel.slice(panel.indexOf('class="points-members"'),panel.indexOf('class="points-private"'))
 assert.match(section,/v-if="item\.userId===contributionLeaderId"[\s\S]*?role="img" aria-label="贡献第一" title="贡献第一">🏆<\/span>/)
 assert.match(section,/v-if="item\.userId===walletLeaderId"[\s\S]*?role="img" aria-label="积分第一" title="积分第一">👑<\/span>/)
 assert.doesNotMatch(section,/v-else-if="item\.userId===walletLeaderId"/)
 assert.match(section,/class="points-honors"/)
 assert.doesNotMatch(section,/🏆 贡献第一|👑 积分第一/)
 assert.ok(section.indexOf('<b>{{ item.displayName }}</b>')<section.indexOf('class="points-honors"'))
 const css=panel.slice(panel.indexOf('.points-name{'),panel.indexOf('.points-score{'))
 assert.match(css,/\.points-name\{[^}]*flex-wrap:nowrap/)
 assert.match(css,/\.points-honors\{[^}]*display:inline-flex;flex:none/)
 assert.doesNotMatch(css,/width:100%|margin-top:2px/)
 assert.match(section,/可用家庭积分/)
 assert.match(section,/本月贡献分/)
 assert.match(section,/累计贡献/)
})

test('wallet shown for every member uses the exact spending wallet SQL',()=>{
 assert.match(points,/householdWalletSql\('m\.household_id','m\.user_id'\)/)
 assert.match(points,/availablePoints:Math\.max\(0,Number\(row\.availablePoints\)\|\|0\)/)
 assert.match(panel,/fmt\(item\.availablePoints\)/)
})

test('lottery only affects wallet, never contribution SQL or leaderboard rank',()=>{
 const leaderSql=points.slice(points.indexOf('const members='),points.indexOf('const week='))
 assert.doesNotMatch(leaderSql,/household_lottery_draws/)
 assert.match(leaderSql,/ORDER BY monthPoints DESC,sharedPoints DESC/)
 const fullSql=points.slice(points.indexOf('const [own,totals'),points.indexOf('const earned='))
 assert.match(fullSql,/household_lottery_draws/)
 assert.match(panel,/抽奖只影响可用家庭积分/)
})
