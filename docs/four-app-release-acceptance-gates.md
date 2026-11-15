# 四应用统一账号与家庭金融审批：正式上线验收门禁（2026-11-15）

**状态：NO-GO / 禁止合并和启用新功能。** 本文件是 Stage F 正式上线前的可复核验收清单，不代表生产已变更。仅当每项有可验证证据、负责人签署且完成回滚演练后才可更改状态。已上线旧业务不受影响。

| 门禁 | 当前结论 | 可接受的验收证据 |
|---|---|---|
| G0 代码/CI | 四仓 Draft 分支的最新 CI 通过；不能视为上线 | 对每个最终 commit SHA 保留完整 Actions Run、负向权限/回滚测试日志、WebKit 自动化 |
| G1 生产 D1/R2 | **未开始新迁移**；A 阶段用户已完成加密备份及本地恢复 | 上线当日重新验证 4 D1 + 3 R2 不可变备份、SHA-256、恢复计数、外键、对象键、恢复日志及保留期限 |
| G2 双人身份和 PWA | **不通过**：仅有 CI/浏览器模拟，缺两台真实 iPhone | 两个真实 HomeFlow 用户分别使用 Safari、两个安装态 PWA：PKCE/nonce、Safari 回跳、断网重入、切换 Cookie、登出、iOS WebKit 清缓存、同时登录、私有数据互不显示；记录设备/iOS版本/屏幕证据及实际响应码 |
| G3 账户与家庭权限 | **不通过**：新金融模型仍 Draft | owner/member/另一个 household 的读/写/审批/撤回/恢复/附件隔离矩阵：拒绝应为 401/403/409，旧离线队列不能被新用户重放 |
| G4 账目与资产 | **部分内部完成**；不能视为全部合法转账 | 明确现金、银行、证券现金、基金份额、可兑现储值卡、不可兑现点数/储值余额的资产类型和支持路径；每条跨成员路径有双方真正事后流水、owner 单独授权、账户版本 CAS、负余额拒绝、不可变双边账、故障回滚、原 ID 重试和重复流水防护 |
| G5 批量执行 | **部分内部完成**：HomeFlow 最多 10 个原 ID 顺序执行，非分布式原子 | 每个执行结果原 K journal 只读核验、丢包暂停/恢复、失败不重发新 ID；界面明确已成功项不会因后续失败撤销，不能宣称跨 K/H 的全有或全无 |
| G6 历史共享账目 | **不通过（内部 D1/R2 复制→采用链已具备）**：§103/104 已有原 owner 单行 SHA/CAS、0056 原字节私有复制 staging、0057 单库原子 claim+墓碑+审计、CRUD 和真实 SQLite 故障回滚；生产数据、旧客户端在途写入排空、最终源对象清理、成员已审批修改、双实体 iPhone 等尚无验收证据 | 原行 SHA/owner/版本、附件 R2 键与墓碑、明确逐行同意、合法 adopted registry、不可变审计；更新/删除/恢复及竞争写入必须在 K D1 原事务全回滚且不重复财务计数 |
| G7 金融机构对账 | **不通过**：未获得可核验官方机构数据 | 银行/券商/积分发行方原始可信文件或授权只读 API；机构 ID、发生/入账日期、货币、金额、账户、交易号、基金份额/成本、撤销或退款、对账批次 hash；双人独立确认但不能冒充机构证明 |
| G8 部署环境与运行安全 | **不通过**：尚未全面验证 Stage F Secrets/Service Bindings/Pages | 全量正式 bindings/Flags/权限/迁移顺序预检；只启用明确批准功能；不要新建 Preview；验证 Cron 关闭、KV/R2/D1 无多余计费资源，Workers AI 限额、失败恢复和审计 |
| G9 回滚与最终签署 | **不通过** | 先完成隔离环境实恢复，正式发布窗口、负责人、回滚触发阈值、正式两人确认及用户明确发布授权；不直接运行 remote migration |

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
