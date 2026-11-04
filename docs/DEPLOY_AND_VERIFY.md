# HomeFlow · 安全配置与上线验收

## 已有资源
- GitHub 私有仓库 PTamako/homeflow；Cloudflare Worker homeflow（生产）和 homeflow-preview（预览）。
- 独立 D1 homeflow 与 homeflow-preview；实际建表并校验外键。
- 本项目不需要 Cloudflare Workers AI 付费服务，也不会写入家計簿数据库。

## 第一个账号：Bootstrap
HomeFlow 初始无默认密码、无预置家庭账号。首次使用前，用户在 Cloudflare Workers → homeflow → Settings → Variables and Secrets 新建 encrypted Secret，名称 HOMEFLOW_BOOTSTRAP_SECRET，值为至少 32 字符的安全随机字符串。生产与预览不要复用。
可在你自己的本地终端运行：node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
不要把这个值放入聊天、GitHub PR、仓库文件。然后在 HomeFlow 首页输入密钥创建 Owner。两人登录账号不共用密码；Owner 创建一次性邀请码给第二人。

## Web Push（PWA 锁屏提醒）
- 需要 VAPID_PUBLIC_KEY 和 VAPID_PRIVATE_JWK 两个 Cloudflare Worker Secret；目前代码缺失时会安全禁用推送。
- 在本地运行 node scripts/generate-vapid.mjs，根据终端输出分别设置 Secrets；不要复制私钥到仓库或聊天。
- 生产 Cron 默认 UTC 23:00，也就是日本时间 08:00；预览 Cron 关闭。
- iPhone/iPad 需将 HomeFlow 添加至主屏幕，然后在应用内点击开启锁屏通知并授权。
- Web Push 必须用真实手机订阅测试；自动化加密测试不等于已送达。

## 图片存储
- R2 当前账号尚未启用；本机 IndexedDB 相册可保存多张压缩照片，并单张导出。
- 若启用 R2，需要自行确认计费条款并将私有 Bucket 绑定为 MEDIA。未配置前，云照片接口返回 503，不会将照片存 D1。
- 移除本机应用或清理 Safari 网站数据可能删除本地照片；重要照片请保留原图或及时导出。

## 家計簿联动
- 当前仅有目标金额、预留金额与 finance_links 数据模型，不表示已自动同步家計簿真实支出。
- 只有在家計簿另行提供有明确授权的最小权限只读 API 后才能自动联动；不允许直接绑定其生产 D1 或共享会话 Cookie。

## 回归验收
- GitHub PR 自动测试包括真实 SQLite 两人家庭权限、官方祝日工作日排除、旅行格式解析与 AES128GCM Push 加密。
- Cloudflare Worker 与 D1 独立环境检查必须通过；生产迁移先在预览验证。
- iPhone Safari/主屏幕、iPad、离线编辑和相册恢复仍需真机验证；权限、数据恢复、锁屏投递不能只凭 CI 绿色就标记完成。
- D1 迁移 0001–0006 当前通过 Cloudflare API 按顺序应用；Wrangler 的 d1_migrations 跟踪表尚未补齐，不要贸然从头运行 wrangler d1 migrations apply --remote。
