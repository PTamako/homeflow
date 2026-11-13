import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {oauthRoute} from '../worker/oauth.js'

const callback='https://example.test/sso/callback'
const client='test-client'
const oldOrigin='https://homeflow.example.test'
const verifier='a'.repeat(43)
const challenge=async value=>{
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
 return btoa(String.fromCharCode(...digest)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
}
const person={user_id:'owner',household_id:'primary',role:'owner',login_name:'test-owner'}
function database(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`
   PRAGMA foreign_keys=ON;
   CREATE TABLE users(id TEXT PRIMARY KEY,login_name TEXT,disabled_at TEXT);
   CREATE TABLE households(id TEXT PRIMARY KEY);
   CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT,
     PRIMARY KEY(household_id,user_id),FOREIGN KEY(user_id) REFERENCES users(id),
     FOREIGN KEY(household_id) REFERENCES households(id));
   CREATE TABLE family_profiles(id TEXT PRIMARY KEY,household_id TEXT,
     member_user_id TEXT,type TEXT,display_name TEXT,archived_at TEXT,created_at TEXT);
   INSERT INTO users VALUES('owner','test-owner',NULL),('member','test-member',NULL);
   INSERT INTO households VALUES('primary');
   INSERT INTO household_members VALUES('primary','owner','owner'),
     ('primary','member','member');
   INSERT INTO family_profiles VALUES
    ('one','primary','owner','person','小白',NULL,'2026-11-13'),
    ('two','primary','member','person','鸡毛',NULL,'2026-11-13');
 `)
 sqlite.exec(readFileSync(new URL('../migrations/0053_oauth_code_exchange.sql',import.meta.url),'utf8'))
 const db={prepare(sql){
   const stmt=sqlite.prepare(sql);let args=[]
   return {bind(...values){args=values;return this},
     async first(){return stmt.get(...args)||null},
     async all(){return{results:stmt.all(...args)}},
     async run(){return{meta:{changes:stmt.run(...args).changes}}}}
 },async batch(statements){
   sqlite.exec('BEGIN')
   try{const results=[];for(const st of statements)results.push(await st.run());sqlite.exec('COMMIT');return results}
   catch(e){sqlite.exec('ROLLBACK');throw e}
 }}
 const env={DB:db,OAUTH_ENABLED:'true',
   OAUTH_CLIENT_REDIRECTS:JSON.stringify({[client]:[callback]})}
 const call=async(path,method='GET',data=null,session=person,headers={})=>{
   const h={...headers};let body
   if(data instanceof URLSearchParams){
      body=data.toString();h['content-type']='application/x-www-form-urlencoded'
   }else if(data!=null){body=JSON.stringify(data);h['content-type']='application/json'}
   const request=new Request(oldOrigin+path,{method,headers:h,body})
   const response=await oauthRoute(request,env,path,session)
   return {status:response.status,body:await response.json(),headers:response.headers}
 }
 const authorize=async(session=person,overrides={})=>call('/api/oauth/authorize','POST',{
   response_type:'code',client_id:client,redirect_uri:callback,
   code_challenge_method:'S256',code_challenge:await challenge(verifier),
   nonce:'n'.repeat(32),state:'s'.repeat(32),consent:true,...overrides
 },session)
 const exchange=(code,overrides={})=>call('/api/oauth/token','POST',new URLSearchParams({
   grant_type:'authorization_code',client_id:client,redirect_uri:callback,
   code,code_verifier:verifier,...overrides
 }),null)
 return {sqlite,env,call,authorize,exchange}
}

test('OAuth feature remains disabled without explicit flag',async()=>{
 const {sqlite,env,authorize}=database()
 try{env.OAUTH_ENABLED='false';const r=await authorize();assert.equal(r.status,503)}
 finally{sqlite.close()}
})

test('authorization is session-bound, allowlisted, PKCE S256-only and consented',async()=>{
 const {sqlite,authorize}=database()
 try{
   assert.equal((await authorize(null)).status,401)
   assert.equal((await authorize(person,{redirect_uri:'https://attacker.test/cb'})).status,400)
   assert.equal((await authorize(person,{code_challenge_method:'plain'})).status,400)
   assert.equal((await authorize(person,{consent:false})).status,400)
   assert.equal((await authorize(person,{state:'x'})).status,400)
   assert.equal((await authorize(person,{client_id:'bogus'})).status,400)
   const correct=await authorize()
   assert.equal(correct.status,200)
   assert.equal(correct.body.expires_in,180)
   assert.equal(new URL(correct.body.redirect_uri).origin,'https://example.test')
   assert.equal(new URL(correct.body.redirect_uri).searchParams.get('state'),'s'.repeat(32))
 }finally{sqlite.close()}
})

test('code can be redeemed once, userinfo returns server-side owner and nickname',async()=>{
 const {sqlite,authorize,exchange,call}=database()
 try{
   const grant=await authorize()
   const code=new URL(grant.body.redirect_uri).searchParams.get('code')
   const token=await exchange(code)
   assert.equal(token.status,200)
   assert.equal(token.body.expires_in,180)
   assert.equal(token.body.token_type,'Bearer')
   assert.equal(token.body.access_token.length,64)
   assert.equal(token.headers.get('cache-control'),'no-store')
   const r=await call('/api/oauth/userinfo','GET',null,null,{authorization:'Bearer '+token.body.access_token})
   assert.equal(r.status,200)
   assert.deepEqual(r.body,{sub:'owner',user_id:'owner',household_id:'primary',
     role:'owner',nickname:'小白',audience:client})
   assert.equal((await exchange(code)).status,400)
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM oauth_access_tokens').get().n,1)
   assert.deepEqual(sqlite.prepare('SELECT event FROM oauth_security_events ORDER BY created_at,event').all().map(x=>x.event),
     ['code_issued','token_exchanged'])
   const eventCols=sqlite.prepare("PRAGMA table_info('oauth_security_events')").all().map(x=>x.name)
   assert.deepEqual(eventCols,['event_id','user_id','client_id','event','created_at'])
 }finally{sqlite.close()}
})

test('wrong PKCE, redirect and browser Origin cannot exchange code or burn valid grant',async()=>{
 const {sqlite,authorize,exchange,call}=database()
 try{
   const grant=await authorize()
   const code=new URL(grant.body.redirect_uri).searchParams.get('code')
   assert.equal((await exchange(code,{code_verifier:'b'.repeat(43)})).status,400)
   assert.equal((await exchange(code,{redirect_uri:'https://evil.example.test/cb'})).status,400)
   const form=new URLSearchParams({grant_type:'authorization_code',client_id:client,
       redirect_uri:callback,code,code_verifier:verifier})
   const browser=await call('/api/oauth/token','POST',form,null,{origin:'https://evil.example.test'})
   assert.equal(browser.status,403)
   assert.equal((await exchange(code)).status,200)
 }finally{sqlite.close()}
})

test('disabled and revoked households lose authorization to identity even with an old token',async()=>{
 const {sqlite,authorize,exchange,call}=database()
 try{
   const member={user_id:'member',household_id:'primary',role:'member',login_name:'test-member'}
   const grant=await authorize(member)
   const code=new URL(grant.body.redirect_uri).searchParams.get('code')
   const token=await exchange(code)
   assert.equal(token.status,200)
   let r=await call('/api/oauth/userinfo','GET',null,null,
     {authorization:'Bearer '+token.body.access_token})
   assert.equal(r.body.nickname,'鸡毛')
   assert.equal(r.body.role,'member')
   sqlite.prepare('UPDATE users SET disabled_at=? WHERE id=?').run('2026-11-13','member')
   r=await call('/api/oauth/userinfo','GET',null,null,
     {authorization:'Bearer '+token.body.access_token})
   assert.equal(r.status,401)
   assert.equal((await authorize(member)).status,403)
   // Removing household membership must not be blocked by in-flight OAuth FKs.
   sqlite.prepare("DELETE FROM household_members WHERE user_id='member'").run()
   assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM oauth_access_tokens WHERE user_id='member'").get().n,0)
   assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM oauth_authorization_codes WHERE user_id='member'").get().n,0)
 }finally{sqlite.close()}
})

test('concurrent token exchanges cannot issue two access tokens for same code',async()=>{
 const {sqlite,authorize,exchange}=database()
 try{
   const grant=await authorize()
   const code=new URL(grant.body.redirect_uri).searchParams.get('code')
   const results=await Promise.all([exchange(code),exchange(code)])
   assert.deepEqual(results.map(r=>r.status).sort(),[200,400])
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM oauth_access_tokens').get().n,1)
 }finally{sqlite.close()}
})
