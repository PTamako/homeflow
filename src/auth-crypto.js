/** Browser-based PBKDF2-SHA256 protocol v1.
 * Exactly 100000 iterations; Worker never receives plaintext passwords.
 * The derived 32-byte proof is transmitted only over same-origin HTTPS.
 */
export const PASSWORD_ROUNDS=100000
const enc=new TextEncoder()
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')
const fromHex=(value)=>{
  if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))throw new Error('invalid_password_salt')
  return Uint8Array.from(value.match(/../g),x=>Number.parseInt(x,16))
}
export function validLocalPassword(value){
  return typeof value==='string'&&value.length>=12&&value.length<=128&&enc.encode(value).length<=300
}
export async function derivePasswordProof(password,saltHex){
  if(!validLocalPassword(password))throw new Error('invalid_password')
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits'])
  const proof=await crypto.subtle.deriveBits({
    name:'PBKDF2',hash:'SHA-256',salt:fromHex(saltHex),iterations:PASSWORD_ROUNDS},key,256)
  return hex(new Uint8Array(proof))
}
export async function registerPassword(password){
  const salt=hex(crypto.getRandomValues(new Uint8Array(16)))
  return {passwordProof:await derivePasswordProof(password,salt),
    passwordSalt:salt,passwordRounds:PASSWORD_ROUNDS}
}
export async function loginPassword(loginName,password){
  if(!validLocalPassword(password))throw new Error('invalid_password')
  const url='/api/auth/login-challenge?loginName='+encodeURIComponent(loginName.trim().toLowerCase())
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'})
  const body=await response.json().catch(()=>null)
  if(!response.ok)throw new Error(body?.error||'login_challenge_unavailable')
  if(body?.protocol!=='pbkdf2-sha256-client-v1'||body?.rounds!==100000)
    throw new Error('login_challenge_unavailable')
  return {passwordProof:await derivePasswordProof(password,body.salt)}
}
