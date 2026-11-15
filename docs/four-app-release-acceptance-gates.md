# 四应用统一账号与家庭金融审批：正式上线验收门禁（2026-11-15）

**当前状态：PRE-DEPLOY NO-GO（生产部署准备尚未完成）。** G2 两台真实 iPhone 与部分 G7 真实流水闭环必须在四个生产 PWA 已可访问后验收，**不得再将“尚未部署所以没有真机结果”本身列为生产部署的前置阻断**。正式发布成功仍需要全部 G0～G9 通过。完整发布的其他部署前安全门禁仍严格有效，已上线旧业务不受影响。详见下方 §111。

| 门禁 | 当前结论 | 可接受的验收证据 |
|---|---|---|
| G0 代码/CI | 四仓 Draft 分支的最新 CI 通过；不能视为上线 | 对每个最终 commit SHA 保留完整 Actions Run、负向权限/回滚测试日志、WebKit 自动化 |
| G1 生产 D1/R2 | **未开始新迁移**；A 阶段用户已完成加密备份及本地恢复 | 上线当日重新验证 4 D1 + 3 R2 不可变备份、SHA-256、恢复计数、外键、对象键、恢复日志及保留期限 |
| G2 双人身份和 PWA | **正式上线验收待生产部署后完成**；部署前仍需自动化身份/隔离/安全回归通过 | 两个真实 HomeFlow 用户分别使用 Safari、两个安装态 PWA：PKCE/nonce、Safari 回跳、断网重入、切换 Cookie、登出、iOS WebKit 清缓存、同时登录、私有数据互不显示；记录设备/iOS版本/屏幕证据及实际响应码 |
| G3 账户与家庭权限 | **不通过**：新金融模型仍 Draft | owner/member/另一个 household 的读/写/审批/撤回/恢复/附件隔离矩阵：拒绝应为 401/403/409，旧离线队列不能被新用户重放 |
| G4 账目与资产 | **部分内部完成**；不能视为全部合法转账 | 明确现金、银行、证券现金、基金份额、可兑现储值卡、不可兑现点数/储值余额的资产类型和支持路径；每条跨成员路径有双方真正事后流水、owner 单独授权、账户版本 CAS、负余额拒绝、不可变双边账、故障回滚、原 ID 重试和重复流水防护 |
| G5 批量执行 | **部分内部完成**：HomeFlow 最多 10 个原 ID 顺序执行，非分布式原子 | 每个执行结果原 K journal 只读核验、丢包暂停/恢复、失败不重发新 ID；界面明确已成功项不会因后续失败撤销，不能宣称跨 K/H 的全有或全无 |
| G6 历史共享账目 | **不通过（内部 D1/R2 复制→采用链已具备）**：§103/104 已有原 owner 单行 SHA/CAS、0056 原字节私有复制 staging、0057 单库原子 claim+墓碑+审计、CRUD 和真实 SQLite 故障回滚；生产数据、旧客户端在途写入排空、最终源对象清理、成员已审批修改、双实体 iPhone 等尚无验收证据 | 原行 SHA/owner/版本、附件 R2 键与墓碑、明确逐行同意、合法 adopted registry、不可变审计；更新/删除/恢复及竞争写入必须在 K D1 原事务全回滚且不重复财务计数 |
| G7 金融机构对账 | **机构级最终验收待完成**；正式文件可在部署前取得，生产内部流水对齐须部署后验证 | 银行/券商/积分发行方原始可信文件或授权只读 API；机构 ID、发生/入账日期、货币、金额、账户、交易号、基金份额/成本、撤销或退款、对账批次 hash；双人独立确认但不能冒充机构证明 |
| G8 部署环境与运行安全 | **不通过**：尚未全面验证 Stage F Secrets/Service Bindings/Pages | 全量正式 bindings/Flags/权限/迁移顺序预检；只启用明确批准功能；不要新建 Preview；验证 Cron 关闭、KV/R2/D1 无多余计费资源，Workers AI 限额、失败恢复和审计 |
| G9 回滚与最终签署 | **部署前演练及发布授权待完成；正式成功签署在双机/机构验收之后** | 先完成隔离环境实恢复，正式发布窗口、负责人、回滚触发阈值、正式两人确认及用户明确发布授权；不直接运行 remote migration |

## G2 具体回归矩阵

四 PWA：HomeFlow、家計簿、知学、文书助手。每个安装态 App 均须覆盖两个家庭身份 A/B，至少以下 10 个连续情境：A 登录→A 数据读取；A 离线提交合法非金融任务→B 登录→不可重放 A 操作；A 断网后恢复→仍正确 A；A 登出→私人本地视图和 R2/Gmail/Drive 缓存隐藏；B 登录→仅 B 可见；A/B 同时各自操作共享家庭内容→权限可解释；Safari OAuth 回跳→原发起 PWA 持有 state/resume secret；错误 PKCE/state/nonce/callback→拒绝；Cookie 撤销/过期→不显示旧人信息；切换家庭/后台→所有在途响应不得回写旧私有状态。

金融操作在断网时禁止静默入列。对任何真实银行/SBI/积分对账必须留证据与异常报告，不采纳纯截图/内部 owner 声明作为“金融机构已核验”。两台 iPhone 真机验收属于独立手动门禁；Cloudflare/GitHub 模拟不可替代。

## G7 数据证据最低规范

仅在用户批准的账户与范围内获取经官方可验证的原始 CSV/PDF/只读 API，保存私有隔离空间，记录来源、下载/签发时间、SHA-256 与导入批次。逐条对比内部 immutable journal，标记 `matched` / `unmatched` / `amount_or_date_conflict` / `duplicate_reference` / `reversal_required`。对账失败或无可验证来源，一律保持 `institution_reconciled=false`；不能因此自动补写、删除或“冲正”真实原账。

### 当前阻碍与实施原则

没有连接官方银行、SBI 证券和积分发行方的可验证流水渠道，故 G7 本轮无法完成。账户秘密、密码或 API Token 不得写入 GitHub/日志。用户已确认的 A 加密备份并非新版本数据库真实迁移验收。五个功能 PR 保持 Draft/Open；任何正式发布、功能 Flag、Secret、D1、R2、Worker 或 Cron 变更都须另行获得用户明确授权。

## §103 迭代证据（仍 NO-GO）

家計簿 Draft #309 `1c3a3bd23ad81459010b3e64c4a7336887e78a35`：migration 0055 未执行、前置开关默认 OFF，原 owner 明确逐笔确认，原账不重计，已采用账有新 registry/Audit/原行 CAS、管理员修订/删除/恢复与真实 SQLite 测试。Validate 43711687967 completed/success；Mobile WebKit 43711688014 在该记录时尚未确认完成。旧数字 receipts/v1 路径的 PUT/GET/DELETE 和 bulk delete 对 adopted ID 已建立拒绝，但**旧 R2 真正存在的票据一律阻断而非迁移**，R2 HEAD 与旧 PUT 并发冻结及跨 D1/R2 失败恢复待独立实现/验收。两台实体 iPhone、真实 HomeFlow/Google OAuth、owner→member 银行双边执行、外部金融官方对账、正式部署/回滚批准均缺证据，所有门禁整体 NO-GO。文档更新是 docs-only，不授权任何生产动作。

## §104 旧历史 R2 复制与采用证据（持续 NO-GO）

家計簿 Draft #309 `03b6e487bb39ba0f6614a3ff978ca123ea75e003`，新增**未执行** migration 0056 和 0057、原 owner 三步明确确认、R2 原字节/etag/size/MIME/SHA-256 独立核验、来源证明绑定与可恢复 copy、家計簿单 D1 原子 registry+private attachment+legacy tombstone+claim immutable audit。旧 R2 原件仍保留，旧数字 endpoint 已拒绝已 adopted ID 和 bulk/cleanup 对应删除。真实 SQLite 故障注入验证 registry/attachment/tombstone/journal 同事务回滚；final Validate Run `43713936966` success，Mobile WebKit Run `43713936986` completed/success（WebKit 自动化，不是实体双机）。**这不是跨 D1/R2 ACID，不是生产迁移，也不等于正式 G6 通过**。禁止自动开启冻结/复制/采用 flags；需要 F 阶段单独授权、旧客户端在途请求 drain、R2 最终源清理前引用计数、两 iPhone 真实 OAuth/权限、正式回滚和全部 G0～G9 签署。SBI/银行/积分发行方官方级核对依然缺证据；整体持续 NO-GO。


## §110 后新增的 G6/G7/G8 可验证实现（仍 NO-GO）

- **G6 增量，不是全局通过**：家計簿 #309 未部署 migration `0059_legacy_shared_receipt_repair.sql` 及受控 `legacy/shared-receipt-repair` API。只有原 owner、原不可变采用/复制/claim、历史旧源墓碑、原 R2 对象的完整 SHA-256/ETag/大小/MIME 与引用关系同时验证后，才能使用已冻结旧写入且默认 OFF 的 `KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED` 明确按笔恢复**缺失**副本；对象已有冲突绝不覆盖，R2 PUT 前先有不可变 D1 pending request，同原 ID 掉包后可安全重试，源 R2 永不删除。针对性 SQLite 和 R2 故障测试由真实家計簿 Validate 覆盖，**但生产旧客户端 drain、最新备份、真正源永久清理、回滚与两实体 iPhone 仍未通过**。
- **G7 增量，不是机构证据**：家計簿 `scripts/official-evidence-match.mjs` 及其测试提供银行/SBI/积分原始证据摘要绑定、不可变流水精确参考比对、金额/日期冲突、重复、缺失、冲正、SBI 份额与成本比较；没有直接银行/SBI/积分发行方官方授权连接，没有已验证真实交易来源，函数始终返回 `institution_reconciled=false`。已在私人 Google Drive 发现 `SBI.pdf`，核查后确认**它是包含初始登录/交易凭据的开户通知，并非买付/成交记录**，不能用于 G7；已提醒用户检查文件分享并更新仍有效凭据。不得写入文件中的任何密码、账号、交易口令或原始内容到 GitHub。
- **G8 增量，不代表已配置**：HomeFlow #306 新 `scripts/release-g8-binding-preflight.mjs` 可在独立受控运行环境中通过 Cloudflare 只读 GET 比较正式 HomeFlow、知学、文书和家計簿 Pages 必需绑定的名称、类型；测试验证缺项、错误 Service Binding 类型、上游 403 和不复制 secret 明文。即使无缺项，也明确不可据此宣称 Secret 值、OAuth redirect allowlist、正式 Migration、两台 iPhone、金融机构或 G9 已验证。**实际生产目前缺必需新配置；不能提前启用。**
- **验收状态**：本节软件/SQLite/WebKit/模拟 Service Binding 证据仅计相应自动测试；G1、G2、G3～G7 全量、G8 真正环境可用性与 G9 未签署；禁止错误将实现代码、源 PDF 或纯绿色 CI 当作正式上线批准。


## §111 发布前与生产部署后双机验证顺序（2026-11-15，澄清循环依赖）

用户已明确：本人及丈夫的两台 iPhone 目前只能在**正式生产域名上线之后**进行真实安装态 PWA 认证、同步与权限验收。原“G2/G7 必须全部 PASS 才能合并生产，且未上线不能测试”的写法存在循环依赖。本节是上线门禁执行顺序修正，**不删减任何正式设计功能，也不把验证改成可选项**；以前章节相冲突的“先取得双机结果才允许部署”以本节为准。

### A. 合并/部署之前必须证明（PRE-DEPLOY GO）

- G0：五个最终 HEAD 与跨仓库 CI 全绿；对所有设计要求的金融审批、双边资产、R2 原字节迁移和撤销、身份串号、离线隔离、回滚/故障和缺失密钥进行服务端负向测试，修复未实现的功能，**不得先部署功能缺失的四 App**。
- G1：四个生产 D1 和三个 R2 的本次完整加密备份、原始 SHA-256、数量/金额/关键关联摘要、隔离环境真实恢复及原件保管验证；不能依赖旧日期备份代替发布时数据。
- G3～G6：本地/隔离数据库及跨应用权限、审批和金融执行/幂等、旧写入 drain 的可证实安全条件必须预先通过。原 R2 对象及历史源数据不得在本次发布中不可逆删除；无法证明的破坏性清理不应冒充“已完成历史源清退”。若设计中仍有尚未实现的合法路径，继续开发而不是删功能/绕过门禁。
- G7（可提前部分）：核对取得的官方发行方交易明细文件的来源真实性和保密保管方案；无法取得的机构数据如实列为“**生产后机构核验未完成**”，不能用模拟 CSV、开户密码函替代，也不能因此虚假签署机构级 PASS。生产金融账务应有可重复的只读核对和不可变审计机制，未知交易不能默认为已对账。
- G8：正式 Cloudflare OAuth 回调、Secrets、Service Bindings、DB/R2/Pages 绑定和设计要求的所有功能配置均需受控预检；按数据库依赖顺序先完成迁移预检、可恢复性证明；不能因 CI 绿而直接开启已知未配齐的功能。
- G9（部署前）：确定发布窗口、变更负责人、受控账号范围、旧版 Worker/Pages 版本和 DB 迁移回退方案、明确回滚触发阈值；在隔离环境完成真实回滚演练，并记录用户此前明确的生产发布授权。**这些项目是真正阻止合并/迁移的前置门禁。**

### B. 一次性完整正式代码部署后立即执行（POST-DEPLOY ACCEPTANCE）

1. **不是 Preview，也不是删减金融业务的“试用版”。** 在前述安全条件通过后按依赖顺序完整部署四应用：HomeFlow #305 必须先于 #306，联动平台按实际依赖发布；迁移与绑定按审定顺序，验证正式版本/健康/数据库 identity、审计和业务完整性。实际访问先限定家庭两个账号和经批准的发布窗口，不对其他家庭开放未验收的身份/金融写入。发布期间确保出现异常时可立即停止高风险写入并回滚，而不是把永久关闭功能当成功交付。
2. 用户与丈夫分别在两台实体 iPhone、Safari 和四个安装态 PWA 完整执行 G2 的 PKCE、跨域回跳、私有/共享权限、登出、离线和缓存错人拒绝、双人并发等矩阵；报告系统版本与通过/失败证明。此项**技术上只可能在有真实可达的生产版本之后最终通过**；其缺失不再单独作为部署前的循环阻断。
3. 用已取得并验证来源的银行/SBI/积分真实官方交易明细与**已部署生产系统**的只读不可变 journal 执行 G7 逐笔对账；缺失/冲突标记异常并停止相关有风险操作，不臆造金融机构认证。历史交易未发生时不要求发起新的真实券商买卖作为测试；不能因未发生交易虚构“机构已执行”。
4. 验证全部实际合法资产路径、共享账目更新/删除/恢复、R2 附件重新登录与历史数据一致性；记录 D1/R2 行数/对象数量/金额摘要、失败与并发响应，以及完整 Cloudflare 正式版本/Actions Run。
5. 任一 G2/G7/生产财务一致性关键项失败时，**正式发布状态仍 NO-GO**，触发预先约定的停止写入、证据保存、修复或回滚程序，不对外宣布完成。全部 G0～G9 的部署前和部署后证据齐全、实际部署验证通过，用户最终签署后，才能报告 **FULL RELEASE PASS**。

这只是调整“什么时候能够获得真实证据”的时序，不授权立即绕过 G1、G3～G6、G8、G9 的安全要求，也不声称已执行合并、迁移或真实双机测试。


## §112 真实生产只读迁移基线与完整金融配置 G8 预检（2026-11-15）

**没有执行 remote Migration、备份/恢复、R2 删除、Secret 修改或 PR 合并。持续 PRE-DEPLOY NO-GO。**

- 通过已连接 Cloudflare 账户**只读** API，核对四个现有正式 D1：HomeFlow `d1_migrations` 54 项，最后 `0052_achievement_thresholds.sql`；家計簿 `schema_migrations` 16 项，包含 `schema-0019-verified`，没有新家庭金融 schema 标记；知学 `d1_migrations` 174 项，最后 `0176_fe_exemption_sample_duplicate.sql`；文书助手 `d1_migrations` 19 项，最后 `0019_document_translation_cache.sql`。元数据全部 `changed_db=false`，`rows_written=0`。功能分支中待隔离重放的 SQL 文件清单：H 0053～0060 共 8，K 0020～0059 共 40，Study 0180～0192 共 13，Document 0020～0026 共 7，总计 68 个**待隔离演练**文件。没有用“最大版本号”推断实际上已经执行迁移。
- 生产 `d1_migrations`/ `schema_migrations` **全量名称排序 SHA-256 指纹**（2026-11-15T14:16:50Z）：HomeFlow `3a8aee4d57654c964f8317c23e4110e9cfe0ea69f3f26483f177115294740d0b`；家計簿 `f30117ea8ae1885c18ca61f6c82872f4ca9fecc33f72c029c59af2d33f0581b0`；知学 `30b91221e030a97b19499010a125f1a541303cc3ed3e18a85f565e0a956af0df`；文书 `62ebb0ec892ee64d29f58e498ccf0fccf94a811a62e0a3ae1f85deec3f0503ea`。这些是 **migration marker 名称指纹而不是 SQL 数据备份指纹**，严禁冒充 G1 的财务行 SHA 或完整 D1 备份。
- HomeFlow #306 新只读脚本 `scripts/release-d1-migration-inventory.mjs`：仅 GET D1 数据库元数据、仅 POST **固定字面量 SELECT** 读各库 migration markers，不修改 D1、不打印账户/金额/完整 SQL/密钥、严格比对基线 count+SHA。基线变动、目标库缺失/重名、迁移文件重复、错误资源或数据库变更 meta 则拒绝；仅能宣告 `eligible_for_isolated_migration_rehearsal`，**永远不宣告 `production_migration_authorized`**。CI 对四仓库固定 HEAD 中全部 68 个 SQL 文件做了存在性验证。实际迁移还要求 G1 备份完整恢复、DDL/DML 单步预检及异常回滚。
- 修正 HomeFlow #306 `scripts/release-g8-binding-preflight.mjs`：除了最初的 SSO/审批服务，纳入全部代码已发现的跨成员双人同意/签名、owner 审批、银行、SBI、积分、储值卡、信用卡、周期金融、文书各自 Secret/Flags/Service Bindings，以及 Worker D1/R2 正确绑定类型；新负向测试确保缺配置必须阻断。配置**名称存在不证明值正确**，必须独立测试服务目标、安全权限和实际 OAuth/SSO。
- **生产数据汇总基线仅做指纹（不是备份）**：2026-11-15T14:26:48Z 使用仅 SELECT 的 D1 查询记录 HomeFlow users/household_members/family_profiles/tasks 四表计数集合摘要 SHA-256 `5943d10c1089ecd61adb1de7e916de90227a74f02b78fdd822423933ea7ed7a2`；K entries/payment_sources/investment_holdings/recurring_plans/receipt_r2_state 五表计数以及 entries 按 type 汇总金额集合摘要 `6b3d3869e533b102ce1700d772de59baac27923d95564821b821a2dad9761ded`；Study study_attempts/scenario_attempts/saved_vocabulary_entries_v2 三表摘要 `94539d1efb4f2b002652f11b3ba22560878a5c0995aaabc54fe779adcec094fc`；Document documents/users 两表摘要 `022369ee47d2c0ab4932aa7d42ce205bb21f61ac990db6084cee30075b2be1de`。未将实际金额、账户 ID、用户行或正文输出到仓库；所有查询 `changed_db=false`。聚合摘要不是 R2 原件证明、不是数据库文件备份、亦不保证生产写入期间无变化，需发布冻结窗口重取并在恢复后核对。
- 已通过只读 Cloudflare GET 核查四生产 D1 均有 Time Travel bookmark（原始 bookmark 本文不记录），原有三个 R2 Bucket 仍为 `homeflow-family-media`、`kakeibo-receipts`、`jp-document-assistant-private`。**Time Travel bookmark 不能替代加密 SQL/R2 原字节备份或完整演练**。
- 本节代码验证：HomeFlow #306 `a5c8eaa09902054593904e3fa6967731e861fc72` Validate `43723952017` success；加入固定 HEAD 全 68 文件存在性测试后的 HEAD `460409567c04b2cf48720b4cd99370a8f15a4c59` Validate HomeFlow **Run `43724109809` completed/success**。此前 K #309、知学 #179、文书 #97 CI 保持原已核验成功。**此处不是生产配置/数据迁移完成证据**。
- 独立阻碍依旧：正式 G1 新加密备份/恢复及财务数据摘要；G3～G6 跨成员全部合法资金路径/生产旧客户端冻结/完整一致性；G8 真实 Secret 值、Service Binding 目标与 OAuth 允许列表配置；G9 隔离回滚演练、发布时间窗口。生产后 G2 两实体 iPhone 和 G7 官方真实对账按 §111 顺序进行。只有所有真正部署前门禁满足后才执行正式合并/生产迁移，且不可借绿色 CI 永久关闭设计金融能力。
