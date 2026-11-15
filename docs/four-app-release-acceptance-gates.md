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


## §113 A 阶段已备份确认、四应用私有执行链接、OAuth/发布隔离和本地回滚工具（2026-11-15）

**G1 用户历史验收状态修正**：用户明确再次确认 **2026-11-14** 已完成 4 个生产 D1 全量加密 SQL、3 个 R2 原字节备份及独立 SQLite 恢复、SHA-256 校验、外键和文件对象验证，不应再被要求从零备份。此轮又通过连接的私有 Google Drive 元数据找到 `四应用生产加密备份/2026-11-13-A阶段` 下 `A-stage-verified-cqf3T3.7z`、`A-stage-clean-20261114-004412.7z` 等加密档案；**未解密或下载其内容，也未读取/记录解密密钥**。旧的 `backup-preflight-status.json` 属于更早的 A 阶段准备状态，不可覆盖随后用户确认的真实恢复结果。应沿用原加密备份，同时在发布冻结点确认新增数据有可恢复的 D1 Time Travel bookmark、R2 变更清单及受控保护；这不是要求重做已完成的 A 阶段。
- **G3–G5 发现并修复的跨系统真实执行缺口**：HomeFlow 不能直接 Service Bind 到 Kakeibo Pages 项目的金融 Functions，原有内部 `kakeibo-homeflow-bridge` 仅提供 ledger GET/JPDA POST，导致线上审批即使 G8 配齐也无法落账。K #309 新 `workers/family-finance-service-router.js` 通过**原私有 Worker + 原生产 K D1**复用已经存在的各个审批执行业务处理器，涵盖现金、银行、卡购买与还款、积分、储值卡、SBI、共享账目、周期回执以及文书财务，拒绝浏览器 Cookie/Origin/Authorization、非 POST、任意路径与缺失配置；底层既有签名、执行证明、D1 CAS/幂等和财务审计不变。代码 `69b26b16c888adbbc6f07006b925f93b08d972f5`、`60c3d4e80ee3f69be4dc90bd9b9a18dd02f90ab6`、负向测试 `51431dbb189e3a74ee2c67c66681b7dfcc9beb2a`，并由 `d8081292a6b5d0228cc8cfdfa776c3ab3c92cdcc` 将**真实私有 Worker Wrangler dry-run bundle**纳入 K CI。K Validate Run `43728126071`、Bridge `43728126045`、Mobile WebKit `43728126029` 全部 success。这是完整代码编译及隔离证据，**不是生产金融操作证据**。
- **G8 已审阅的声明式生产 Service Bindings / OAuth**：H #306 `wrangler.toml` 将全部既有 K 金融执行 service bindings 绑定至原内部 `kakeibo-homeflow-bridge`、文书执行至原 `jp-document-assistant`，HomeFlow `OAUTH_CLIENT_REDIRECTS` 精确 3 个正式 HTTPS 回调地址，无 wildcard/Preview；K Pages `HOMEFLOW_IDENTITY_SERVICE=homeflow`、K 内部 Worker `HOMEFLOW_IDENTITY_SERVICE=homeflow` 与 `DOCUMENT_FINANCE_SOURCE_SERVICE=jp-document-assistant`；知学三项 HomeFlow/文书 service bindings；文书新增 `KAKEIBO_DOCUMENT_FINANCE_SERVICE=kakeibo-homeflow-bridge`，原有绑定/Google OAuth 不删除。三应用公开 Origin 为确切生产域名。H `release-g8-binding-preflight.mjs` 增强为核对现有**第五个私有 K Worker**、明确 Service Binding 的真正目标而不只看名称/类型，所有敏感值依旧不输出。H G8 CI `43728045880` success，K、Study、Doc 同步 CI 均 success。**这些只是 feature-branch 配置文件，不是 Cloudflare 正式环境已配齐；生产仍缺新的 Secrets/Bindings/Flags。**
- **G9 私有真实数据回滚工具已交付，但未运行真实备份**：H #306 新 `scripts/release-local-data-rehearsal.py` 使用私有本地已恢复 SQLite 作为只读源，临时 online-backup 克隆、按审阅四仓固定 68 migration SQL 执行、原始列逐行 SHA-256（同时守护财务计数/金额、外键与完整性），成功或失败都重新从未动的 baseline 恢复隔离副本，最终仅输出匿名结果摘要。新增 `tests/test_release_local_data_rehearsal.py` 测试正常、错误 SQL、危险路径、同计数被篡改、等总额两笔相反改动均 fail-closed，CI `43730104563` success（实际代码最后变更 `dc3dfaa9165e804dcb73dd40d8c546d5fe1972ef`）；这仅是**合成 SQLite CI**，不得写成已在用户真实加密备份上重放迁移与回滚。当前执行环境不能访问用户保管的私有解密密钥，不能索取/打印密码。尝试 Cloudflare 只读 K D1 SQL Export，云端导出成功，但临时 URL 不能安全传送到容器内；未获取原始财务数据、未把其上传 GitHub/Drive，也没有执行生产 D1 import/restore。
- **防止部分自动部署**：H #305、#306 及 Study #179 的原生产 Workflow 已加严格 `workflow_dispatch` + 人工 `FOUR_APP_RELEASE_APPROVED` 确认，合并新 main 不会自动发布不完整身份功能。H #305 新部署闸 `4ef943687bc29370ef18db2c03c55ac6e61f2e17`，测试 `f7301b2fd012fa4e637e1bcd74cb48e9371a7b4e`；H #306 部署闸 `e6bb5cd9a947010a9b9aa383e5c0a831695ad0d3`；Study `6cff757af2e4b6fd89880834965a8bbd50714ed8`。K Pages 与 Doc Cloudflare 自动构建当前仍需发布窗口额外控制，不能推定已全局锁定。
- **必须继续保持 PRE-DEPLOY NO-GO**：正式 Cloudflare 新 Secrets（必须安全产生并跨 App 正确配对）、对应 Service Bindings/Flags/OAuth 真环境、基于解密真实 SQL 的 68 migration 与回滚实际演练尚未完整通过；H #305 最新 Workflow+测试 HEAD 的新 CI 尚无成功 Run，不能借旧 CI 宣称 G0 全过。用户原 2026-11-14 A 阶段已完成，不属于未完成项。根据 §111，两个实体 iPhone + 新生产不可变 journal 的 SBI/银行/积分对账 **放在完整生产部署后**，不得用来制造部署前循环。


## §114. 生产 Cloudflare Secret 实测、稳定版本恢复与真实 D1 演练的仓库 Token 401（2026-11-15）

**严格状态：PRE-DEPLOY NO-GO；四个 PWA 未被新系统替换。** 本节记录真实生产只读和受控改动，不可将新 Secret 名称或新工具等同最终上线。

- **用户明确授权直接设置正式 Secrets/Bindings/OAuth，并要求成功验收后按 H #305→#306、K #309、Study #179、Doc #97 的依赖顺序合并和一次性正式 Migration/部署。** 原先 2026-11-14 四 D1 + 三 R2 加密备份与本地恢复已完成，不可重复要求用户做 A 阶段；§111 G2 双 iPhone/G7 新生产 journal 的真实核验属于部署后终验。
- **真实 Worker Secret 配对动作 + 即时风险恢复**：Cloudflare 已连接 API 在单次内部隔离执行中生成一组随机 32-byte HMAC 密钥并分别写入正式 Worker `homeflow.APPROVAL_VERIFICATION_SECRET` 和原私有 Worker `kakeibo-homeflow-bridge.KAKEIBO_APPROVAL_VERIFICATION_SECRET`；没有返回、打印、提交或外传秘密明文，既有 Secret 未覆盖。实测 `PATCH /secrets-bulk` 竟**自动产生 100% 活动部署**，H 临时版 `6b53d527-e281-42ec-b3e6-77b0252f39e7`，K Bridge 临时版 `6c23973d-585c-4185-8463-f942cb6a9095`，因此**立即停止其他 Secret/Binding 写操作**。已用 Cloudflare deployment API 100% 恢复 H 原稳定版 `bdae82ce-49be-47bb-9eb5-6960fb1e375f`、K Bridge 原稳定版 `3db626a1-a865-4d67-872c-06f2a8abb279`，随后再次 GET 验证均为原版本 100% 流量。未部署新业务代码、未执行 D1/Pages/R2 写入或改变 Preview。历史版本/Settings 可能仍显示新 Secret，不能将其判定为现行完整生产 Secret 配置。**此 API 不是无副作用的“暂存 Secret”，不可再对剩余所有密钥直接逐个写入。**
- **真正当前生产 D1 Migration/G9 演练已建并自动触发**：H #306 `scripts/release-current-production-rehearsal.mjs`（`18d82518a4e67a27d63d608707d08a044b55b6e9`）、`scripts/restore-d1-sql-export.py`（`5daaaaa46bce07139e8cae5a6d5eaa6b9974d6b1`）和 `.github/workflows/rehearse-current-production-d1.yml`（`1bb5727b6e03a9526bece3c89744dcd0b5f22bbc`）。此 Workflow 通过原 HomeFlow GitHub Actions Cloudflare Token 只读 GET 四生产 D1 清单、POST Cloudflare D1 SQL Export，然后仅将真正生产 SQL 快照下载至**一次性 GitHub runner 私有临时目录**；恢复 SQLite、对 68 条审定 migration 重放并逐行哈希保护旧数据、模拟回滚，finally 销毁所有 SQL/SQLite，**不上传原始 SQL 至 Artifact/仓库/公开日志，不运行 remote D1 import/migration、不创建 Preview**。
- **遇到独立真实阻碍，不得虚报 PASS**：Github Actions `43732277869` 在 cloudflare `GET /d1/database` 返回 `CLOUDFLARE_API_HTTP_401`；加不泄露值的 `GET /user/tokens/verify` 活性诊断 Commit `4a6416bfc4cb4c5912a379961daa6ecf14f8d360` 后，Actions Run **`43732434975 failure`** 明确 `GITHUB_CLOUDFLARE_TOKEN_VERIFY_HTTP_401`。GitHub Secret `CLOUDFLARE_API_TOKEN` 虽非空，但其令牌本身失效/无效，尚未到能区分 D1 scope 的阶段；不能将已连接 Cloudflare 插件的独立授权当作 GitHub Runner 的 API Token，也不能打印/窃取 token 弥补。**真实生产 SQL 根本没有下载；68 migration 的真实库演练未执行，也未更改生产数据**。
- **GitHub 令牌修复必须在 GitHub Actions Secrets 管理界面用可信 Cloudflare 账户的新有效 Token 完成**，包含受控 D1 SQL Export/读取和经审定的生产发布所需权限，只限这次使用的 Cloudflare 账户。**不要把任何 Token、备份解密口令或新银行凭证发送到聊天、GitHub Commit 或 Actions 日志。** 当前连接的 GitHub 工具没有 Repo Actions Secret 写入能力，故此必需动作不能由此聊天代为提交；不应以编造 token 或直接绕过生产审计流程代替。
- **当前可靠 CI**：H #305 HEAD `9fe59f1422b4cc970aec982fb0cb5f4e90f31270` 已新增明确 feature branch push Validate，Run **`43732535980 completed/success`**，解决此前 #305 最终 HEAD 无对应 run 的 G0 缺口；H #306 实际 pre-merge latest `4a6416bfc4cb4c5912a379961daa6ecf14f8d360` Validate **`43732441297 completed/success`**，但独立 G9 真实库演练 **failure**，不能只写“全部 CI PASS”。K #309 `d8081292...` Validate `43728126071` + Mobile WebKit `43728126029` + Bridge `43728126045` success，Study #179 `6cff757...` Validate `43729879799` success，Doc #97 `1fa0f8...` Pre-merge `43728610498` success。
- **上线真实剩余**：须刷新 GitHub Cloudflare Token，并使真实 SQL 隔离迁移+回滚演练通过；为四正式服务配置全部所需 Secret 一致性与生产 OAuth/Service Bindings、核实 Pages/Doc 自动构建的受控发布顺序、G3–G6 全设计完整路径的可追溯校验、生产发布签署。只有这些 **PRE-DEPLOY** 门禁通过，才能正式合并五个 PR、Migration 和四应用部署。**G2 双实体 iPhone 和 G7 官方对账留作部署后完整终验，不再作为上线前循环条件。**


## §115. 用户更新 Token 后的真实 GitHub Actions 再验证（2026-11-16 JST）

- 用户已明确报告 `Token 已更新`。本节**实际重跑**此前 G9 失败的 Workflow `43732434975`（Attempt 2），回读新的 Job 日志依旧为 `GITHUB_CLOUDFLARE_TOKEN_VERIFY_HTTP_401`。因旧 Attempt 可能不能证明 GitHub 新值是否生效，随后多次以新 commit 确保触发**全新** Actions Run；校验只输出 Secret 是否非空、是否包含误粘贴的 `Bearer` 前缀、引号或空白等布尔值，**不输出长度、值、哈希、前缀或任何账户令牌**：诊断结果无引号、无 Bearer、无多余空白。
- **重要修正**：Connected Cloudflare OAuth 可以正常读取 D1，但该连接调用 `GET /user/tokens/verify` 同样返回 401，因此 **Token Verify 不能作为所有授权类型的唯一有效性证据**。H #306 的 `scripts/release-current-production-rehearsal.mjs` 已删除这个额外阻断，改为直接对目标账户执行真正的只读 `GET /accounts/{id}/d1/database` 再判断是否具备最小访问权限。代码 Commits `81df66a723746e118a3946871dddf4e074ffe686`、`29aa42a45f06c5360b80306cfe545d2b966bab88`（诊断修正）、`3a4114be0c6e3d41ebfbd10cf1c8a5e331b422d7`（去除不可靠 verify 门禁）。
- **最重要的真实结果**：全新 HEAD `3a4114be0c6e3d41ebfbd10cf1c8a5e331b422d7` 的独立 G9 Workflow Run **`43774214356 completed/failure`**，错误 `G9_READONLY_REHEARSAL_BLOCKED:CLOUDFLARE_API_HTTP_401`。与不可靠的 verify 端点无关；此次失败来自**实际生产 D1 列表 API**。GitHub Actions 取得的 `CLOUDFLARE_API_TOKEN` 虽非空且格式没有包装痕迹，但无法用 Bearer 身份访问目标账户的 D1。并没有读取或下载任何真实 SQL、不会触发数据库迁移/恢复。该来源 Token 在当下**尚未通过访问验收**，不能宣称凭据已生效。用户曾更新 Token 的陈述保持原样，不擅自断言是用户操作错误；原因可能是仓库 Secret 位置/权限、令牌类型/状态、目标账户 ID 不匹配等，需由其本人在可信控制台核对，**不得向聊天提供任何 Token 明文**。
- **真正应用 CI 仍通过**：同一完整源文件的新功能 HEAD `3a4114be...` 运行 H #306 Validate HomeFlow **`43774220245 completed/success`**，其它四功能 PR 的已有代码测试继续有效；但 `G9` 生产 SQL 隔离迁移+回滚**仍未执行**。所有生产金融 Flags、真实新 Secret/Binding/OAuth 及实际 Migration/合并操作仍未完成，正式 **PRE-DEPLOY NO-GO**。
- 下一步仅须验证 HomeFlow GitHub 仓库 **Settings → Secrets and variables → Actions → Repository secrets → CLOUDFLARE_API_TOKEN** 对应的 Cloudflare **API Token**（不是 Global API Key），及 `CLOUDFLARE_ACCOUNT_ID` 绑定的账户身份、令牌许可范围。务必在 GitHub 仓库加密 Secret 管理页面设置，不在对话、源码、Issues、Workflow 日志公开值。修复后对**全新 GitHub Run**先观察目标 D1 GET 是否成功，再继续 G9；不得提前合并五个会改动生产模式的 PR。§111 已确认的两台实体 iPhone 与发行方机构流水验证仍是完整生产部署**之后**的验收，不是此阻碍的原因。


## §116. 2026-11-16：真实四生产 D1 的 68 项 Stage F 迁移及隔离回滚完成（G9 局部 PASS；正式上线仍需 G8）

- **Token 问题已解决**：用户要求“再试一次”，重新运行 `43774214356` Attempt 2；这次 Cloudflare API 成功访问正式 D1、导出四个生产 SQL 并分别在一次性 GitHub runner 本地 SQLite 恢复。先前 401 已不再存在。原 `43774214356` 结果为 **completed/failure**，但原因已经从认证变成真实迁移逻辑：H 8/8、Study 13/13、Document 7/7 均 PASS，K 40 项中的 `0020_recurring_multi_schedule.sql` 第一项重复 ALTER 失败。
- **真实生产 Schema 只读排查**：Cloudflare D1 `kakebo` `PRAGMA table_info` 和 `sqlite_master` 证实 `recurring_plans.weekdays_json/month_days_json/interval_months` 三字段及 CHECK/NOT NULL/DEFAULT **已经存在**，而 `schema_migrations` 没有 0020 对应标记；`sbi_transfer_links.purpose` 字段及约束同样存在但没有 0021 标记。这两条是在之前的既有生产 Schema 中已经物理应用、标记不一致的历史迁移，不能盲目重跑，也不能为了让新系统通过验收而删除字段。
- **代码安全修复**：HomeFlow #306 `scripts/release-local-data-rehearsal.py` Commit `b65596f723acc1110468b90cf353357cba53d950` 实现**仅针对已核验 0020/0021**的字段级识别：逐一校验字段存在、SQLite 类型、非空、默认值、CHECK 约束；若匹配则计入 `verified_preexisting` 而不重执行 ALTER；只存在部分字段、类型或约束不同则 **fail closed**，既不擅自修复，也不伪造 migration marker。新增负向测试 `tests/test_release_local_data_rehearsal.py` Commit `3be8977a71b96143217eba4f5edf8b1a4a526c25`，覆盖两项已存在字段和部分迁移漂移拒绝，最终 **Validate HomeFlow `43775184061` completed/success**。
- **真正全量重跑**：Github Actions `Stage F read-only real production D1 migration + recovery rehearsal` **Run `43775130605` completed/success**，使用四个**当前正式 D1 的真实 SQL 快照**，运行 H 8 项新增、K 38 项新增 + 2 项严格已存在验证、Study 13 项新增、Doc 7 项新增，**四库全部 68 项 completed/verified**。产物已证明本地 SQLite 数据库恢复与 `PRAGMA integrity_check`、`PRAGMA foreign_key_check`、旧表原始列逐行 SHA-256 和关键家計簿金额摘要一致；隔离迁移成功后再从原始 SQLite 本地副本实际恢复并比较，结果 `real_data_migration_and_local_rollback_passed=true`。Cloudflare **生产写入 0**、没有正式 Migration、没有生产 Worker/Pages 发布，没有原始 SQL Artifact/敏感值泄漏或 Preview 新建。
- **门禁含义**：此前因 Token 401 或 Kakeibo 0020 重复 ALTER 而阻挡的**“当前真实数据快照 Stage F 迁移和隔离恢复演练”证据已完成**，不再将其列为缺失。但是这不是**真实 Cloudflare 生产 D1 时间旅行回滚演练**，不自动批准真实生产 Migration、Secrets/Bindings/Flags 上线；生产变更前仍要验证 G8 生产全套 Secrets 的配对、真实目标服务、OAuth redirect、Pages/Doc 自动部署协调、迁移执行顺序和已做 A 阶段备份的发布时保护策略。G2 两台实体 iPhone/G7 银行 SBI 积分官方真实流水仍按 §111 在完整新版本部署后验收。
- **本节当前状态：PRE-DEPLOY NO-GO（G8/协调发布/真正生产数据保护未放行），五 PR 继续 Open/Draft**；但 G9 **只读真实快照迁移及隔离回滚部分 PASS**，下一阶段不要重新把它误报为“未做”，也不得把该通过扩大成全量 G0～G9 或正式上线成功。


## §117. 2026-11-16：真实发布锁定、#305 合并冲突修复与生产 G8 部分配置（仍 NO-GO）

- 用户明确要求完成 Cloudflare 正式 Secrets/Service Bindings/OAuth、协调回滚、真实 Migration 与五 PR 合并。本轮重新读取真实 v1.1 设计书、唯一 §116 handoff、#306 G0–G9 门禁及五 PR HEAD；§116 的四 D1 **68/68 真实 SQL 快照隔离 Migration + 本地 rollback PASS** 保持有效、2026-11-14 的 4 D1 + 3 R2 加密备份/本地恢复亦保持用户已完成状态。不可重新将这两项标记为未完成。
- **HomeFlow #305 真实合并冲突已排除**：GitHub 起初 #305 `mergeable_state=dirty`，通过三棵 Git tree 的 merge-base 审查，确认同名修改冲突仅 `.github/workflows/deploy.yml`。为避免 #305 合并触发旧生产 push deploy，把 HomeFlow **main** 部署 Workflow 修改为与 #305 完全一致的 `workflow_dispatch` + 独立确认字串 `FOUR_APP_RELEASE_APPROVED`，真实 main Commit **`e5a8f9bed78432fe6576a98b9893cd27d9059a99`**。未触发生产部署，GitHub 重新计算显示 #305 **mergeable=true**。#305 仍 Open/Draft，**未实际合并**。
- **Cloudflare 正式发布锁已实际实施且受控**：
  1. Pages `kakeibo` 原 `production_deployments_enabled=true` 改为 **false**；原 Preview `none` 未更动，当前 Pages 活动 deployment `4a07c22e-78b2-496e-b171-93cfff57b157` 保持不变。
  2. Worker Builds `it-study-platform` 正式 trigger `fb533803-4579-4b30-9f88-6f3474308e83` 和 `jp-document-assistant` trigger `a6ceda83-d932-4047-9b3f-d2923e99d965` 的 `branch_includes` 原 `[main]` 暂设为 `[__four_app_coordinated_release_only__]`，可阻止 main 合并抢跑独立生产部署；两 Worker 实际活动版本不变。知学以前 Worker Builds `previews_enabled=true` 现已设为 **false**，符合本项目禁止 Preview 创建要求。
  3. **发布后需要恢复** K Pages 的 `source.config.production_deployments_enabled=true`，并将知学及文书两个 Worker Builds trigger `branch_includes=['main']`；知学 Preview 保持 disabled，不可重新启用。当前这三项自动发布机制**仍处于暂时锁定**，请勿误以为日常 main push 会自动发布。
- **正式 Kakeibo Pages 生产 G8 部分配置已真实写入**：在不改变生产部署版本前提下，以 Cloudflare Pages PATCH 的**增量环境变量更新**添加 `APP_ENV=production`、`HOMEFLOW_OAUTH_ORIGIN=https://homeflow.yupan6706.workers.dev`、`KAKEIBO_PUBLIC_ORIGIN=https://kakeibo-f17.pages.dev`、`HOMEFLOW_IDENTITY_SERVICE → homeflow`。另新建了仅 K Pages 自身使用的 `KAKEIBO_SSO_ENCRYPTION_KEY` 加密环境变量（内容未返回或记录）。实测原有 `AUTH_TOKEN`、三项 `JPDA_BRIDGE_*` 全部保留、Page latest deployment 不变、Preview none。新 SSO key 存在**不等于统一登录已正式启用**。
- **重要 Secret 配对保护**：尝试将随机 `KAKEIBO_FAMILY_PENDING_KEY` 同时用于 K Pages + 私有 Bridge，但 Worker Secret PATCH 因工具级安全限制而**未被执行成功**；没有把明文写到日志。为防两端钥匙不一致，已经通过 Pages PATCH `KAKEIBO_FAMILY_PENDING_KEY:null` **主动撤销了 K Pages 的孤立 Secret**，最终 K Bridge 仍没有该 KEY，Page 也没有。没有旋转/破坏旧生产 JPDA Key。必须在受控完整发布环境中一次性配对，不能重复试图绕过安全阻断。
- **真实 G8 检查及权限缺口**：H #306 部署 Workflow 已新增在 `wrangler deploy` 之前运行 `node scripts/release-g8-binding-preflight.mjs` 的硬门禁，Commit **`d2b5089767b6f11c8ebbf43b810fa28652fc30e1`**；新独立只读 GitHub Actions `.github/workflows/verify-production-g8.yml` Commit **`6ebad792b56a1a04f70bbe8f1ec5b062398592cc`**，真实 **Run `43777090582 completed/failure`**：已更新的 D1 读取 Token 对 Worker settings 读取返回 **403**，不具备 G8 Worker Scripts Read 权限。失败源于 GitHub Action 授权，不得冒充完整 G8 检查 PASS。当前 Chat 已连接 Cloudflare 的 read-only GET 可核对：H 70 个要求仅 4 个存在，Study 13 中 2 个，Doc 14 中 4 个，K 私有 Bridge 36 中 2 个，K Pages 35 中 3 个；此为**仅名称基线**，未验证配对密钥、启用 Flags 或合法身份授权。当前 #306 Validate Head **`6ebad792...` Run `43777094422 completed/success`**。
- **最终 Cloudflare 活动业务版本回读**：HomeFlow `bdae82ce-49be-47bb-9eb5-6960fb1e375f`、知学 `605ec3a7-ca3f-425e-b692-1039afc732c7`、文书 `55963dbf-63f1-42b0-aaec-28113d3a23ca`、K 私有 Bridge `3db626a1-a865-4d67-872c-06f2a8abb279`，均仍是原稳定版 100%。Cloudflare 四生产 D1 没有执行新 Migration，R2 没有清理、没有新 Preview，也没有五功能 PR merge。**PRE-DEPLOY NO-GO**。
- **不可跳过的独立发布条件**：须由具有实际 Workers Scripts Read/Edit 与 Pages Write 的授权发布环境（不能使用当前缺 Worker 权限的 GitHub D1-only token）安全生成并配对所有独立 HMAC/AES Keys，保持旧 Key 原值、核实 HomeFlow/Bridge/Study/Doc/Pages 所有 Service Binding 真实目标、OAuth 回跳列表及全部设计功能 Flags；真实 G8 及 G3～G6 完整权限/金融执行关闭缺口后才可重新按 §111 所述正确次序进行生产 migration/合并/全量发布。此轮不要以 68/68 离线迁移 PASS、#305 mergeable 或 CI 绿色为由提前 remote-migrate。
