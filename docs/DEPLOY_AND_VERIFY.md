> **2026-11-12：HomeFlow Preview 已正式弃用。** Cloudflare `homeflow-preview` Worker 与同名 D1 已按用户要求退役，后续只部署 `homeflow` 生产 Worker 与同名生产 D1。开发验证使用本地测试、GitHub CI 和 Wrangler dry-run，**不得再执行 `wrangler deploy --env preview`、创建 Preview D1 或在生产库重放历史迁移**。以下较早的 Preview/Production 双环境流程仅是历史记录，均已失效。

> **2026-11-10 R2 私有相册发布前要求**：只存在一个 `homeflow-family-media` Bucket；其 managed r2.dev Domain 必须 disabled，自定义域名列表为空。生产 `[[r2_buckets]]` 绑定 `MEDIA`；Preview 不绑定（测试保持本机存储），不得公开 Bucket。对两个 D1 分别执行仅一次 `0051_private_media_cleanup.sql` 并登记，校验 media_assets.deleted_at 存在、所有外键有效、原有照片/积分不变，再合并部署。验证 300KiB 上传拒绝、私有与家庭读权限、单张删除与 R2 重试、回收站永久清除、ZIP 云端备份；真机相册与离线问题仍需验收。

> **2026-11-10 新增 08:00 JST 补发检查与通知状态迁移**：生产 Cron 06:00 和 08:00，08:00 不重复结算储值或清理积分；静音成员到 08:00 结束时补发原未送达通知，已发送者不重复，08:00 仍静音则只保留站内。0050 迁移为通知表安全重建，保留所有 ID/已读/去重字段，先 Preview 后 Production 应用并登记，验证外键 0；新代码健康检查要求已完成此迁移。ZIP 只读核对附带本人奖励券与折扣流水，不重发奖励；原有数据库内容及两个成员的安静时间保持不变。

> **2026-11-09 生产/预览最新已核验基线（本轮审查前）**：GitHub main `988372c` 的 Validate 和 Deploy 工作流已成功；Cloudflare Production/Preview 均已部署该版本，各自 D1 已登记 **51/51** 条迁移，最新为 `0049_lottery_balanced_coupons.sql`，`PRAGMA foreign_key_check` 均为 0。生产存在 2 条家庭成员关系、4 条 Push 订阅（不等于实际设备数/通知送达）。继续保留 Issue #4 的真实手机、双账号、离线/ZIP 和家計簿端到端验收。

> **2026-11-09 积分审查修复**：抽奖净收益概览应与钱包/年度流水采用同一口径（含 6 分奖励额外 1 分、免费抽奖券零成本）；一次性任务基础积分说明统一为 5；积分流水使用区分券类型的筛选与名称。上述修复为代码与测试更改，**无新数据库迁移，不补发、不重算历史积分，不重放既有迁移**。合并时仍按 GitHub CI → Preview → Production 健康检查验收。

> **文档历史说明**：下方按 11 月 4–8 日时间顺序留下的「待部署」「当前迁移数」等是当时的状态快照，不代表最新发布状态；以本页顶部基线和最新 GitHub/Cloudflare 部署结果为准。

> **2026-11-08 迁移 0045 / 长旅行双重确认（已执行数据库迁移，Worker 待正式部署）**：`migrations/0045_trip_rewards_no_cap.sql` 仅替换完成旅行的奖励触发器，保留 0044 的历史积分事件及撤销审计；不重算之前已经结算的旅行。超过 30 天时，完成页面及编辑弹窗均会二次确认，服务端要求 `longTripConfirmed: true`；每位参与人每日10分，取消120日计分封顶。已在 Preview 与 Production 按顺序单独应用0045，当前各自登记47/47条迁移、外键异常0、触发器不再含120日上限；代码合并后须继续确认 Preview / Production 健康检查和部署结果。不可重放0044。\n\n> **2026-11-08 / #236 旅行结算迁移 0044（不得重复执行）**：先从 `d1_migrations` 确认生产和 Preview 为 45 条且未存在 `0044_trip_reward_snapshot.sql`；只对 Preview 应用新增的 `migrations/0044_trip_reward_snapshot.sql`，核对 `trip_reward_events`、视图 `trip_completion_rewards` 与两条奖励触发器、外键 0 异常及迁移登记 46/46。再按相同顺序对生产进行非破坏性迁移，最后才合并发布 main，要求 Preview → Production `/api/health` 全绿。迁移时保留已经发出的旧积分，不修改家計簿原账目。正式部署后仍需真实双账号手机检查旅行完成/撤销、积分榜、资金隐私和通知。\n\n> **家庭积分商店 + 双人合力兑换（迁移 0034，必须先应用数据库）**：`migrations/0034_rewards_shop.sql` 是独立的非破坏性迁移，创建 5 个表、7 个索引、4 个触发器。内置 4 种奖励（甜品 100、电影 200、周末大餐 300、家务休息 500），按家庭配置，双账号均可修改库存、价格、上下架或新建奖励。任务积分加上每周完成 10 次的 +30 挑战奖励构成成长经验；消费仅抵扣本人可用积分。支持单人兑换与「合力兑换」，例如 300 分大餐由两个账号分别出 150 分。**只有凑满订单价格才变为待兑现**；未满可取消，所有出资积分全额恢复。库存包含尚未取消的合力预订。所有出资与库存检查在单次 D1 SQL 原子语句中执行，重复请求通过 UUID 幂等键去重；任何用户不能使用别人的可用积分。已满额或已兑现不自动退款。迁移为增量，绝不重放此前迁移、绝不修改家计簿真实支付信息。
>
> 上线顺序：先对 `homeflow-preview` D1 进行 0034 预检 → 应用 SQL → 验证 35/35 迁移、表/索引/触发器、外键异常 0、预设奖励 4×每个家庭 → 记录 Wrangler 迁移名称；再以相同流程处理 `homeflow` Production D1；最后才合并并由 CI 自动执行 Preview → Production 部署和 `/api/health` 断言。真实 iPhone 双账号及家庭兑现操作仍须人工确认。

> **积分等级功能（迁移 0033，发布前必做）**：`migrations/0033_completion_points.sql` 添加新的 `completion_points` 表、一个索引和 10 个完成状态触发器。**先在隔离 Preview 的 D1 运行并登记该迁移，确认 34/34 且实际触发器数量为 10，再对生产 D1 做同样的非破坏性迁移。只有两端都核对通过后才能合并并发布应用代码。** 禁止重放 0001–0032。该迁移不回填任何已有完成记录；之后每完成一次普通任务或一条周期任务当期记录，按实际 `completed_by` 所属账号 +10 分。跳过 0 分、同一次重复无奖励、撤销完成回收积分；硬删除来源时积分清除。家庭榜只包括家庭共享事项，私人积分只有本人可查看。财务结算、生日和购物凭证不自动得家务积分。真实设备验收保留在 Issue #4。

> **PWA 版本更新机制（2026-11-07）**：GitHub 主分支每次发布时，`scripts/stamp-pwa.mjs` 使用本次提交 SHA 给 Service Worker 缓存名加唯一后缀；新的 Service Worker 激活后，已运行新版客户端会提示手动刷新，避免用户正在编辑时被强制刷新。新代码首次进入已长期打开的旧客户端时，可能需要先手动刷新一次；不需要退出账号或重新安装 PWA。此机制需要走 GitHub 发布流程；手动直接执行 Wrangler 时请自行确保缓存版本更新。

> **2026-11-07 更新：当前发布基线**：Preview 与 Production 独立 D1 各已登记 **33/33** 条迁移，最后为 `0032_settlement_origin.sql`，外键异常 0。健康检查要同时验证这条迁移与 `goal_period_settlements.settlement_origin` 实际列，不得把 `0028` 作为完整上线门槛。无需重新执行历史迁移。Production 已有 2 条家庭成员关系、4 条 Push 订阅；Push 服务成功不代表手机真实收到或显示角标。iPhone/iPad 双账号同步、隐私、离线、ZIP 恢复及真实交易关联验收仍未签收；R2 未启用。下方旧快照数字仅作历史参考。

> 2026-11-06：以下按日期记录的 20/23/24 迁移计数属于历史状态；当前只读核验为 Production/Preview 各 27 条。未进行任何重放迁移或生产写入。

# HomeFlow · 实际上线配置与验收（2026-11-06）

## 已核实的资源

- 生产：https://homeflow.yupan6706.workers.dev
- GitHub：`PTamako/homeflow`（私有）；
- Worker：`homeflow`，D1 Binding `DB` → `homeflow`。
- Preview Worker：`homeflow-preview`，D1 Binding `DB` → `homeflow-preview`。
- 2026-11-06 最新数据库校验：Production、Preview 各自独立 D1，`d1_migrations` 都记录 27 条，最新为 0026 购物关联回填，包含 0021 账号恢复表、0022 业务回收箱以及 0025 今日通知表；两份历史前缀为 0009 的迁移仍按文件名独立登记。**严禁重放已应用的历史 ALTER 或旧迁移。**
- `HOMEFLOW_BOOTSTRAP_SECRET` 已在生产 Worker 发现（只验证名称，绝不读取其内容）；生产 D1 已核验到两条家庭成员关系，真实手机双账号验收仍需进行。
- 生产 Cron 为 `0 21 * * *` UTC，即日本时间每日 06:00。
- GitHub Actions 构建、部署实际成功；新版本不自动触碰 `kakebo_jp` D1。

## 1. 首次家庭登录（必须由账号本人完成）

2026-11-06 核验：生产已有家庭及两条成员关系，**不要重复首次初始化**。如果仍需更换家庭成员，应先核对现有登录和邀请码状态。不要发送密钥、密码或会话信息。

创建后在“管理 → 邀请家庭成员”生成一次性邀请码，由另一位家庭成员使用独立登录名、密码加入。两人必须分别测试：私人的待办与回忆不可互看、共享事项可共同查看。

## 2. iPhone/iPad 锁屏 Web Push

1. 在你信任的本地电脑上运行 `node scripts/generate-vapid.mjs`，生成对应的一对 VAPID 密钥。
2. Cloudflare Dashboard → Workers → `homeflow` → Settings → Variables and Secrets，分别以加密 Secret 添加 `VAPID_PUBLIC_KEY` 和 `VAPID_PRIVATE_JWK`。**私钥不要提交 GitHub，也不要发送到聊天。**
3. 将 HomeFlow 从 iPhone Safari 添加到主屏幕，使用主屏幕 PWA 打开，在“管理 → 通知与提醒设置”点击“开启推送”并授权。
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

未启用时，本机照片通过 IndexedDB 保存，并可在“管理 → 备份与恢复”下载包含当前设备照片的 ZIP。清理网站数据或卸载 PWA 可能删除本机照片，请自行保留重要原图。

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
- “管理 → 下载完整本机备份 ZIP”包含当前账号自行创建的服务端数据以及此设备本机照片；不包含密码、登录会话、未同步任务、另一账号私密记录及另一设备独有的照片。
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
- 手动 ZIP 备份按数据集每次 100 条分页导出（单类最多 50,000 条），原旧版一次请求依然保留 500 条保护；每位家庭成员分别备份。

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

## 2026-11-05 最终管理与回收箱发布验收

- 移动端主导航已调整为「今天 / 计划 / 时光轴 / 家庭 / 管理」，不再使用右上角大弹出设置面板。生成邀请码、账号安全、Push、回收箱、备份恢复位于管理页面；家庭页保留成员/宠物与纪念日。
- PR #86 引入 0022_recycle_plans.sql，Preview/Production 的 7 张业务计划表新增 deleted_at，确认两环境均 23 条迁移跟踪；上线流程先 Preview 部署+健康检查再 Production。
- 计划删除不会硬删除原行或关联消费、储值周期结算、旅行进度和回忆照片；管理→回收箱按需每页 5 条查询，只有记录创建者能恢复。旧版硬删除的数据不能从空回收箱恢复，需检查历史 ZIP 备份。
- 便携备份按需分页导出，并保留已删除事项的 deleted_at 状态；恢复只补充缺失记录，不覆盖当前已有数据。
- 一律不因自动化 CI 通过就将真实 iPhone/iPad 通知、双账号、离线、家計簿交易核对或 ZIP 恢复标为真实验收完成；如未同意计费条件，保持 R2 未启用。

## 2026-11-05 · D1 migration tracking repair and low-cost identity check
- Verified independently that both Production and Preview already contained the five-column today_dismissals table with its composite primary key. Inserted *only* the missing migration tracker name, after Preview verification, then Production; both now record 24/24 official migration names. No schema SQL was replayed and no business records were changed.
- Worker health verifies both the physical environment identity and latest migration tracker file name (`0023_today_dismissals.sql`). A per-binding 15-second success-only cache reduces repeated identity reads; missing, mismatched or unrecognized databases fail closed. No user records, sessions, or tokens are cached.
- Updating migrations requires first applying the new migration safely in Preview and Production and then changing the Worker expected migration marker in the same validated release. Running the Worker against a database missing that marker intentionally returns HTTP 503.
