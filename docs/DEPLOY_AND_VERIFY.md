# HomeFlow · 实际上线配置与验收（2026-11-04）

## 已核实的资源

- 生产：https://homeflow.yupan6706.workers.dev
- GitHub：`PTamako/homeflow`（私有）；
- Worker：`homeflow`，D1 Binding `DB` → `homeflow`。
- Preview Worker：`homeflow-preview`，D1 Binding `DB` → `homeflow-preview`。
- 生产/预览数据库已完成迁移 0001–0007（REST API 手动顺序执行）。**Wrangler 的迁移日志与实际状态不一致，未经重新核对不要重放 0001–0007。**
- `HOMEFLOW_BOOTSTRAP_SECRET` 已在生产 Worker 发现（只验证名称，绝不读取其内容）。
- 生产 Cron 为 `0 23 * * *` UTC，即日本时间每日 08:00。
- GitHub Actions 构建、部署实际成功；新版本不自动触碰 `kakebo_jp` D1。

## 1. 首次家庭登录（必须由账号本人完成）

生产 D1 目前尚无家庭/用户记录。打开首页，选择“创建我们的家”，自行设置登录名、≥12 位密码、昵称、家庭名称；在表单中输入你已设置的 `HOMEFLOW_BOOTSTRAP_SECRET`，创建 Owner。**不要把启动密钥、登录密码发送到聊天、GitHub 或截图。**

创建后在“家庭”页面生成一次性邀请码，由另一位家庭成员使用独立登录名、密码加入。两人必须分别测试：私人的待办与回忆不可互看、共享事项可共同查看。

## 2. iPhone/iPad 锁屏 Web Push

1. 在你信任的本地电脑上运行 `node scripts/generate-vapid.mjs`，生成对应的一对 VAPID 密钥。
2. Cloudflare Dashboard → Workers → `homeflow` → Settings → Variables and Secrets，分别以加密 Secret 添加 `VAPID_PUBLIC_KEY` 和 `VAPID_PRIVATE_JWK`。**私钥不要提交 GitHub，也不要发送到聊天。**
3. 将 HomeFlow 从 iPhone Safari 添加到主屏幕，使用主屏幕 PWA 打开，在“今天”点击“开启锁屏通知”并授权。
4. 创建一个真实到期事项，核实当日 08:00 JST 的通知与应用内提醒均可见。

尚未配置 VAPID 时推送会安全禁用；Cron 的存在不代表已经发送过通知。

## 3. 私有云照片（R2 仍未启用）

截至检查时，Cloudflare R2 API 返回 `10042 Please enable R2 through the Cloudflare Dashboard`。请先自行确认启用要求和结算条款，不能通过本项目自动付费。

若决定启用：
1. Cloudflare → R2 → 创建 **私有** Bucket，例如 `homeflow-private-photos`（不要配置公开域名）。
2. 在 `wrangler.toml` 中为生产 Worker 增加：
   ```toml
   [[r2_buckets]]
   binding = "MEDIA"
   bucket_name = "homeflow-private-photos"
   ```
3. Preview 应绑定另外一个**独立**的测试 Bucket，或继续不启用 Preview 图片上传。
4. 部署后在两台设备测试私人/共享回忆照片的访问控制、上传、删除和容量限制。
5. R2 费用额度、滥用与备份策略请在启用前确认。

未启用时，本机照片通过 IndexedDB 保存，并可在“家庭 → 备份与恢复”下载包含当前设备照片的 ZIP。清理网站数据或卸载 PWA 可能删除本机照片，请自行保留重要原图。

## 4. 家計簿只读联动（Cloudflare 私有 Service Binding）

生产 HomeFlow Worker 使用 `KAKEBO_LEDGER_SERVICE` → `kakeibo-homeflow-bridge` 私有服务绑定，**不再通过公开 `pages.dev` URL 获取明细**。

- 桥接 Worker 的 `workers.dev`、Preview URL 均已关闭，也不设公开路由。
- 桥接 Worker 单独绑定生产家計簿 D1，只允许 `GET /api/homeflow-ledger`，单页最多 50 笔、每次日期最多 90 天，只返回六个字段。
- HomeFlow 仅 Owner 可以请求真实支出，只有经过明确确认的外部 ID 被保存到 HomeFlow D1；私人事项和其他账户仍受登录及权限控制。
- HomeFlow Preview 没有该 Service Binding；不会读取生产账本。无需给 HomeFlow 直接绑定家計簿 D1。
- 先前在 Pages `HOMEFLOW_LEDGER_READ_TOKEN`、HomeFlow `KAKEBO_LEDGER_READ_TOKEN` 设置的两个 Secret 用于旧公网接口；**内部服务绑定方式不再传送这两个 Secret**。可保留它们，不会影响新功能。
- 安全来源代码与测试：`PTamako/kakebo_jp` 的 `workers/homeflow-service-bridge.js` 和 `wrangler.homeflow-bridge.toml`。

上线验收：Owner 在“计划 → 家計簿”选择旅行/目标和日期范围，查出家計簿实际支出，逐笔确认关联；测试后检查取消关联不影响家計簿原账目。未完成真人端到端验收前，不要声称联动完全可用。

## 5. 离线、数据导出及恢复

- 离线新增待办先保存到当前设备 IndexedDB，恢复网络后用幂等请求 ID 同步；编辑前检测更新版本，出现冲突时不自动覆盖另一台设备修改。
- “家庭 → 下载完整本机备份 ZIP”包含当前账号自行创建的服务端数据以及此设备本机照片；不包含密码、登录会话、未同步任务、另一账号私密记录及另一设备独有的照片。
- 恢复前先服务端验证，按依赖顺序分批导入，已存在 ID 不覆盖；中断可重试。ZIP 最大约 55 MB；超过上限请先单张导出照片。
- 因为数据可能保存在不同设备、账户，**夫妻两位需要分别备份**，每台设备的本机照片应分别保存。真正完整的跨设备照片备份仍需启用云相册并验收。

## 6. 最终验收门槛

- [x] GitHub CI、D1 0001–0007 迁移、生产部署与两套 DB Binding。
- [x] 单元/真实 SQLite 双账号私人/共享权限、离线幂等、数据恢复和照片 API 权限测试。
- [ ] 真人首次创建 Owner + 邀请第二位家人 + 两人相互隐私隔离实测。
- [ ] iPhone/iPad PWA 安装、离线恢复、页面布局和备份恢复实测。
- [ ] VAPID Secret 配置、Web Push 手机授权与实际送达。
- [ ] R2 账号启用/桶绑定和跨设备私有图片验收（如用户选择启用）。
- [ ] 家計簿私有 Service Binding 的真实交易 ID 关联与取消关联验收。

**CI 绿灯不能替代上述真机、授权或第三方资源启用。**
