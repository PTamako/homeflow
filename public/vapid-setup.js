import { generateVapidPair } from './vapid-crypto.mjs'

const generate = document.getElementById('generate')
const publicField = document.getElementById('public-key')
const privateField = document.getElementById('private-key')
const message = document.getElementById('message')
const output = document.getElementById('output')
const reset = document.getElementById('clear')
const setMessage = (value, error = false) => {
  message.textContent = value
  message.classList.toggle('error', error)
}
generate.addEventListener('click', async () => {
  // Discard existing private key from the page before generating a replacement.
  publicField.value = ''
  privateField.value = ''
  output.hidden = true
  generate.disabled = true
  setMessage('正在通过 iPhone 浏览器的加密接口生成密钥…')
  try {
    const pair = await generateVapidPair()
    publicField.value = pair.publicKey
    privateField.value = pair.privateJwk
    output.hidden = false
    setMessage('生成成功。下面两项都必须复制到 Cloudflare；关闭网页后不能恢复，请勿随意重新生成。')
  } catch (err) {
    setMessage(err instanceof Error ? err.message : '生成失败，请重试。', true)
  } finally {
    generate.disabled = false
  }
})
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const target = button.getAttribute('data-copy')
    const field = target === 'public' ? publicField : privateField
    if (!field.value) return
    try {
      await navigator.clipboard.writeText(field.value)
      setMessage(target === 'public' ? '公钥已复制，粘贴到 VAPID_PUBLIC_KEY。' : '私钥已复制，粘贴到 VAPID_PRIVATE_JWK。')
    } catch {
      field.focus()
      field.select()
      setMessage('请长按选中的内容并选择「复制」。')
    }
  })
}
reset.addEventListener('click', () => {
  if (!confirm('确认从此页面清除密钥吗？未保存到 Cloudflare 的密钥将无法找回。')) return
  publicField.value = ''
  privateField.value = ''
  output.hidden = true
  setMessage('本页的密钥内容已清除。')
})
