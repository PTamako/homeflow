# HomeFlow · 我们的小家

家庭、个人、豆沙、旅行、心愿和回忆的一体化生活 PWA。

## 当前进度：Stage 0

- Vue 3 + TypeScript + Vite 前端骨架。
- Cloudflare Worker + 独立生产、预览 D1 数据库。
- 安全默认：个人 API 在完整登录与权限验证完成之前一律返回 401。
- 初始数据库 schema、回归测试与 GitHub Actions CI。
- 当前尚未开放真实家庭数据、用户注册、照片上传与推送通知。

## 本地

要求 Node.js 22.16+。使用 npm install、npm run dev、npm run check 检查前端。
Worker 可通过 npm run worker:dev 启动（先完成本地迁移与数据库身份配置）。
部署使用 npx wrangler deploy；预览使用 npx wrangler deploy --env preview。

## 安全边界

- 生产 D1：homeflow；预览 D1：homeflow-preview。
- 不重用家計簿 / 知学平台的登录凭据或数据库。
- 不提交任何密码、Token、家庭照片、实际交易、R2 密钥。
- Cloudflare Secret 需由 GitHub 仓库管理员配置，尚未配置时部署 CI 会明确跳过。
- 生产 migration 必须先在 Preview 验证。
- 目前公开仅有不含个人数据的健康接口和基础静态界面。

参见 docs/STAGE_0.md 和 docs/ROADMAP.md。
