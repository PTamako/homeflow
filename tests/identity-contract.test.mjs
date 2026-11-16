import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {identityRoute} from '../worker/identity.js'

const owner={user_id:'owner-uuid',household_id:'primary',role:'owner',login_name:'owner-login'}
const member={user_id:'member-uuid',household_id:'primary',role:'member',login_name:'member-login'}
function fixture(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,login_name TEXT,disabled_at TEXT);
    CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT,
      PRIMARY KEY(household_id,user_id));
    CREATE TABLE family_profiles(id TEXT PRIMARY KEY,household_id TEXT,
      member_user_id TEXT,type TEXT,display_name TEXT,archived_at TEXT,created_at TEXT);
    CREATE TABLE household_revisions(household_id TEXT PRIMARY KEY,revision INTEGER);
    INSERT INTO users VALUES('owner-uuid','owner-login',NULL),
      ('member-uuid','member-login',NULL),('outsider','outsider-login',NULL);
    INSERT INTO household_members VALUES('primary','owner-uuid','owner'),
      ('primary','member-uuid','member'),('outside','outsider','owner');
    INSERT INTO family_profiles VALUES
      ('a','primary','owner-uuid','person','小白',NULL,'2026-11-01'),
      ('b','primary','member-uuid','person','鸡毛',NULL,'2026-11-02'),
      ('c','primary',NULL,'pet','豆沙',NULL,'2026-11-03'),
      ('d','outside','outsider','person','Outsider',NULL,'2026-11-01');
    INSERT INTO household_revisions VALUES('primary',6),('outside',1);
  `)
  const db={prepare(sql){
    const statement=sqlite.prepare(sql)
    let binds=[]
    return {bind(...x){binds=x;return this},
      first:async()=>statement.get(...binds)||null,
      all:async()=>({results:statement.all(...binds)})}
  }}
  const get=async(path,session=owner,method='GET')=>{
    const response=await identityRoute(
      new Request('https://homeflow.invalid'+path,{method}),db,path,session)
    return {status:response.status,body:await response.json(),
      cache:response.headers.get('cache-control')}
  }
  return {sqlite,get}
}

test('identity/me uses linked human family nickname and stable user/household IDs',async()=>{
 const {sqlite,get}=fixture()
 try{
  const x=await get('/api/identity/me')
  assert.equal(x.status,200)
  assert.deepEqual(x.body,{user_id:owner.user_id,household_id:owner.household_id,
    role:'owner',nickname:'小白',profile_version:6})
  assert.equal(x.cache,'no-store')
  const y=await get('/api/identity/me',member)
  assert.equal(y.body.nickname,'鸡毛')
  assert.equal(y.body.role,'member')
 }finally{sqlite.close()}
})

test('nickname edits change visible display but not user_id or ownership',async()=>{
 const {sqlite,get}=fixture()
 try{
  sqlite.prepare('UPDATE family_profiles SET display_name=? WHERE member_user_id=?')
    .run('鸡毛大王',member.user_id)
  const result=await get('/api/identity/me',member)
  assert.equal(result.body.nickname,'鸡毛大王')
  assert.equal(result.body.user_id,member.user_id)
 }finally{sqlite.close()}
})

test('members list contains only authorized household members and approved display fields',async()=>{
 const {sqlite,get}=fixture()
 try{
  const r=await get('/api/identity/household-members',member)
  assert.equal(r.status,200)
  assert.equal(r.body.members.length,2)
  assert.deepEqual(r.body.members.map(x=>x.nickname),['小白','鸡毛'])
  assert.equal(JSON.stringify(r.body).includes('Outsider'),false)
  for(const x of r.body.members)assert.deepEqual(Object.keys(x).sort(),
    ['nickname','role','user_id'])
 }finally{sqlite.close()}
})

test('missing nickname falls back to current login name without identity relinking',async()=>{
 const {sqlite,get}=fixture()
 try{
  sqlite.prepare('UPDATE family_profiles SET archived_at=? WHERE member_user_id=?')
    .run('2026-11-13',member.user_id)
  const r=await get('/api/identity/me',member)
  assert.equal(r.body.nickname,'member-login')
  assert.equal(r.body.user_id,member.user_id)
 }finally{sqlite.close()}
})

test('anonymous, wrong method, unknown path and disabled-account list are fail-closed',async()=>{
 const {sqlite,get}=fixture()
 try{
  assert.equal((await get('/api/identity/me',null)).status,401)
  assert.equal((await get('/api/identity/me',owner,'POST')).status,405)
  assert.equal((await get('/api/identity/no-such-endpoint')).status,404)
  sqlite.prepare('UPDATE users SET disabled_at=? WHERE id=?')
    .run('2026-11-13',member.user_id)
  const r=await get('/api/identity/household-members',owner)
  assert.equal(r.body.members.length,1)
  assert.equal(r.body.members[0].user_id,owner.user_id)
 }finally{sqlite.close()}
})
