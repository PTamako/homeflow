# 四应用跨应用接口契约 v1.0（2026-11-14 冻结草案）

> 上位依据：[Google Docs v1.1 设计书](https://docs.google.com/document/d/1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY/edit) §§3–7、T01–T14。**本契约冻结开发时可依赖的身份、动作与回执语义，不代表尚未实现的执行器已经可用，也不授权生产部署。** 状态以每个仓库 Draft PR 的真实代码和 CI 为准。此文件为跨仓库开发接口基准；变更必须附契约回归并记录在唯一 `docs/four-app-development-handoff.md`。

## A. 可信身份与数据隔离（所有应用）

- **唯一身份源 HomeFlow**：不可变 `user_id/sub`、`household_id`、`role=owner|member`，显示名读取 HomeFlow `display_name`，不能用昵称、邮箱或旧单密码判断归属。owner 可管理家庭配置但**不得默认读取他人私人文书/邮件/知学数据**。
- OAuth Authorization Code + PKCE，每个 PWA 分别用自己域名的 HttpOnly Secure 会话；独立 PWA 不共享 Safari Cookie。每个敏感写操作由目标后端重新验证当前 HomeFlow 身份/角色/家庭；来自浏览器的 `actor_user_id`、`role`、`household_id` 只是未信任数据，不能作为授权依据。家庭账本/统计全家可读，个人金融配置只本人可改（家庭 owner 合法管理需留下实际 actor/owner 区分审计），文书私人/学习进度按 actor 独立。
- 原始 HomeFlow 两人数据保持各自归属；家計簿、知学、文书助手既有数据及配置按用户确定映射至原 owner；旧家計簿 *entries* 仍全家可见；历史所有者与真实写入操作人分开，未知历史 actor 标记 `legacy_unknown/system_migration`，禁止伪造 owner 历史操作日志。

## B. 不可变审批事件 v1

- HomeFlow D1 审批记录唯一 `request_id`（UUID）、`household_id`、`requester_user_id`、`source_app`、`target_app`、`resource_type`、`resource_id`、`operation`、`payload_schema_version=1`、`payload_sha256`（hex64）、`expected_version`（适用时）和独立唯一 `idempotency_key`。审批人、真实执行 actor、目标 record owner、历史数据来源不同。HomeFlow 只存**最小审批快照及摘要**，目标 App 保管实际敏感字段与 AES-GCM 加密待执行操作；不复制文书原文、OAuth 凭证、附件或完整卡号。
- 状态机 `pending → approved|rejected|cancelled|expired`，已批准后 `approved → executing → applied|failed_retryable|failed_final|conflict`；重试仅 `approved/failed_retryable` 且保持原 `request_id/idempotency_key`；`rejected/cancelled/expired/conflict/failed_final` 不可执行。**approved 不是 applied**，目标确定写入与持久幂等 journal 验证之后才能显示“已生效”。超时/HTTP 409 不能当作未写入证明；查询目标既有 receipt 后同 ID 对账。所有 CAS/状态变化附不可变审计；普通 GET 不逐页写审计。
- 每个操作固定允许的 `source_app,target_app,operation,resource_type` 组合；目标执行器必须重新检查当前申请人和审批人资格、household、目标资源 owner、原快照版本、payload digest、approval execution nonce。拒绝任意 SQL、任意 URL、未知字段及客户端自报审核完成。

## C. 已实现的线上 *代码契约*（**全部仍处 Draft / flags 默认 OFF，不能等同已上线**）

| 流程 | 当前可信路由（实际 Draft） | 固定消息与权限 | 状态 |
| --- | --- | --- | --- |
| HomeFlow OAuth | 三业务 App 自己的 `/api/homeflow-sso/start|callback|complete|me|logout`（各仓库命名略有差异；不得假定跨 PWA Cookie 共用） | 授权码/PKCE、短期 HomeFlow 会话再校验、不可变 user ID | B 的后端骨架已在 Draft；实机未验 |
| 家計簿成员现金新增 | 家計簿 `POST /api/family-finance/proposals` → `POST .../proposals/{id}/submit` → HomeFlow 后端 `POST /api/internal/approvals/submit` | `X-Approval-Client:kakeibo`，HMAC 原文域分离 `kakeibo\\n{ms_timestamp}\\n{raw_json}`；仅服务间无 Cookie/Origin，四字段 `household_id,requester_user_id,resource_id(32hex),payload_sha256(hex64)`；固定 `finance.entry.create`、`finance_entry`、幂等 `kakeibo:finance:{resource_id}` | 提交 / 审批已实现 Draft |
| 现金目标写入 | HomeFlow owner `POST /api/approvals/{UUID}/execute` → Service Binding `POST /api/internal/approved-actions/execute`（家計簿） | HomeFlow `APPROVALS_ENABLED+APPROVAL_EXECUTION_ENABLED+APPROVAL_VERIFICATION_ENABLED`，Kakeibo 执行 flag 和原始 nonce；执行 body `request_id,resource_id,household_id,requester_user_id,payload_sha256,execution_nonce`，HMAC `homeflow\\n{ms_timestamp}\\n{raw_json}`；执行器仅本人新建的 cash 账户、income/expense，目标 journal 唯一防重复 | 签名真实写入与不确定回执重试已实现 Draft |
| 文书同步审批申请 | 文书助手 `POST /api/candidates/{id}/request-approval` → HomeFlow 后端 `POST /api/internal/approvals/document-submit` | `X-Approval-Client:jp-document-assistant`，HMAC `jp-document-assistant\\n{ms_timestamp}\\n{raw_json}`，字段 `household_id,requester_user_id,resource_id(32hex),payload_sha256(hex64),target_app`；固定 `document_sync_candidate`，target 到操作映射 `kakebo→document.sync.finance`、`homeflow→document.sync.homeflow`、`it-study-platform→document.sync.study` | 仅申请 / 拒绝 / 只读状态校验 Draft |
| 文书审批状态 | HomeFlow `POST /api/internal/approvals/document-status` | HMAC 域 `jp-document-assistant:status`；固定 `approval_id,household_id,requester_user_id,resource_id,payload_sha256,target_app`。金融支持 `pending/approved/executing/applied/failed_retryable`；只有实际目标回执以及 HomeFlow 已持久化正整数 remote_id、executed_at、execution_attempts 后才可 `applied:true,target_changed:true`。非金融文书目标仍不支持 applied | 金融 Draft 已接线，正式环境未启用 |

旧 `JPDA_BRIDGE_SECRET` 及旧单用户直连是**过渡通道**，不等于新 SSO 审批证明；新双用户不能仅凭旧桥接 allowlist / 客户端 `approved:true` 写目标。新的协议不能复用旧弱绑定来冒充 member 审批。

## D. 执行器完整验收要求（依 Draft/CI 确认实际状态，禁止界面假显示）

| 固定操作 | 目标及预期身份范围 | 完成前必须提交的验收 |
| --- | --- | --- |
| `finance.entry.create/update/delete/restore`、`finance.transfer.create` | 家計簿全家庭账本，member 先 owner 审批，owner 可按设计直接操作；非现金须区分信用卡欠款/储值/积分/SBI 的实际会计含义 | 原记录 `expected_version` 条件写入、关联账户 owner 和两端 ID、支出与转账不能双计、回收站和 R2 票据保全、签名/重放/并发/超时恢复 |
| `document.sync.finance` | 文书后端只提供最少经原 owner 预览/确认的字段，家計簿在受信审批 proof 下真正创建/更新 | 原文及附件不传审批；用户切号、源文书候选版本变化时拒绝；目标 journal 一笔；失败同 ID 对账 |
| `document.sync.homeflow` 或 `homeflow.shared_task.create` | HomeFlow 真实家庭/个人任务；跨人任务的权限、points/bonus 与提醒规则仍按原业务校验 | 审批通过后同 ID 创建一次任务、申请人和 assignee 独立审计、通知不含原文、失败重试不双建 |
| `document.sync.study` | 知学词语与句子卡**始终存发起用户自己的 HomeFlow user_id**，不写全家共享词库 | 两人同词/同句各自独立、文书源撤权和切号不串数据、失败幂等 |
| `finance.account.public_rule.change`、固定费/SBI 自动记账 | 家計簿个人配置可直改，但任何真实 family entries 变更须有审批或有效预先授权 | 定期任务 grandfathered/approved 迁移，金额/日期/账户改变重新授权，Cron 恢复无重复扣款 |

**实现新目标执行器的最小安全链**：目标 App 持久化待执行 payload（版本及加密）→ member 的 HomeFlow 当前会话发起、不可变 `payload_sha256` + 受信签名提交 → HomeFlow owner 手动批准 → HomeFlow CAS 租约和一次性 nonce → 受信 Service Binding/签名调用目标执行器 → 目标再核实原 owner/household 与 expected_version，D1 原子业务写入 + 唯一键 receipt + 最小 actor 审计 → HomeFlow 收到精确 receipt/对账成功才写 `applied`。若目标成功但回执丢失，应同 request ID 查询 receipt，不得新建另一笔申请。

## E. 四仓库并行开发的契约验收门槛

- **接口兼容**：修改任一 wire 字段/签名域/状态名都须先更新本文件及契约测试，不可仅改调用方；各仓库可以在自己的 Draft 独立完成代码/本地真实 SQLite、Node VM 及 PWA 回归。
- **失败必须区分**：`disabled` / `unauthorized` / `member_scope_invalid` / `source_changed` / `approval_not_ready` / `retryable_receipt_unknown` / `already_applied`；每种返回 `applied:false` 除非目标证明已落地。敏感字段或文书正文不进入错误日志/推送。
- **测试批次**：模块开发时先针对身份/CSRF/幂等/SQL/断网重试/前端切号的**局部测试**，全部修改稳定后**每仓库一次最终完整 CI**（确有失败才修复重跑）。保留原 PR 为 Draft，不合并功能 PR、不创建 Preview、不运行生产迁移/开启 flags；唯一交接日志只在模块边界记录真实 SHA、CI 和剩余项，不把章节数作为完成率。


## F. 兼容补充 v1.0.1：知学手动句子卡（新 Draft 路由，不是文书执行器）

- 已实现代码但默认 OFF：`GET /api/homeflow-study/sentences/status`、`GET /api/homeflow-study/sentences?limit=1..20&after={32hex}`、`POST /api/homeflow-study/sentences`。第三方客户端不传原 owner ID 作为授权：后端每次通过 `verifiedStudyActor` 实时核实 HomeFlow 自有会话，POST 必须 `expected_user_id === actor.user_id`、同源 Origin 与 JSON；请求固定 `card_id(32hex),expected_version,action='save'|'remove'`，手动 `save` 限 `language='ja'|'en',sentence,translation_zh,notes` 且严限长度/未知字段。存储只按 `homeflow_user_id+card_id`；普通删除为 tombstone、重放同 payload 回 `replayed:true`，不同编辑的过期版本 409；真实操作者 append-only audit。状态查询可只读 flag，默认不存在 flag 时不得访问私有 DB。
- **未授权** `document.sync.study`：上述 POST 永远设 `source_kind='manual'`，即使前端自报 `approved:true`、`source_kind='document'`、`target_app='study'` 或他人 user ID 也无法写入“已审核的文书句子”。文书同步须另签名、验源文书版本和 user、HomeFlow owner 审批、目标持久幂等 journal，再回报 `applied`；此兼容扩展不修改 §B 既有跨应用 wire HMAC 和 approval 状态。


## G. 兼容补充 v1.0.2：过期后的现金回执对账（Draft，须两端同时具备）

- 仅针对既有 `finance.entry.create` 现金执行器：如果曾进入执行、结果不明确且审批后来过期，HomeFlow owner 可以对同一 `request_id` 发起**只读回执查询**，不允许再走目标 `execute`。HomeFlow 使用同一身份、家庭、proposal ID 和原 payload digest，在短期执行租约内调用家計簿 `POST /api/internal/approved-actions/receipt`。消息字段严格为 `request_id,resource_id,household_id,requester_user_id,payload_sha256`，HMAC 使用独立域 `homeflow:receipt\\n{ms_timestamp}\\n{raw_json}`；拒绝浏览器 cookie/origin 和任何额外字段。
- 家計簿只读取不可变 `family_finance_applied_actions`，匹配全部身份/摘要后返回既有精确 receipt；查无记录或冲突不创建账目，也不证明之前的远端请求不会稍后提交。HomeFlow 只有收到完全匹配的已落地回执才标记 applied，其他结果保留 failed_retryable 和原 ID，允许再次核对，禁止创建新审批来猜测结果。
- 普通未过期执行 wire、签名域及证据规则不变；这一补充不扩展到非现金或文书目标，不允许过期审批产生新写入。部署需两端匹配版本；功能 flags 仍默认关闭，未批准生产部署。


## H. 知学文书写入的目标持久化约束（Draft；尚未开放执行协议）

- `document.sync.study` 后续只允许在验证 HomeFlow 实时成员及执行租约、文书源版本与撤权后调用目标内部持久化；任何浏览器字段或单纯的快照哈希都不构成授权。知学保存原审批 ID、文书候选 ID、家庭及申请人 ID、摘要、目标记录和实际效果，审批与候选均不可重复使用；目标业务写入、持久回执及必要用户审计必须同 D1 事务。
- 句子按申请人 user ID 写入本人句子卡，来源标记 document；两人相同句子互相隔离。词汇按本人 user ID 写入；已存在的私人词条不得覆盖注释，已删除条目不得未经用户同意重新启用。相同审批重试只返回原回执，来源身份或摘要冲突拒绝。
- 此节仅固定目标存储语义，不定义或开启任何服务端调用路由，也不证明文书源冻结、HomeFlow nonce 校验、目标传输或真实跨应用执行已经实现。任何接线前必须补齐这些验证、源撤权竞态、同 ID 失败恢复和端到端测试；现有 flags 保持默认关闭。


## I. 兼容补充 v1.0.3：文书现金执行跨服务 wire（§65 Draft）

此节修正 §C 中旧版「文书审批只返回 applied:false」的描述。以下为已实现但未部署的现金收入/支出协议；不扩展到 document.sync.homeflow、document.sync.study、信用卡、储值、积分、SBI 或其他非现金操作。所有 HMAC 输入固定为 domain + 换行 + 13 位毫秒时间戳 + 换行 + 未修改的原始 JSON 字节。

- HomeFlow → 文书助手：POST /api/internal/document-actions/execute，签名域 homeflow:document-execute；只读 /receipt 使用 homeflow:document-receipt。X-Approval-Client=homeflow。execute 精确字段 request_id,resource_id,household_id,requester_user_id,payload_sha256,execution_nonce；receipt 只有五个核心字段。使用独立 DOCUMENT_EXECUTION_SECRET 与 DOCUMENT_EXECUTION_SERVICE Binding。
- 文书助手 → HomeFlow：POST /api/internal/approvals/verify，签名域 jpda:execution-proof，X-Approval-Client=jp-document-assistant。上述六字段 + idempotency_key=jpda:sync:{candidate_id},expected_version:null,purpose:execute；必须复核执行中的租约 nonce、成员、审批人、身份、原始摘要。
- 文书助手 → 家計簿：POST /api/internal/document-finance/execute，签名域 jpda:finance-execute；只读 /receipt 使用 jpda:finance-receipt。X-Approval-Client=jp-document-assistant。execute 固定五个核心字段、account_id(32hex),account_version,type,amount_jpy,date,merchant,category,note,payment_source,operation_sha256,execution_nonce；receipt 仅五核心字段。名称不能代替稳定账户 ID。
- 家計簿 → HomeFlow：POST /api/internal/approvals/verify，签名域 kakeibo，X-Approval-Client=kakeibo；目标独立再次核对 request_id、household、requester、审批摘要、nonce、幂等键、执行中状态及当前人类角色。
- 家計簿 → 文书助手：POST /api/internal/document-actions/source-check，签名域 kakeibo:document-source-check，X-Approval-Client=kakeibo。五核心字段 + operation_sha256；源端重新复核 AES-GCM 快照、文书版本、候选版本、当前身份/撤权和持久 reservation，不向 HomeFlow 传文书正文。
- 文书助手 → HomeFlow 状态回读：POST /api/internal/approvals/document-status，签名域 jp-document-assistant:status；finance 方可读 executing、failed_retryable、applied；applied 必须有持久目标回执证据。其他文书操作继续 fail closed。

家計簿目标 D1 必须把 entries、不可变 document_finance_applied_actions journal 和真实 approver 审计同事务提交。回执包含 approval_id,candidate_id,household_id,requester_user_id,payload_sha256,entry_id,applied_at,approver_user_id,operation_sha256,already_applied。文书源 reservation 持久记录目标执行回执后，HomeFlow 方可根据精确回执标记 applied；文书 UI 还需对照源端结果才能显示最终成功。同一 request_id 的重复执行先查目标 journal，不能重复记账；过期未明结果只查 /receipt，不得执行新写入。

严格保持全部新增开关默认 OFF：HomeFlow APPROVALS_ENABLED / APPROVAL_EXECUTION_ENABLED / APPROVAL_VERIFICATION_ENABLED / DOCUMENT_EXECUTION_ENABLED，文书 DOCUMENT_EXECUTION_ENABLED，家計簿 KAKEIBO_FAMILY_FINANCE_ENABLED / KAKEIBO_DOCUMENT_FINANCE_EXECUTION_ENABLED / KAKEIBO_APPROVAL_PROOF_ENABLED。代码校验 APP_ENV=production 不构成用户的正式部署授权；在本阶段仅隔离测试环境可以注入非真实测试密钥、模拟 Binding 与 SQLite。必须以实际最新仓库 HEAD、精确 pin 的对端 SHA 和完整 CI 为准。

## J. v1.0.4：文书任务目标执行补充（仅 Draft / flags 默认 OFF）

本节在 §I 的金融目标之外，增加唯一允许进入 HomeFlow 任务目标内核的 `document.sync.homeflow`，不包含 `document.sync.study` 或任何非现金财务。**文书候选的批准只是执行许可，不能直接创建待办。**

| 方向 | 固定路由 / 后端签名 | 约束 |
| --- | --- | --- |
| HomeFlow → 文书助手源端 | `POST /api/internal/document-task/prepare`，HMAC 域 `homeflow:document-task-prepare` | `X-Approval-Client: homeflow`；精确 `request_id,resource_id,household_id,requester_user_id,payload_sha256,execution_nonce`；检查当前文书 owner/member、版本、候选更新时间、映射是否撤权，AES-GCM 解密冻住的候选；文书端回调 HomeFlow `POST /api/internal/approvals/verify` HMAC `jpda:execution-proof` 验证真实 executing nonce/lease；源端先建立持久 reservation，再只返回确认过的 `task` 七字段及 operation_sha256 |
| HomeFlow 本地 D1 事务内核 | `worker/document-task-apply.js`（不单独暴露 HTTP） | 必须先通过上方 backend 服务；检查活跃 HomeFlow owner/member 与原申请、未过期租约、nonce、request_id、候选/家庭/摘要及操作摘要；**复用 `/api/tasks` 的同一 validated/validateRefs**，保留实际 creator、assignee、visibility、bonusPoints 钱包额度、remindEnabled；一批 D1 写入完成 tasks、不可变 journal、真实 approver 事件与 approval applied；`client_request_id` 锁住同 ID 去重 |
| HomeFlow → 文书助手源端 | `POST /api/internal/document-task/receipt`，HMAC 域 `homeflow:document-task-receipt` | 五个审批核心字段 + `operation_sha256,task_id(UUID),approver_user_id,applied_at`，文书源端必须匹配已预约候选、实际 owner 本地映射、当前冻结摘要并持久保存不可变回执/审计；原任务若已创建但回执网络丢失，管理员再执行**仅重发原 receipt**，不得建新任务 |
| 文书助手 → HomeFlow 状态 | `POST /api/internal/approvals/document-status`，HMAC 域 `jp-document-assistant:status` | `document.sync.homeflow` 只在 HomeFlow target journal + `remote_id UUID` + executed_at/attempts 合法时回 `applied:true`；文书助手还要核对自己 `document_task_execution_reservations` 已 `applied` 且 task_id 精确一致，才把待办标为实际同步；仅批准、源端回执未达均不得显示成功 |

全部 HMAC 输入均为 **域名 + LF + 13 位毫秒时间戳 + LF + JSON 原始字节**；请求必须 POST、无浏览器 Origin/Cookie/Authorization、固定 X-Approval-Client 和5分钟签名窗口、后端独立密钥和 Service Binding。Document Assistant `DOCUMENT_TASK_EXECUTION_ENABLED` 和 HomeFlow `DOCUMENT_TASK_EXECUTION_ENABLED` **分别默认 OFF**，并需原有 HomeFlow APPROVALS_ENABLED / APPROVAL_EXECUTION_ENABLED / APPROVAL_VERIFICATION_ENABLED、APP_ENV=production 等全部显式通过。文书源端 migration `0025_document_task_execution_reservation.sql` 和 HomeFlow `0056_document_task_apply.sql` 均为未在生产执行的 Draft。

2026-11-14 已在隔离 GitHub Actions 的**真实两仓处理器**和独立内存 SQLite 下验证主执行链、双端状态、撤权前检查、双设备竞争、丢失源回执后同 ID 对账；固定参考 HomeFlow #306 `4a19fba5b3df09da05bdaf179ada7b893e59413e` 和文书助手 #97 `6735022c95bbd0b91a73febb0afbe0431fd3036a`。这些结果不等同生产 Service Binding/双 iPhone 验收；源端 reservation 执行期间权限撤销及失败终态的完全恢复、任务更新仍须后续深化。


## K. v1.0.5：知学文书执行目标端（仅 Draft，整体 P0-3 尚未贯通）

知学 #179 目前只实现目标端签名入口和独立 SQLite/D1 审批人审计。必须明确：文书助手真实 source-check、HomeFlow 给知学的执行租约验证和三仓编排仍未接线；切勿把模拟 Service Binding 的成功等同于跨仓完整验收。现有手动收藏路由不具有家庭审批执行权限。

已编写的目标端 Service Binding 契约（HMAC 输入均为 domain + LF + 13 位毫秒时间戳 + LF + 原始 JSON）：
- 文书助手 → 知学 POST /api/internal/document-study/execute，域 jpda:study-execute；签名客户端 jp-document-assistant；固定 request_id,resource_id,household_id,requester_user_id,payload_sha256,execution_nonce,snapshot。snapshot 原文字节的 SHA-256 必须等于 HomeFlow 冻结摘要，只能向本人学习数据目标发出，不能向 HomeFlow 传播私人词汇/句子。
- 文书助手 → 知学 POST /api/internal/document-study/receipt，域 jpda:study-receipt；同一签名客户端，五个核心字段；只读原始不可变 receipt，不执行新写入。
- 知学 → HomeFlow POST /api/internal/approvals/verify，域 it-study-platform:execution-proof；客户端 it-study-platform；五个核心字段、idempotency_key=jpda:sync:{candidate_id},expected_version:null,purpose:execute,execution_nonce。**当前 HomeFlow 真实校验端尚未登记此新客户端/密钥，必须继续 fail closed。**
- 知学 → 文书助手 POST /api/internal/document-actions/study-source-check，域 it-study:document-source-check；客户端 it-study-platform，现有 Study 调用方发送五核心字段。源端正式实现时应冻结增加 nonce 与来源执行 reservation 的一致性检查，并同步更改调用方和兼容测试。**当前文书端未接线，必须 fail closed。**

Study 目标 handler 不依赖手动收藏桥接；复用 §64 applyVerifiedDocumentStudy 原 D1 batch。新未执行 migration 0192_homeflow_document_study_approver_audit.sql 强制 requester≠approver、有效 member+owner、相同家庭、不可变审计。所有新开关和独立签名密钥、两个 Fetcher Service Binding 缺一即拒绝执行；DOCUMENT_STUDY_EXECUTION_ENABLED 默认 OFF。词汇目标 remote_id 内含私人词，未来 HomeFlow 只允许保存不泄露原内容的 opaque 请求标识。

已实际通过知学 #179 c4e7928ad3c94c2bcfdbfc92c3d646ebd45cb1ed 的完整 CI 43578236478；其中 Lease 与源检查均是签名模拟后端，并非其他两个仓库真实处理器。此结果不允许正式生产部署/迁移。


## L. v1.0.6：P0-3 文书→知学三仓可信执行（Draft；对 §K source-check 的兼容补正）

2026-11-14 在隔离 GitHub Actions 中，采用真实 HomeFlow、文书助手、知学处理器与三套独立内存 SQLite，验证完整三仓执行路径。**此节替代 §K 中「Study source-check 仅五字段、尚无持久 reservation」的待协调描述；不改变既有现金与任务域，不代表 F 阶段生产 Service Binding 或 iPhone 验收。**

### 可信签名与身份契约

所有内部调用：仅 POST、后端 Service Binding、`content-type: application/json`、禁止 Origin/Cookie/Authorization、`X-Approval-Client` 固定、13 位毫秒 `X-Approval-Timestamp` 在 ±5 分钟内、`X-Approval-Signature`=HMAC-SHA256(32 byte 独立 Hex 密钥, `domain + LF + timestamp + LF + raw_JSON_bytes`)。每个接收端严格白名单字段、检查当前独立 feature flag、签名/身份/摘要与未过期租约。不能用客户端声明批准状态或普通生词收藏 API 代替业务执行。

| 调用方 → 目标 | 路由 | 客户端 / HMAC 域 | 固定 JSON |
| --- | --- | --- | --- |
| HomeFlow → 文书助手 | `/api/internal/document-study/execute` | `homeflow` / `homeflow:document-study-execute` | 五字段 `request_id,resource_id,household_id,requester_user_id,payload_sha256` + `execution_nonce` |
| HomeFlow → 文书助手 | `/api/internal/document-study/receipt` | `homeflow` / `homeflow:document-study-receipt` | 仅五字段，只读目标回执及源端对账 |
| 文书助手 → HomeFlow | `/api/internal/approvals/verify` | `jp-document-assistant` / `jpda:execution-proof` | 五字段 + `idempotency_key=jpda:sync:{candidate_id},expected_version:null,purpose:execute,execution_nonce` |
| 文书助手 → 知学 | `/api/internal/document-study/execute` | `jp-document-assistant` / `jpda:study-execute` | 五字段 + `execution_nonce,snapshot`（AES-GCM 解密后的原始冻结 JSON 字节） |
| 文书助手 → 知学 | `/api/internal/document-study/receipt` | `jp-document-assistant` / `jpda:study-receipt` | 五字段，只读知学不可变目标回执 |
| 知学 → HomeFlow | `/api/internal/approvals/verify` | `it-study-platform` / `it-study-platform:execution-proof` | 五字段 + `idempotency_key=jpda:sync:{candidate_id},expected_version:null,purpose:execute,execution_nonce` |
| 知学 → 文书助手 | `/api/internal/document-actions/study-source-check` | `it-study-platform` / `it-study:document-source-check` | **五字段 + `execution_nonce`**；服务端必须确认同一持久 reservation，回 `reserved:true,snapshot_sha256,execution_nonce_hash`，目标必须核验 hash 与 nonce |

五字段全部与 HomeFlow 不可变工单匹配；operation 必为 `document.sync.study`，resource_type 必为 `document_sync_candidate`，source_app 必为 `jp-document-assistant`，target_app 必为 `it-study-platform`。Study 与文书助手分别持有各自独立 proof key；HomeFlow 只能对活跃 requester member、活跃 approver owner、审批非过期、`status=executing`、原 nonce 租约返回可执行证明。知学目标仅写 **requester_user_id** 本人私人词汇或句子，含不可变 journal 与真实 approver 审计，绝不通过 HomeFlow 存放明文词句。

### 独立绑定、持久恢复与状态

- HomeFlow：`DOCUMENT_STUDY_EXECUTION_ENABLED`（默认 OFF）、`DOCUMENT_STUDY_EXECUTION_SECRET`、`DOCUMENT_STUDY_EXECUTION_SERVICE`（到文书助手），`STUDY_APPROVAL_VERIFICATION_SECRET`（只验证知学 proof）。同时必须满足已有全局审批执行/验证开关。
- 文书助手：`DOCUMENT_STUDY_EXECUTION_ENABLED`（默认 OFF）、`HOMEFLOW_STUDY_EXECUTION_SECRET`、`DOCUMENT_APPROVAL_VERIFICATION_SECRET`、`DOCUMENT_STUDY_TARGET_SECRET`、`STUDY_DOCUMENT_SOURCE_SECRET`、`DOCUMENT_INTENT_ENCRYPTION_KEY`、`HOMEFLOW_BRIDGE_SERVICE`、`STUDY_DOCUMENT_EXECUTION_SERVICE`。新 migration `0026_document_study_execution_reservation.sql`，未在生产执行。
- 知学：`DOCUMENT_STUDY_EXECUTION_ENABLED`（默认 OFF）、`DOCUMENT_STUDY_EXECUTION_SECRET`、`DOCUMENT_STUDY_PROOF_SECRET`（必须与 HomeFlow 独立 Study proof key 对应）、`DOCUMENT_STUDY_SOURCE_SECRET`（与文书 source-check key 对应）、`DOCUMENT_STUDY_HOMEFLOW_SERVICE`、`DOCUMENT_STUDY_SOURCE_SERVICE`。Study 目标未执行 migrations `0191`、`0192`。
- 文书端只有源版本、candidate updated_at、真实 owner/member 关联、冻结 AES-GCM 解密摘要、HomeFlow nonce/租约全部匹配后才建立 reservation；执行期阻止源文书/候选变化。知学首次目标 D1 写入必须通过 **两个独立后端 proof**，事务内写私人生词/句子、不可变目标 receipt、真实申请人和审批人原子审计；重放同 ID 只读取原 journal。
- 知学目标原始词汇 `remote_id` 可能包含私人文本；文书源端可存真实目标 ID，但对 HomeFlow 只返回 **opaque candidate_id (32 hex)**。HomeFlow 只有收到包含 approver、原 request/candidate/household/digest、时间和此 opaque ID 的真实 source receipt 才标为 `applied`。文书 UI 进一步核对本地 reservation `status=applied` 与 HomeFlow `remote_id` 才显示“已同步”。
- 执行中网络超时/回执丢失使用原 `request_id` 对目标只读 `receipt`，然后在源端落地回执；不得重复创建词句或新审批。审批过期只能读原目标回执，不能发送新的 execute。跨 D1 并发撤权最终一致性、失效租约的源端回收策略、PWA 浏览器回归及正式双 iPhone / Service Binding 联调仍为 **未完成的安全验收项**。

**已核验**：HomeFlow #306 `tests/document-study-three-real-apps.test.mjs` pin 文书助手 #97 `ade2dba88f95a183a6bf31f73309a9792a6daa5e`、知学 #179 `496b06a021cdd1c822f49774b31a26f31bca9895`，三真实处理器/独立 SQLite 完整 HomeFlow CI `43584526633` success。三个功能 PR 保持 Draft，零生产迁移、零部署、零 Preview。


## M. v1.0.7：P0-4 第一组非现金执行——成员信用卡消费、共享支出和应付账款（Draft）

2026-11-14。**不覆盖 §I 的现金执行或 §K/L 的文书执行**。选择一组完整业务：`finance.credit_card.purchase`（信用卡购买，不是信用卡结算、储值卡、积分、SBI 或资产转移）。家計簿新未执行 migration `0031_family_card_purchase_execution.sql`，HomeFlow 未执行 migration `0054_household_approval_core.sql` 的草稿白名单同步加入此新 operation；两者均未出现在生产或 main。不能将运行中的生产 schema 假定已具备此列和 CHECK。

### 固定操作、身份和密钥

- HomeFlow 不可变请求：`source_app=kakebo`，`target_app=kakebo`，`operation=finance.credit_card.purchase`，`resource_type=credit_card_purchase`，`resource_id={32hex intent request ID}`，`idempotency_key=kakeibo:card:{resource_id}`，`payload_sha256` 是家計簿独立 AES-GCM 明文 JSON 的 SHA-256，`expected_version` 为该信用卡 `family_financial_accounts.version` 的整数，不得为 null。请求人是当前 `member`、拥有该 `member_created` `credit_card` `account_id`，批准人是**另一位**当前 `owner`。只有 HomeFlow 提供已审核并处于执行租约中的证明才允许目标写入。
- 审批提交：家計簿后端 → HomeFlow `POST /api/internal/approvals/card-submit`，`X-Approval-Client: kakeibo-card`，HMAC domain `kakeibo-card:submit`，32字节 Hex 独立 `CARD_SUBMISSION_SECRET/KAKEIBO_CARD_SUBMISSION_SECRET`；body 严格仅 `{household_id,requester_user_id,resource_id,payload_sha256,expected_version}`，不含消费金额、商家、卡号、密钥和现金账信息。
- 审批核验：家計簿目标 → HomeFlow `POST /api/internal/approvals/verify`，`X-Approval-Client: kakeibo-card`，domain `kakeibo-card:execution-proof`，独立 `CARD_APPROVAL_PROOF_SECRET/KAKEIBO_CARD_PROOF_SECRET`。body `{request_id,resource_id,household_id,requester_user_id,payload_sha256,idempotency_key,expected_version,purpose:'execute',execution_nonce}`，签名请求字节与当前 HomeFlow 不可变工单/活跃 member+owner/未过期 execution lease/nonce hash 精确匹配。
- 执行：HomeFlow → 家計簿 `POST /api/internal/card-purchases/execute`，domain `homeflow:card-execute`，独立 `CARD_EXECUTION_SECRET/KAKEIBO_CARD_EXECUTION_SECRET`；body 五字段 `{request_id,resource_id,household_id,requester_user_id,payload_sha256}` + `execution_nonce`。回执：`POST /api/internal/card-purchases/receipt`，domain `homeflow:card-receipt`，仅五字段；不得将不存在的回执当成可以安全重建一张卡账单的证明。内部后端 JSON 一律 POST、无 Origin/Cookie/Authorization、timestamp 13 位毫秒 ±300 秒、HMAC-SHA256(raw bytes)，所有 flags 默认 OFF。

### 事务结果、共享口径与恢复

- 源 intent 只以真实 `stable account_id` + `account_version` 表示卡，不依赖相同显示名。目标 AES-GCM 解密并核对 SHA-256、签名 HomeFlow 审批、当前账号版本 CAS 与 owner/member。目标单事务 `DB.batch` 插入一次 `entries` 家庭 `expense`（`client_request_id=hfcard:{approval_id}`, `family_account_id=account_id`, `payment_source=cc:{account_id}`，仅用于新家族稳定账号）、一次 `family_card_purchase_applied`（实际信用卡应付款，独立 bill_month）和一次不可变 `family_card_purchase_audit`（requester/approver 分离），失败全部 rollback。
- `bill_month` 为信用卡 **截账月**，依据购买日与卡片当时 `closing_day` 及短月夹紧计算，不推断账单付款日或银行已扣款。家計簿家庭账本两成员共享 `expense`；另提供按 `stable account_id, bill_month` 分组的累计应付，**不把这笔应付再次计入支出/不减现有资产**；未实装消费还款匹配，因此状态为 `not_reconciled`，不是银行真实未付余额或净资产。
- 同 ID 再入参仅返回不可变目标 receipt；即使目标提交后断网，HomeFlow `failed_retryable` 重用 **原 approval ID** 只接收原始目标 receipt，不再次借记或创建另一笔应付。状态只有目标成功提交并返回含 entry_id/approver/版本/摘要的真实回执后才 `applied`。任何浏览器自报批准无效。
- flags：HomeFlow `CARD_APPROVAL_SUBMISSION_ENABLED`, `CARD_APPROVAL_EXECUTION_ENABLED`, `CARD_SUBMISSION_SECRET`, `CARD_APPROVAL_PROOF_SECRET`, `CARD_EXECUTION_SECRET`, `KAKEIBO_CARD_EXECUTION_SERVICE`；家計簿 `KAKEIBO_CARD_PURCHASES_ENABLED`, `KAKEIBO_CARD_SUBMISSION_SECRET`, `KAKEIBO_CARD_PROOF_SECRET`, `KAKEIBO_CARD_EXECUTION_SECRET`，复用已经隔离的私有 `KAKEIBO_FAMILY_PENDING_KEY`、`HOMEFLOW_IDENTITY_SERVICE`。全域仍要求已存在的 family finance、SSO/identity、approval exec/verification 功能开关。

### 实际隔离验收与明确未完成项

- 家計簿 #309：`244535227826f6caa2258179ba30aa32162c7ad1`，两组完整 CI `43586044462`、`43586044499` **PASS**；真实 SQLite 交易、CAS 拒绝、失效身份、HMAC 伪造、审计 rollback、migration 重放和重复回执均已覆盖。
- HomeFlow #306：`tests/family-credit-card-real-cross-app.test.mjs` 真实导入 HomeFlow 审批提交/验证/执行和家計簿源端/目标执行，在**两套独立内存 SQLite** 上以模拟 Service Binding 传递签名 Request。实际成功测试通过、目标提交后断线同 ID 恢复、对批准/执行分离、成员撤权/旧版本 fail closed。HomeFlow 代码 `16e3e3d44bf920bf7fff0962c003b87415880fe6`，完整 CI `43586512718` **PASS**。这个 CI 使用 .contract-kakeibo 精确 pin 上述 Kakeibo SHA。
- **仍未完成**：信用卡还款真实现金记账/已结负债匹配、信用卡特殊扣款/积分兑换、储值/积分/SBI/资产转移、跨 D1 最终撤权竞态、HomeFlow+家計簿两台 iPhone PWA 浏览器级 UI 以及 F 阶段实际 Service Binding/生产迁移。不得把首类非现金成功描述成整个 P0-4 或 B–E 已完成。全部 PR 均 Draft、生产 flags OFF，零生产资源变更。


## N. v1.0.8：P0-4 信用卡还款及银行已发生扣款的人工核对（仅 Draft）

2026-11-14。此增补复用 §M 的原 family_card_purchase_applied 购买和应付来源，不创建第二套账单。操作 finance.credit_card.settlement 不是新的家庭消费、银行直连、自动到期扣款或退款冲正。以下代码和 migration 均在未合并的 Draft 分支；没有经过 F 阶段生产或 iPhone 实机验收。

### 家計簿源端申请

家計簿的 /api/family-finance/card-settlements 只在真实 HomeFlow member 会话及功能 flags 全部允许时处理本人申请；接收的字段严格为 expected_user_id、idempotency_key、card_account_id、card_version、bank_account_id、bank_version、debit_date、amount_jpy、bank_reference、statement_confirmed:true、allocations（每项 purchase_request_id + amount_jpy）。card 与 bank 均须是此 member 的 member_created、未归档、稳定 32hex 账户 ID 和当前 CAS 版本。purchase_request_id 为既有信用卡消费的 HomeFlow UUID，所有正整数日元分配之和等于本次还款且不得超过原消费尚未清偿的本金。

debit_date 是人工核对的银行实际扣款日期，不得晚于当前 JST 日期、早于任何待核销的原消费日期；不根据信用卡截账日、账单日或到期日推测。bank_reference 只在服务器计算以银行 account_id 域隔离的 SHA-256 reference_hash；AES-GCM 快照只存金额、日期、参考号哈希、stable ID 和分配信息；AAD = kakeibo-card-settlement:{intentId}，绝不将明文参考号传到 HomeFlow。银行流水证据本版本**依赖用户人工确认**，并没有第三方银行 API 验证。

HomeFlow 工单不可变字段：source_app=kakebo；target_app=kakebo；operation=finance.credit_card.settlement；resource_type=credit_card_settlement；resource_id={32hex source intent}；idempotency_key=kakeibo:cardsettle:{resource_id}；payload_sha256 为家計簿 AES 快照明文 SHA-256；expected_version 为 card.version 且必须 >=1。申请人是当前 member，审批并执行者是另一位当前 owner。HomeFlow 不存银行金额、账户备注、私人参考号或源快照。

### 冻结后端 wire / 独立签名

所有请求是后端 POST，必须没有 Origin、Cookie、Authorization；X-Approval-Timestamp 是 13 位毫秒时间戳（允许 ±300 秒），X-Approval-Signature = HMAC-SHA256(独立 32-byte Hex 密钥, domain + LF + timestamp + LF + raw JSON)。执行核心五字段固定为 request_id,resource_id,household_id,requester_user_id,payload_sha256；execute 额外 execution_nonce，receipt 不带 nonce 且只读不可写。

| 调用 | 路由 | X-Approval-Client / HMAC domain | 匹配密钥 |
| --- | --- | --- | --- |
| 家計簿 → HomeFlow 提交 | /api/internal/approvals/card-settlement-submit | kakeibo-card-settlement / kakeibo-card-settlement:submit | KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET ↔ CARD_SETTLEMENT_SUBMISSION_SECRET |
| 家計簿 → HomeFlow proof | /api/internal/approvals/verify | kakeibo-card-settlement / kakeibo-card-settlement:execution-proof | KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET ↔ CARD_SETTLEMENT_APPROVAL_PROOF_SECRET |
| HomeFlow → 家計簿执行 | /api/internal/card-settlements/execute | homeflow / homeflow:card-settlement-execute | CARD_SETTLEMENT_EXECUTION_SECRET ↔ KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET |
| HomeFlow → 家計簿对账 | /api/internal/card-settlements/receipt | homeflow / homeflow:card-settlement-receipt | 同上密钥、独立 HMAC domain |

提交 body 仅 household_id,requester_user_id,resource_id,payload_sha256,expected_version。proof body 为五核心 + idempotency_key,expected_version,purpose:execute,execution_nonce；HomeFlow 必须验证活跃 member/owner、当前 executing 租约、nonce 摘要和同一工单。HomeFlow 只用新 KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE Binding，不复用 §M 消费执行器。HomeFlow 新审批提交与执行 flags 分别为 CARD_SETTLEMENT_APPROVAL_SUBMISSION_ENABLED 与 CARD_SETTLEMENT_APPROVAL_EXECUTION_ENABLED；家計簿新 flag 为 KAKEIBO_CARD_SETTLEMENTS_ENABLED。全部默认 OFF，仍须原身份、家庭账本、审批执行和验证的全部基础开关。

### 家計簿原子记账语义

新迁移 0032_family_card_settlement_foundation.sql 只属于未合并 Draft 分支。目标在同一 D1 batch 内插入一次 family_card_bank_debit_evidence（真实日期、账户、参考号哈希、金额）、一次 entries.type=transfer（client_request_id=hfcardsettle:{approvalId}、family_account_id=bank_account_id、family_transfer_target_account_id=card_account_id）、一次 family_card_settlements_applied、各原消费的 family_card_settlement_allocations、最后一次 family_card_settlement_audit。唯一键、CHECK 和 SQLite triggers 阻止重用同银行交易参考号、同审批重复结算、超额分配、错误卡/银行、错误版次、早于购买日期的分配及缺失审计。已经落地的购买消费、银行转账及回执不可直接 UPDATE/DELETE。

家庭账目的一笔信用卡购买只算一次 expense；银行还款是转移资金而不是新的 expense 或 income。新应付投影按稳定 card account_id 和原 bill_month 计算 SUM(原购买)－SUM(真实已批准还款分配)，支持一笔扣款跨账期及部分还款，不能擅自声称银行实时净资产已计算。目标原始回执固定包含 approval_id,proposal_id,household_id,requester_user_id,payload_sha256,approver_user_id,actor_user_id,card_account_id,card_version,bank_account_id,bank_version,amount_jpy,debit_date,entry_id=transfer_entry_id,applied_at,already_applied。HomeFlow 只在校验上述核心身份/版本/金额日期结构并获得已持久化回执后标记 applied。网络丢失回执必须对同一审批 ID 查看不可变目标 journal；超过有效期后仅查 receipt，不再新增扣款。

### 不得误判已完成

当前隔离 CI 覆盖独立 HomeFlow 与家計簿 SQLite，真实签名处理器、审批租约、CAS、失败回滚、重复执行及丢回执恢复；仅证明隔离代码路径，不是 Cloudflare 生产 Service Binding、真实银行接口或双 iPhone 实机验收。

退款/冲正/已入账撤销必须另建立反向账务 journal；遗留账本匹配、跨 D1 最终撤权竞态、银行账户实时余额、全部 PWA 浏览器回归与 F 阶段生产迁移仍未完成。不得把 §N 表述成全 P0-4 或 B–E 已交付。


## O. v1.0.9：P0-4 本人新建储值卡银行充值、消费和余额流水（未合并 Draft）

2026-11-14。此协议独立于 §M 信用卡购买、§N 信用卡还款与 §I 现金执行。只面向 household member 新建并由本人持有的 stable account_id (32hex) / account_kind=prepaid；现有历史 Suica/PASMO/nanaco 等 legacy_payment_source 未转成新卡的账户余额，必须保留原数据及归属映射，不得按相同显示名称自动搬迁或重复计资产。所有新功能标志默认 OFF，未执行生产数据库迁移及未配置生产密钥。

### 两种不可混淆的财务操作

- finance.prepaid.topup：必须选择本人未归档、版本仍匹配的 bank 与 prepaid 两个独立稳定账户，提供确认确已发生的银行交易日期、日元正整数金额、银行流水参考号及 statement_confirmed:true。真实扣款日期不得晚于当前 JST，银行参考号只按 bank account_id 域 SHA-256 哈希保存，不复制明文到 HomeFlow。实际执行只记录 bank→prepaid 的 entries.type=transfer，不产生新的 expense。银行并非自动连接；日期和参考号仍为用户人工确认的事实。
- finance.prepaid.spend：必须选择本人 stable prepaid 账户，提供真实消费日期、金额、商家、分类与备注。执行只记一次 entries.type=expense，同时 prepaid 余额减相同金额；不得再把储值卡余额下降额计第二笔费用。任何余额不足、超过金额限制、CAS 不一致或撤权均拒绝入账。两个操作均不能复用信用卡应付 journal。
- source 准备但未批准时不改余额、不改共享正式账本。两种操作均使用家計簿 family_prepaid_action_intents AES-GCM 快照（AAD=kakeibo-prepaid:{request_id}）、独立不可变幂等键、HomeFlow 审批和执行租约。HomeFlow 工单：source_app=target_app=kakebo；operation=finance.prepaid.topup 或 finance.prepaid.spend；resource_type=prepaid_action；resource_id={32hex source intent ID}；idempotency_key=kakeibo:prepaid:{resource_id}；payload_sha256 为快照原始字节摘要；expected_version 为 prepaid.version。审批人/真实执行 actor 必须是另一个有效家庭 owner，不能依靠浏览器自报审批。

### 冻结独立 HMAC 和后端 wire

内部请求必须 POST、无 Origin/Cookie/Authorization，x-approval-timestamp 为当前 13 位毫秒 ±5 分钟。HMAC-SHA256 的输入为独立 domain + LF + timestamp + LF + 原始 JSON 字节，32-byte Hex Secret；不得复用信用卡购买/还款或现金密钥。HomeFlow 只收审批身份元数据与 SHA-256 摘要，不应接收银行参考号、商家、金额、账户展示名称或储值卡余额。

| 方向 | 路由 | X-Approval-Client / domain | 对应独立 secrets |
| --- | --- | --- | --- |
| 家計簿 → HomeFlow submit | /api/internal/approvals/prepaid-submit | kakeibo-prepaid / kakeibo-prepaid:submit | KAKEIBO_PREPAID_SUBMISSION_SECRET ↔ PREPAID_SUBMISSION_SECRET |
| 家計簿 → HomeFlow proof | /api/internal/approvals/verify | kakeibo-prepaid / kakeibo-prepaid:execution-proof | KAKEIBO_PREPAID_PROOF_SECRET ↔ PREPAID_APPROVAL_PROOF_SECRET |
| HomeFlow → 家計簿 execute | /api/internal/prepaid-actions/execute | homeflow / homeflow:prepaid-execute | PREPAID_EXECUTION_SECRET ↔ KAKEIBO_PREPAID_EXECUTION_SECRET |
| HomeFlow → 家計簿 receipt | /api/internal/prepaid-actions/receipt | homeflow / homeflow:prepaid-receipt | 同上执行密钥，不同 HMAC 域 |

submit 固定 JSON 字段 household_id,requester_user_id,resource_id,payload_sha256,expected_version,action（topup 或 spend）。execute 固定五个审批核心字段 request_id,resource_id,household_id,requester_user_id,payload_sha256 + execution_nonce，receipt 只有五核心，只读原不可变目标 receipt。proof 固定五核心 + idempotency_key,expected_version,purpose:execute,execution_nonce，要求未过期、status=executing、nonce hash、仍活跃 member+owner 和 payload 匹配。目标独立复核银行/储值账户当前真实版本及 owner/member 状态。HomeFlow 须具有 KAKEIBO_PREPAID_EXECUTION_SERVICE Service Binding。开关分别为 HomeFlow PREPAID_APPROVAL_SUBMISSION_ENABLED 与 PREPAID_APPROVAL_EXECUTION_ENABLED、家計簿 KAKEIBO_PREPAID_ACTIONS_ENABLED，依赖既有完整 SSO/家庭账本/审批全局开关；代码中 APP_ENV=production 条件不代表生产部署获授权。

### D1 原子事务、余额归属、回执

家計簿未执行 migration 0033_member_prepaid_actions.sql 添加 family_prepaid_action_intents、family_prepaid_actions_applied、family_prepaid_balance_journal、family_prepaid_action_audit；目标单 D1 batch 插入一次 entries（topup: transfer、spend: expense）、对应 applied、余额差额 journal 与最后真实 requester/approver/actor 审计，所有已提交数据禁止修改/删除。balance_after 必须与该稳定 prepaid account_id 在同一 SQLite writer 中的已有 SUM(delta_jpy) + 本次 delta 一致，且余额严格不得小于 0；错误或注入审计失败整批回滚。同银行 stable ID + 已使用的 bank_reference_hash 禁止再充值，避免重复扣款。不同审批 request ID 不得使用同一已提交来源银行交易证据。

target 不可变回执含 approval_id,proposal_id,household_id,requester_user_id,payload_sha256,approver_user_id,actor_user_id,prepaid_account_id,prepaid_version,bank_account_id,bank_version,action,amount_jpy,date,delta_jpy,balance_after_jpy,entry_id,applied_at,already_applied。HomeFlow 严核审批身份、版本、账户 ID、action、金额、delta 符号和余额字段后，只有真实目标 journal 已落地才进入 applied。同原 request_id 重试先读原目标 receipt；目标已提交但网络丢回执沿用原审批进行查证，不创建二次收入、消费或充值。过期仅允许只读回执，不得重新执行写入。

家庭共享资产视图新 member_prepaid 对象按 member_created stable account_id 聚合两位成员的 journal saldo，与原 legacy_payment_source 列表分开显示；只有分别真实记录后的余额可统计，不得猜测历史余额/银行现金余额或称之为全部净资产。真实生产数据库的历史预付账本如要映射，还须单独、经确认的无重复导入流程。

### 测试事实、明确边界

家計簿 tests/family-prepaid-action-execution.test.mjs 使用真实内存 SQLite 重放 0033 migration、双账号版本、两种支出/转账、余额与审计、重复请求、余额不足、同一银行流水重用、成员撤权、证明撤销、审计事务回滚，以及两人可读但原 owner 不变化的家庭余额投影。HomeFlow tests/family-prepaid-real-cross-app.test.mjs 与精确 pin 的家計簿真实源/目标处理器在两套独立 SQLite、模拟 Service Binding 中验证管理者审批、转账与消费相互隔离、原 ID 丢回执恢复及身份/CAS 失效 fail closed。必须以最新 exact SHA/CI 为准；模拟 Service Binding 不等于 Cloudflare 生产验收。

仍未做历史预付账户余额映射、独立 D1 撤权的真正跨库原子一致性、退款/充值撤销/提现/特殊折扣、真实银行数据同步、两台 iPhone PWA 实机及正式生产部署迁移。后续积分充值、积分兑换、SBI、资产转移应各建会计语义不同的 journal，不得直接复制此储值卡执行器。
