# HomeFlow · 实际上线配置与验收（2026-11-05）

## 已核实的资源

- 生产：https://homeflow.yupan6706.workers.dev
- GitHub：`PTamako/homeflow`（私有）；
- Worker：`homeflow`，D1 Binding `DB` → `homeflow`。
- Preview Worker：`homeflow-preview`，D1 Binding `DB` → `homeflow-preview`。
- 生产与预览 D1 的主要结构已核实至 0015：0013 完成确认表、0014 多笔购物关联表/索引/旧关联兼容触发器、0015 用户延后提醒表/索引均已在实际环境检查。历史存在两份 0009 迁移；**曾通过 Cloudflare API 手动执行 SQL，Wrangler 迁移记录未必同步，绝不对已有 D1 批量重放历史 ALTER 或旧迁移。**
- `HOMEFLOW_BOOTSTRAP_SECRET` 已在生产 Worker 发现（只验证名称，绝不读取其内容）；生产 D1 已有 1 个家庭和 1 个用户。
- 生产 Cron 为 `0 21 * * *` UTC，即日本时间每日 06:00。
- GitHub Actions 构建、部署实际成功；新版本不自动触碰 `kakebo_jp` D1。

## 1. 首次家庭登录（必须由账号本人完成）

截至 2026-11-04，生产 D1 已有 1 个家庭和 1 位用户，**不要重复首次初始化**。现有 Owner 可以登录并生成第二位家人的邀请码。不要发送密钥、密码或会话信息。

创建后在“家庭”页面生成一次性邀请码，由另一位家庭成员使用独立登录名、密码加入。两人必须分别测试：私人的待办与回忆不可互看、共享事项可共同查看。

## 2. iPhone/iPad 锁屏 Web Push

1. 在你信任的本地电脑上运行 `node scripts/generate-vapid.mjs`，生成对应的一对 VAPID 密钥。
2. Cloudflare Dashboard → Workers → `homeflow` → Settings → Variables and Secrets，分别以加密 Secret 添加 `VAPID_PUBLIC_KEY` 和 `VAPID_PRIVATE_JWK`。**私钥不要提交 GitHub，也不要发送到聊天。**
3. 将 HomeFlow 从 iPhone Safari 添加到主屏幕，使用主屏幕 PWA 打开，在“今天”点击“开启锁屏通知”并授权。
4. 创建一个真实到期事项，核实当日 06:00 JST 的通知与应用内提醒均可见。

生产 Worker 已有 VAPID 公私钥 Secret 绑定，之前检查到 1 条 Push 订阅；本次未独立验证其仍然有效或锁屏通知实际送达。请用真实到期提醒确认。

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

- [x] GitHub CI、生产/预览 D1 字段和表结构核验、部署以及相互隔离的 DB Binding。
- [x] 单元/真实 SQLite 双账号私人/共享权限、离线幂等、数据恢复和照片 API 权限测试。
- [x] 生产环境已完成首位 Owner 初始化（D1 已有 1 个用户）。
- [ ] 邀请第二位家人、双账号私人与共享数据隔离实测。
- [ ] iPhone/iPad PWA 安装、离线恢复、页面布局和备份恢复实测。
- [x] VAPID Secret Binding 和 1 条推送订阅已存在。
- [ ] Web Push 实际到期提醒送达及故障验收。
- [ ] R2 账号启用/桶绑定和跨设备私有图片验收（如用户选择启用）。
- [x] HomeFlow 已绑定无公共 workers.dev 入口的内部家計簿桥接 Worker，预览环境未绑定。
- [ ] 家計簿真实交易关联和取消关联的端到端验收。

**CI 绿灯不能替代上述真机、授权或第三方资源启用。**

## 7. 2026-11-04 审查修复与迁移守则

- PR #35 处理登录与时光轴闪现、可移植备份完整性、任务分页、共享账目权限以及 CI 发布检查。
- 迁移清单包括历史两个前缀为 0009 的文件；本地 SQLite 验证不会访问或写入 D1。
- 部署后的 /api/health 检查只核对环境身份，不创建或修改家庭记录；它不代替 iPhone/iPad、Push 或账目真实验收。
- 可移植备份单数据集上限 500 条，超过上限会明确返回错误而非截断；每位家庭成员分别备份。

## 8. 2026-11-04 本轮安全发布及仍需人工确认

- PR #47–#52 见 [交付状态](RELEASE_STATUS.md)；所有 PR 必须经过独立分支 CI 和 main 上先 Preview 后 Production 的自动部署。
- 迁移 0014（购物多笔关联）及 0015（用户级提醒延后）已分别通过 Cloudflare D1 API 在 Preview 和 Production 预检、应用、核实名称/索引；两套 DB 旧单笔关联缺失数量检查为 0。此次迁移没有删除或清空任何真实记录。
- 手工执行迁移后不得推断 Wrangler 的迁移追踪已经同步。后续新迁移应先核实实际 schema 和历史迁移元数据，**禁止在生产 D1 重放旧 SQL**。见 [Issue #56](https://github.com/PTamako/homeflow/issues/56)。
- 真实银行专项储值不可使用家庭净收支模拟证明（[Issue #53](https://github.com/PTamako/homeflow/issues/53)）；退款原消费关系没有数据契约时必须人工核实（[Issue #54](https://github.com/PTamako/homeflow/issues/54)）。
- iPhone/iPad、第二位家庭账号、06:00 Web Push 实际送达、完整 ZIP 恢复与照片跨端同步仍保留原本的未勾选事项，详见 [Issue #4](https://github.com/PTamako/homeflow/issues/4)。

## 2026-11-05 增量迁移与发布

1. 0021_account_recovery.sql 是独立新增的恢复码哈希表，已先验证 Preview 的结构和迁移登记，再应用到 Production；两个环境的 d1_migrations 均为 22 条。
2. 没有重放 0001–0020 历史迁移，没有修改现有用户凭据或业务账目。
3. 恢复码须由用户本人登录、校验当前密码后主动生成和离线保存。恢复码无法从服务器再次取回，单码仅能使用一次。
4. 未绑定身份验证的邮箱地址不构成账户恢复凭证。
5. CI、Preview 部署、Preview 环境健康检查、Production 部署和 Production 环境健康检查已通过。真机、锁屏通知和第二位家庭成员仍需实际操作确认。
