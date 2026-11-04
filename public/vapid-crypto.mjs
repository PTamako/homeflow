// Browser-only helper. No network, cookies, analytics, or persistent storage.
const encodeBase64url = (bytes) => btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

/** Produce a fresh P-256 VAPID key pair on this device; no private key leaves memory. */
export async function generateVapidPair(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.generateKey) throw new Error('当前浏览器无法安全生成密钥，请使用 iPhone Safari（HTTPS）')
  const pair = await cryptoApi.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await cryptoApi.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await cryptoApi.subtle.exportKey('raw', pair.publicKey))
  if (raw.length !== 65 || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) {
    throw new Error('生成的密钥格式校验失败')
  }
  const publicKey = encodeBase64url(raw)
  // Verify keypair on-device before it is offered to the user.
  const sample = new TextEncoder().encode('HomeFlow VAPID self-check')
  const signature = await cryptoApi.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, sample)
  if (!(await cryptoApi.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, signature, sample))) {
    throw new Error('密钥配对验证失败，请重新生成')
  }
  return { publicKey, privateJwk: JSON.stringify(jwk) }
}
