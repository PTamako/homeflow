# HomeFlow · 我们的小家

专为个人与家庭打造的生活 PWA：个人/共享待办、家人和豆沙档案、生日纪念日与护理、心愿→旅行、ChatGPT 旅行 JSON 导入、行李清单、照片时光轴、储蓄目标和家計簿只读关联。

## 使用地址

- [HomeFlow 生产版](https://homeflow.yupan6706.workers.dev)
- [GitHub Actions](https://github.com/PTamako/homeflow/actions)
- [安全配置与验收](docs/DEPLOY_AND_VERIFY.md)

## 截至 2026-11-04 的实际状态

- 主分支 CI 构建、Node 双账号/隐私/财务/ZIP/旅行测试通过，生产 Worker 和独立 D1 已部署。
- 家庭初始密钥 `HOMEFLOW_BOOTSTRAP_SECRET` 存在，但 **尚未创建任何真实用户或家庭**，请在首页初始化。
- 离线任务支持本机队列、幂等同步和冲突提示；离线仅缓存静态页面，不会绕过登录。
- 本机照片支持多图和 ZIP 打包备份；跨设备云相册需要用户先启用 R2 并绑定 `MEDIA`。
- Web Push 代码与每天日本时间 08:00 的 Cron 已部署；通知需要配置 VAPID Secrets 并在 iPhone 主屏幕应用中同意授权。
- 家計簿只读桥接通过私有 Cloudflare Service Binding 实现（HomeFlow Owner 专属），目标 Worker 不公开 HTTP 地址；不再依赖两边 Secret 的公网请求。最终真人端到端确认仍须完成。
- **以上已部署不等于 iPhone/iPad 双账号、锁屏送达和数据恢复的真机验收。**

## 技术栈

Vue 3 + TypeScript + Vite PWA / Cloudflare Workers + D1；照片以 IndexedDB 本机存储或私有 R2 Bucket 存储，不将照片二进制写入 D1。

## 安全与费用

独立账户、家庭权限、私人记录保护、D1 生产/预览隔离；不共享家計簿 D1，不自动新增消费记录，也不自动开通任何 Cloudflare 付费服务。

## 本地开发

Node.js 22：

```bash
npm install
npm run check
npm run dev
```

部署代码前先检查 D1 迁移（目前 0001–0007 均由 Cloudflare API 手动执行，Wrangler 迁移跟踪未补齐，**不要直接重新执行历史 ALTER**）。主分支经 GitHub Actions 构建后先部署 Preview，再部署 Production。

更多信息： [模块路线](docs/ROADMAP.md)、[旅行 JSON 规则](docs/TRIP_IMPORT.md)、[上线配置与验证](docs/DEPLOY_AND_VERIFY.md)、[真实交付情况](docs/RELEASE_STATUS.md)。
