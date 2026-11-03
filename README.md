# HomeFlow · 我们的小家

家庭、个人、豆沙、旅行、心愿和回忆的一体化生活 PWA。

## 当前阶段

阶段 0：初始化 GitHub、Cloudflare Worker / D1 及基础工程。此仓库暂不包含真实家庭数据。

## 安全边界

- 私有仓库；禁止提交密码、API Token、家庭照片或财务明细。
- Cloudflare Production 与 Preview 使用不同的 D1 数据库。
- 所有个人 API 默认拒绝访问，直到实现并验证认证授权。
- 不直接读取或修改 `kakebo_jp` 数据库；后续通过最小权限的独立 API 联动。
- 生产 D1 仅执行经验证的增量迁移。

详细开发说明随第一阶段脚手架 PR 提交。