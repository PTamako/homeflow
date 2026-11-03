# Stage 0 · 初始化与验收

## 实际资源

- GitHub：PTamako/homeflow（Private）
- Cloudflare Workers：homeflow；HomeFlow Preview 使用 homeflow-preview
- Cloudflare D1 Production：homeflow
- Cloudflare D1 Preview：homeflow-preview
- 不能绑定 kakebo 或 it-study-platform D1
- 没有订购 R2 / Workers AI 付费服务

## 系统边界

- Vue 3 + TypeScript + Vite，单 Worker 服务静态资产与 API。
- /api/health 仅检测当前环境的 D1 身份标记，不返回私人数据。
- 所有其他 /api 路径始终返回 401，直到独立的身份验证和对象级权限审查通过。
- 生产 / Preview D1 身份由 environment_identity 单独标记，在绑定错误时健康接口失败。
- 用户和家庭相关表在 Stage 0 保持空数据；不开通任意可写 API。

## 手工迁移方案

1. 先在 Preview 环境执行：npx wrangler d1 migrations apply homeflow-preview --env preview --remote
2. 再执行：npx wrangler d1 execute homeflow-preview --env preview --remote --file=scripts/identity-preview.sql
3. 确认该环境返回预览数据库身份正确。
4. 然后才在全新、空的 homeflow 生产数据库执行相同的 0001_core.sql migration 和 production identity 文件。
5. 不要在现有的家計簿和知学平台数据库中执行本项目 SQL。

## 部署

- PR CI：npm run check 和 Wrangler dry-run，不需要 Cloudflare Secret。
- main 部署：需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID 两个 GitHub Actions repository secrets。
- 缺少这些 Secret 时 workflow 应清晰标记部署为 skipped（不能宣称已部署）。
- 手动通过 Cloudflare 连接上传的 Worker 与 GitHub 自动部署是不同验证步骤。

## 尚未完成

- 真实两人登录、权限与家庭数据 CRUD。
- 旅行计划导入、任务引擎、提醒 Cron、Web Push。
- 照片 R2/本地存储、时光轴、存钱目标、家計簿联动。
- iPhone / iPad 真机回归及恢复演练。

阶段 0 的成功只表示基础平台可用，不等于产品功能已上线。
