> **最新整改 PR #236 · 2026-11-08**：旅行积分按实际完成事件冻结，每人每天10分，最长按120天计分；支出汇总可供共享旅行参与人查看，但家計簿明细仍仅管理员可操作。新 D1 迁移 0044 需要先在 Preview、再在 Production 应用并通过验证，不能重放旧 SQL。当前自动化结果以 GitHub Actions 为准，双账号 iPhone 实机与 Push 锁屏效果仍待验收。\n\n> 2026-11-06 最新验收：PR #148 已通过 CI、Preview → Production 部署和双环境健康检查；D1 均记录 29 条迁移，必需索引一致。真实 iPhone/iPad 双账号、通知横幅和 ZIP 恢复仍需设备端验证，详见 Issue #4。\n\n# HomeFlow · 我们的小家

专为个人与家庭打造的生活 PWA：个人/共享待办、家人和豆沙档案、生日纪念日与护理、心愿→旅行、ChatGPT 旅行 JSON 导入、行李清单、照片时光轴、储蓄目标和家計簿只读关联。

## 使用地址

- [HomeFlow 生产版](https://homeflow.yupan6706.workers.dev)
- [GitHub Actions](https://github.com/PTamako/homeflow/actions)
- [安全配置与验收](docs/DEPLOY_AND_VERIFY.md)

## 截至 2026-11-04 的实际状态

- 主分支 CI 构建、Node 双账号/隐私/财务/ZIP/旅行测试通过，生产 Worker 和独立 D1 已部署。
- 生产 D1 已有真实家庭和 Owner 初始化记录，**不要重复执行首次初始化或清空现有家庭数据**；第二位家人请使用独立账号和邀请加入。
- 离线任务支持本机队列、幂等同步和冲突提示；离线仅缓存静态页面，不会绕过登录。
- 本机照片支持多图和 ZIP 打包备份；跨设备云相册需要用户先启用 R2 并绑定 `MEDIA`。
- Web Push VAPID Secrets 和每天日本时间 06:00 的 Cron 已配置；可按账号/单项设置提前 0/1/3/7 天、重要级别、指定日期延后及可选安静时段。安静时段默认关闭，真实锁屏送达仍需 iPhone 主屏幕 PWA 验收。
- 家計簿只读桥接通过私有 Cloudflare Service Binding 实现（HomeFlow Owner 专属），购物可关联多笔消费、逐笔解除；绝不写入家計簿原始账目。退款的真实原单关系及专用储值资金证明仍未实现，参见 Issues #53、#54。
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

部署代码前先检查 D1 迁移：历史 0001–0013 中多项曾通过 Cloudflare API 手动执行，0014/0015 也分别已在 Preview 与 Production 安全应用且核对。Wrangler 迁移追踪未必同步，**禁止直接重放旧迁移或对已有数据库执行批量 ALTER**。新变更必须先完成 CI、Preview D1 安全迁移检查，再核对 Production D1，最后由 GitHub Actions 先 Preview 后 Production 发布 Worker。

更多信息： [模块路线](docs/ROADMAP.md)、[旅行 JSON 规则](docs/TRIP_IMPORT.md)、[上线配置与验证](docs/DEPLOY_AND_VERIFY.md)、[真实交付情况](docs/RELEASE_STATUS.md)。

## 最近交付与未完成事项

- [PR #47](https://github.com/PTamako/homeflow/pull/47)：心愿与一次性储值的可选目标日期、完成记录 ZIP 恢复；家庭净收支估算不等于真实专用储蓄。
- [PR #48](https://github.com/PTamako/homeflow/pull/48) 和 [#52](https://github.com/PTamako/homeflow/pull/52)：多笔真实购物支出关联、逐笔解除、连续选择和局部刷新。
- [PR #49](https://github.com/PTamako/homeflow/pull/49)：账户级明天再提醒。
- [PR #50](https://github.com/PTamako/homeflow/pull/50)：完成心愿和旅行后主动整理为私人回忆，服务端禁止私人计划信息泄漏到家庭共享回忆。
- [PR #51](https://github.com/PTamako/homeflow/pull/51)：用户主动查询月度计划回顾，一次 D1 批处理，不使用 Kakebo 或定时写入。
- 仍需实现或真实设备验收：[专项储值 #53](https://github.com/PTamako/homeflow/issues/53)、[真实退款/部分购买 #54](https://github.com/PTamako/homeflow/issues/54)、[高级提醒 #55](https://github.com/PTamako/homeflow/issues/55)、[低成本验收与迁移追踪 #56](https://github.com/PTamako/homeflow/issues/56)、[iPhone/iPad 真机 #4](https://github.com/PTamako/homeflow/issues/4)。
