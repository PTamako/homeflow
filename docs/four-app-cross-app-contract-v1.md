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


## P. v1.0.10：P0-4 积分五种非现金操作真实跨应用契约（Draft，未部署）

日期 2026-11-14。本节只冻结已验证的五个积分会计 operation，不代表全积分账户、SBI、信用卡抵扣或储值卡积分充值完成；这些其余功能仍不可调用此执行器模拟对手资金凭证。HomeFlow 的家庭任务积分不是家計簿的财务积分账户，不能混用。历史 ポイント還元 income、历史 Suica/nanaco/SBI 积分资金及老支付方式仍留在原始账务，不重复铸币、不按显示名重新认领个人 owner。

### 当前允许的五个操作

1. finance.points.earn_campaign：真实活动/返点来源参考号（只存账户域 SHA-256 哈希），向本人稳定 points account 增加积分 units，不新生成现金收入。
2. finance.points.earn_purchase：关联本人已存在的 expense，并增加积分 units；原来的消费只统计一次。
3. finance.points.redeem_discount：本人明确确认已按积分抵扣后的实际现金金额记账的 expense 才能关联，减少积分 units，不新建第二笔 expense。
4. finance.points.redeem_purchase：只允许关联本人已存在的 point-funded expense，同时该 entries 的 family_account_id 与 payment_source 必须精确指向本人 stable points account；只减少 units，不再创造第二笔消费。
5. finance.points.expire：基于明确来源与有效日减少 units，不增现金 expense 或银行扣款。

真实积分账户均为 member_created stable 32hex account_id，owner_user_id 不得靠 label 推断。积分 units、日元 yen_value 和有理数兑换率 numerator / denominator 是独立字段；数据库校验比例相等，未验证市价时不把点数等于日元，不合计不同积分计划。余额必须满足 SUM(全部既往 units delta)+本次 delta >= 0。同一个账户域 source_reference_hash 不得二次发放；所有 journal 和真实 actor 审计不可变。

### Backend-only wire 与密钥严格隔离

家計簿源记录表 family_points_intents 使用 AES-GCM 快照，AAD 为 kakeibo-points:{32hex source request_id}；保留 payload_sha256、expected_version、requester、household、idempotency_hash 和 HomeFlow approval_id。HomeFlow 只保存最小审批元数据及摘要，不能读到账单、积分数量、购买对象和凭证。

HomeFlow 审批：source_app=target_app=kakebo；resource_type=points_action；operation=finance.points.{上述五项}；resource_id={32hex source request_id}；idempotency_key=kakeibo:points:{resource_id}；expected_version=points account version；payload_sha256=规范 JSON 原始 UTF-8 SHA-256。requester 为当前活跃 member，approver 与执行 actor 为另一位活跃 owner，目标须独立再次确认身份/账户版本及真正 HomeFlow executing 租约。

| 方向 | 路由 | Client / HMAC domain | 双端独立 32-byte hex secrets |
| --- | --- | --- | --- |
| 家計簿 → HomeFlow submit | /api/internal/approvals/points-submit | kakeibo-points / kakeibo-points:submit | KAKEIBO_POINTS_SUBMISSION_SECRET ↔ POINTS_SUBMISSION_SECRET |
| 家計簿 → HomeFlow proof | /api/internal/approvals/verify | kakeibo-points / kakeibo-points:execution-proof | KAKEIBO_POINTS_PROOF_SECRET ↔ POINTS_APPROVAL_PROOF_SECRET |
| HomeFlow → 家計簿 execute | /api/internal/points-actions/execute | homeflow / homeflow:points-execute | POINTS_EXECUTION_SECRET ↔ KAKEIBO_POINTS_EXECUTION_SECRET |
| HomeFlow → 家計簿 receipt | /api/internal/points-actions/receipt | homeflow / homeflow:points-receipt | 同上 execute 密钥，但独立 HMAC domain |

签名 HMAC-SHA256 输入 domain + LF + 13 位毫秒 timestamp + LF + raw JSON；时间窗口 ±5 分钟、无 Origin/Cookie/Authorization。submit 精确字段 household_id,requester_user_id,resource_id,payload_sha256,expected_version,action；execute 五核心 request_id,resource_id,household_id,requester_user_id,payload_sha256 + execution_nonce；receipt 仅五核心只读；proof 五核心加 idempotency_key,expected_version,purpose:execute,execution_nonce。HomeFlow 只有 executing + nonce hash + 未过期 lease + 当前 owner/member 都有效，才给 execution proof。HomeFlow 只用新的 KAKEIBO_POINTS_EXECUTION_SERVICE Binding；不得复用 prepaid/card/bank 同域密钥。

新独立 flags：HomeFlow POINTS_APPROVAL_SUBMISSION_ENABLED、POINTS_APPROVAL_EXECUTION_ENABLED；家計簿 KAKEIBO_POINTS_ACTIONS_ENABLED。均生产默认 OFF，另需原已有全局 SSO/APPROVALS/VERIFICATION/FAMILY_FINANCE 安全条件，禁止自动启用。

### 真正执行、审计与回执

家計簿 migration 0034_family_points_foundation.sql 尚未部署：family_points_intents、family_points_journal、family_points_actor_audit、family_points_legacy_links。已实现目标按原密文解密校验摘要、审批源与版本/角色/proof/余额；只插入一个不可变 point delta journal，SQLite trigger 同事务插入真实 requester/approver/actor 审计；这五种操作不创造任何新 entries.type=expense/income/transfer。回执字段 approval_id,proposal_id,household_id,requester_user_id,payload_sha256,approver_user_id,actor_user_id,points_account_id,points_version,operation,delta_units,balance_after_units,yen_value,linked_entry_id,applied_at,already_applied。HomeFlow 校验字段及申请一致后才可 applied；网络丢回执按原申请 ID 从 target journal 重读。过期只可只读 receipt，不得重新记一笔。

真实证明范围：家計簿 tests/family-points-foundation.test.mjs 和 family-points-execution.test.mjs（真实 SQLite、AES-GCM/HMAC、余额、原 ref 幂等、owner/CAS/撤权、审计）。HomeFlow tests/family-points-real-cross-app.test.mjs（两份隔离 SQLite、双方真实处理器、模拟 Service Binding、审批租约、无审批阻断、重复和丢回执恢复）。精确 CI/SHA 见交接文件 §76；模拟测试绝不等于生产 Service Binding 或双 iPhone 实机。

禁止声称完成：积分→储值卡、积分卡账抵扣、SBI ポイント投資、跨积分账户转移/兑换、反向冲正、积分完整历史归属、日元家庭资产估值与其他 P0-4/B–E，必须新建真正双边对手 journal 与更多 CI。已提交不可变财务 journal 不得 UPDATE/DELETE。阶段 F 生产迁移与上线仍须用户另授权。


## Q. v1.0.11：P0-4A 积分兑换本人储值卡双边原子凭证（Draft；§P 向后兼容扩展）

日期：2026-11-14。**仅**增加 `finance.points.transfer_prepaid`。冻结 §P 已通过的五个积分操作、AES-GCM AAD (`kakeibo-points:{source_request_id}`)、最小 HomeFlow 工单、HMAC 路由/密钥/签名域、nonce/lease/receipt 的不兼容变更一律禁止。HomeFlow 家庭奖励积分不属于家計簿金融 points，不能作为充值资金；不可将旧积分记录/旧储值卡余额自动转为可用资金。

### 业务语义与绝不越过的会计边界

1. 操作人必须是 HomeFlow 已认证的当前活跃 household member；积分源账户 `points_account_id` 和储值卡目标 `target_account_id` 均为其本人持有、`origin=member_created`、未归档、`opening_balance=0` 的不同 32hex 稳定账户，分别严格 CAS `points_version` 和 `target_version`（两者均 >=1）。另一成员的目标账户不能转入，管理员只能审批或审计、不能绕过源账户归属。
2. 正数 `units`、正数 `yen_value`（1～10,000,000 JPY）和 `rate_numerator` / `rate_denominator` 均需安全整数、独立精确保存；必须满足 **`BigInt(yen_value)*BigInt(rate_denominator) === BigInt(units)*BigInt(rate_numerator)`**，不能假设任何积分永远等于 1 日元。积分扣减后余额不可为负，储值卡加款余额只增加兑换日元，不生成现金收入、额外消费或银行流水。家庭统计不重复。
3. 积分源的现有 `POST /api/family-finance/points-actions` 请求保留 §P 的所有已需字段，**仅 transfer_prepaid** 在精确 schema 中额外必填 `target_account_id`、`target_version`。源 AES-GCM 密文规范 JSON 同样仅为该操作追加这两个字段；普通五操作没有这些字段，防止无关 payload 膨胀。源准备及 submit 都检查本人 target ownership/CAS；未审批不改变 points 或 prepaid 正式余额。
4. HomeFlow 工单仍 `source_app=target_app=kakebo`、`resource_type=points_action`、`operation=finance.points.transfer_prepaid`、`resource_id=32hex points intent`、`idempotency_key=kakeibo:points:{resource_id}`、`expected_version=points_version`、`payload_sha256`。HomeFlow 只得到这组身份/摘要元数据；**不接收** amount/points units/兑换比例/账户展示名/票据原文，审批 actor 与 requester 保持不同有效 owner/member。使用 §P 的 POINTS_* flags 和四条独立 backend HMAC domains，不开启新生产凭证或开关。
5. 目标须独立验证解密 sha256、两个账户 owner/household/版本、执行 lease/nonce、有效 approval proof，然后对 `family_points_journal` 写入负 `delta_units`、目标账户 ID、真实 JPY/兑换率。**尚未部署** `0035_points_prepaid_atomic.sql` 的 `AFTER INSERT` SQL trigger 自动插入 `family_points_prepaid_credits`，精确按原 journal `yen_value` 增加目标余额并冻结 `prepaid_version`。任何 CHECK、源/目标 CAS、余额、trigger、actor audit 写入失败，则整条 SQLite statement 回滚，不允许半条积分扣款。
6. `family_points_prepaid_credits` 不可 UPDATE/DELETE；其 `homeflow_request_id` 为主键/FK 指向唯一 point journal，余额后值是该 prepaid 稳定账户的 `SUM(family_prepaid_balance_journal.delta_jpy)+SUM(family_points_prepaid_credits.amount_jpy)`。新储值卡的本行余额、支出核验、真实支出执行器和家庭资产投影全用这个组合金额；此前银行充值原 `family_prepaid_actions_applied` 与银行流水凭证不被改写。禁止用 label 连接旧 Suica/nanaco。
7. 只读 target receipt 对所有 §P 原字段保持兼容，额外提供 `target_account_id`、`prepaid_version`、`prepaid_credit_jpy`、`prepaid_balance_after_jpy`（非 transfer_prepaid 为 null）。HomeFlow 仅对 transfer_prepaid 限定目标为合法独立账户、版本正整数、`prepaid_credit_jpy===yen_value>0`、合理且非负的 balance_after，并仅在原 approval ID 的真实目标双边落库回执得到确认后从 executing/failed_retryable 转为 applied。丢 target HTTP 返回时必须用原 ID 的 `receipt` 重查，不能再新建另一笔 points/prepaid 账务。
8. §Q 的「原子」仅表示 **同一家計簿 D1 SQLite writer 中的两边会计写入**；HomeFlow D1 与家計簿 D1 之间并无跨库事务，仍使用签名 lease、immutable journal、幂等与失败可重试/回执查询处理最终一致性。跨两独立生产数据库的撤权/租约竞态、真实 Cloudflare 身份配置和双 iPhone PWA 需要 F 阶段另验；不要把隔离 mock transport 当作生产认证事实。

### 代码与验证

家計簿 Draft #309：`migrations/0035_points_prepaid_atomic.sql`、`functions/api/family-finance/points-actions.js`、`functions/api/internal/points-actions/points-execution.js`、`functions/api/family-finance/prepaid-actions.js`、`functions/api/internal/prepaid-actions/[[path]].js`、`functions/api/family-finance/prepaid-balance-projection.js`。功能 commit `e7a04693f52019214c75bb5d1b7b445fee5f1288`、安全测试修复 `7fd5d19d22eb43b035dc3687437ce2e38359c669`、真实已兑余额再消费测试 `7ff41c69c50524dbb9e6acb177f4cc261a220341`。Validate **43599708124 success**、Mobile WebKit Smoke **43599708130 success**。

HomeFlow Draft #306：`worker/points-approval-submission.js`、`worker/approval-verification.js`、`worker/approval-execution.js`、`worker/approvals.js`、尚未部署 migration 0054 whitelist、`tests/family-points-real-cross-app.test.mjs` 和 `tests/family-prepaid-real-cross-app.test.mjs`。功能 `336e1c0530a5bda81975e90ba9f4f329d14aa0de`、测试修复 `3362202917e390524a7546bf8806f62ddf259108`；Validate **43599525955 success**。最终 CI 通过精确 SHA pin 后复验，实时状态以 PR 为准。

**禁止过度宣称：** `finance.points.offset_card` 信用卡应付冲抵、跨 points 兑换/转移、SBI 投资、积分冲正与原账无重复回填均仍未实现；本节不授予生产迁移、部署、合并或 Preview 授权。


## R. v1.0.12：P0-4A 积分抵扣信用卡具体应付与原银行还款 allocation 一致性（仅 Draft，非已部署）

日期：2026-11-14。仅增加第七种积分目标操作 `finance.points.offset_card`。它**不是** `finance.credit_card.settlement`：前者只扣金融积分并减少一笔已存在 purchase 的应付，后者必须有本人已核验银行真实扣款凭证，才能从银行→信用卡登记资产移转及 allocation。绝不能反向隐式提交现金转账或修改已记录的卡消费。

1. 请求与加密密文：复用 §P/§Q `kakeibo-points` 的现有 HomeFlow/HMAC/lease/proof/flags、`payload_schema_version=1`、最小 approval metadata、原 AES-GCM AAD 和 exact-key JSON。**仅 offset_card** 增加三个必填字段：`target_account_id`（本人 member_created credit_card 32hex 稳定 ID）、`target_version`（当前正整数 CAS）、`target_purchase_request_id`（特定 `family_card_purchase_applied.homeflow_request_id` UUID）。不允许以标签名称、账单月份、OCR 摘要匹配，也不得将这些私有财务字段发给 HomeFlow 审批队列。旧五操作及 `transfer_prepaid` 的 payload 不带 `target_purchase_request_id`。
2. 原积分稳定账户必须属于本次有效 member；目标 card 也需属于本人、同一家庭、`origin=member_created`、未归档、版本一致及 `opening_balance=0`。申请关联的已正式记账 card purchase 必须由本人申请、属于该卡和同一家庭；`purchase_date <= effective_date`。`units` >0、`yen_value` 在 1..10,000,000 JPY，严格 `yen_value * rate_denominator == units * rate_numerator`（BigInt 精度）；原 `linked_entry_id=null`，不会创建第二笔消费。
3. 家計簿未执行 migration `0036_points_card_offset.sql` 将 `family_points_intents` 增加不可变 `target_purchase_request_id`，按操作种类扩展尚未部署的 §Q target 类型 guard，新增 `family_points_card_offsets`（唯一原 HomeFlow request ID、不可 UPDATE/DELETE、FK 原 point debit/已记录卡 purchase、实际 card/owner/version、金额、结余、适用日和时间）。同一个 SQLite D1 statement 先确认 immutable point debit 再由 `AFTER INSERT` 自动生成 card 抵扣额并约束 `purchase.amount_jpy - bankAlloc - priorPointOffsets - currentPointOffset >=0`；任一侧失败则回滚两侧和审批人审计，无写入分裂。
4. 现有 `family_card_settlement_allocations` 校验触发器重新定义为银行款与 point offsets 的共享原消费应付上限；后来的银行 allocation 不得覆盖先前合法积分抵扣，后来的积分抵扣也不能超过既有银行已还额度。卡账准备接口 `/api/family-finance/card-settlements` 的余额预审、`/outstanding`、只读 `memberCardLiabilities` 均从相同两本 journal 汇总。卡账投影保持 `gross_charges_jpy`（原消费）、`settled_jpy`（只表示银行还款）、`points_offset_jpy`（只表示积分冲抵）和 `liability_jpy=gross-settled-pointsOffset`（>=0）分列，不得重复计入家庭消费/现金收入。
5. 执行器 target receipt 继承 §P 所有签名/身份/原始点数字段，非本操作的 card 字段为 null。**仅 offset_card** 必须返回真实 counterpart 的 `target_account_id`（32hex）、`card_version`（正整数）、`card_purchase_request_id`（UUID）、`card_offset_jpy===yen_value>0`、`card_remaining_after_jpy>=0`。HomeFlow 只有核对回执的 payload、requester/approver、owner 身份、lease/nonce 与这组双边金额后才将原审批置 applied。丢回执照 §P 用原 ID 的只读 `receipt` 获取已提交双边凭证，绝不可同一积分兑换重复记扣。
6. 同一目标 D1 writer 的双边原子提交 **不等于** HomeFlow D1 与家計簿 D1 全局原子事务；需要保留 failed_retryable+reconciliation、撤权竞态、严格不可变审计。一个旧银行还款申请即使先获得 approved，如果之后被合法积分抵扣占用了余额，执行时必须由数据库拒绝超额分配，仍需用户核对新金额并新建后续合法申请，不能偷偷修改旧 immutable bank evidence。
7. 测试审计基线：家計簿 #309 `migrations/0036_points_card_offset.sql`、`tests/family-points-execution.test.mjs`、`tests/family-card-settlement-execution.test.mjs`、`tests/family-card-settlement-foundation.test.mjs`；HomeFlow #306 `tests/family-points-real-cross-app.test.mjs` + `tests/family-credit-card-settlement-real-cross-app.test.mjs`，两份独立 SQLite 和真实处理器+模拟 Service Binding。功能/测试 SHA、Actions Run IDs 及仍未完成项必须查交接文件 §78 和最新 PR，避免旧 CI 被误认为最终跨仓 HEAD 的成功。
8. 生产状态 **全部 OFF**：新 migration 0036 与 HomeFlow 0054 扩展都只在 Draft 分支；不执行生产历史回填、变更 Worker/Pages/D1/R2/Cron/Secrets，不合并/不建 Preview；F 阶段实机验收必须另经用户许可。尚未涵盖积分账户之间兑换、退款/冲正、SBI ポイント投資、老卡债务自动关联或全部 P0-4/B～E。


## S. v1.0.13：P0-4A 本人积分账户之间的精确兑换与转移（仅 Draft，未上线）

日期：2026-11-14。§P～§R 保持兼容，仅新增 `finance.points.transfer_out` 和 `finance.points.exchange_out`。当前转入目标只允许**同一请求 member** 本人名下的另一个稳定 `account_kind=points` 账户；不支持跨成员转赠和任何对外真实积分机构 API。不能通过改储值卡、证券或现金转账接口来伪装点数转移。

1. 源 `points_account_id`（32hex）、`points_version`（>=1），目标 `target_account_id`（不同的 32hex）、`target_version`（>=1），均严格同家庭、同 requesting member、`origin=member_created`、`opening_balance=0`、未归档且当前版本 CAS。源发送的 AES-GCM payload 与准备请求仅对这两种操作增加 `target_account_id`、`target_version`、`target_units`（正安全整数 <=10^9）、`target_rate_numerator` 和 `target_rate_denominator`（各 1..10^9）；其余旧操作 schema 不含这些字段。
2. 源 `units` 和原计划 `rate_numerator/denominator` 均保持 §P 的 `yen_value` 精确 BigInt 比率。目标还必须满足 `BigInt(target_units)*BigInt(target_rate_numerator) === BigInt(yen_value)*BigInt(target_rate_denominator)`。**transfer_out** 严格要求相同的源/目标 units 和相同估值 numerator/denominator；**exchange_out** 允许不同 units/比率，但整个交易不能凭空创造或损失已确认日元价值。拒绝负数、未知兑换率、跨账户名称映射。
3. HomeFlow 工单一如原 `kakeibo-points` 极简审核，`resource_type=points_action`、`operation=finance.points.transfer_out` 或 `finance.points.exchange_out`、`resource_id=points intent 32hex`、`idempotency_key=kakeibo:points:{resource_id}`、`expected_version=points_version`、SHA256 密文摘要，不发送积分数、日元金额、兑换率或账户标签。原 points 四签名域、nonce/lease/owner 不同身份审批均保留，不增生产配置。
4. 家計簿未部署 migration `0037_points_transfer_exchange.sql`：一个真实 `family_points_journal` source 负 delta 插入通过 SQL `AFTER INSERT` 必须同语句生成 `family_points_transfer_credits` source-linked immutable target credit。新 credit 拥有同一 HomeFlow approval ID PK 和 source journal FK、requester/目标账户 owner/CAS/version、目标积分单位/余额、双方共同 yen_value 和日期审计；任何目标或 actor audit 错误必须回滚源减点，绝不可只完成单边写。
5. **任何帐户的实际可用 units** 定义为 `SUM(family_points_journal.delta_units WHERE points_account_id=id)+SUM(family_points_transfer_credits.target_units WHERE target_account_id=id)`；§P 原 journal 新事件负余额/after_units trigger 随 0037 一起升级，并影响源 executor 和 household read-only projection。严禁把跨不同积分计划的 units 无兑换证据相加成 JPY 资产；不得生成新的 cash income/expense/transfer entries，历史点数的 links 仍是只读证据不铸币。
6. 目标成功回执继续原 §P 字段，并且只在 transfer_out/exchange_out 返回非空 `target_account_id`、`transfer_target_units`、`transfer_target_balance_after_units`、`transfer_target_version`、`transfer_target_rate_numerator`、`transfer_target_rate_denominator`。HomeFlow 要核验 target 合法、target_units>0、after>=units、target units×target rate == source yen_value，并且 transfer_out target_units == -source delta；通过原签名与审批、原 ID 匹配后才能 applied，丢回执时使用原 ID 重试只读而不是重新转账。
7. D1 单库存储具备原子双边凭证，但 HomeFlow D1 与家計簿 D1 无全局事务；Lease、不可变回执、相同 ID 幂等和失败重试仍不可省略。真实 Cloudflare Service Binding、两台 iPhone、PWA 授权和生产数据迁移需要单独 F 阶段验收。本功能仅在五 Draft PR 的隔离 CI PASS：家計簿最终 SHA `f70607e1a78ff1ea68d89bf35dd77a1db7161387` Validate `43602934352` success、Mobile WebKit Smoke `43602934343` success；HomeFlow #306 最终测试 SHA `86237f2fd6ff2db25268bc644136d4af51e22564` Validate `43603269396` success。详细 Commit 与遗留事项查 §79。


## T. v1.0.14：P0-4A 原始积分发放、到期两类安全不可变反冲（仅 Draft，外部对手交易一律拒绝）

日期 2026-11-14；§P～§S 不变。增加 `finance.points.reversal`，但只允许**原记录 operation=earn_campaign、earn_purchase、expire**；其余原 points 交易目前全部拒绝反冲，不能用这条途径回滚已经兑换到储值卡、信用卡、另一个积分账户或 SBI 的资产。

1. 源本人请求 `familyPointsActions` 的 exact keys 沿用旧 points 字段，唯 `reversal` 额外必填 `original_request_id`（原审计 HomeFlow UUID），必须指向现存未冲正 `family_points_journal`、相同 household/requester/points account、同 `units=ABS(original.delta_units)`、同 `yen_value` 及估值分子/分母、`effective_date >= original.effective_date`。当前目标账户 stable ID/version 必须有效，别人的收益、没有原来源或已被反冲的 UUID 都禁止提交。
2. 加密密文 `original_request_id` 仅向家計簿目标发送；HomeFlow request 仍使用 §P 的 `resource_type=points_action`、`operation=finance.points.reversal`、`idempotency_key=kakeibo:points:{resource_id}`、`payload_sha256`、当前 points account version，owner/member 需当前有效、不同真实用户、唯一 lease/nonce。金额、旧交易来源仍不进入 HomeFlow 审批队列。
3. 0038 未执行 migration 在意向侧添加不可变 `original_request_id`，SQLite `BEFORE INSERT` 仅允许上述无资产对手的原业务；目标 `family_points_journal` 的新反向事件包含 `reversed_request_id` 并强制与旧 journal 的正负 delta 相反、价值及原 linked_entry 绝对相同。原事件不 UPDATE/DELETE，也不会重创一条消费或银行转账；反向 event 被唯一 FK 限制只能使用一次。
4. 新的 `family_points_journal` 反向插入和 `family_points_actor_audit` 同一 SQLite statement；原始发放扣回如果已有点数被花掉使余额负数，则整个反向写入拒绝，需后续专门的人工补偿流程，不得私自填平差额。误到期恢复是正向点数 credit，并必须有 HomeFlow owner 审核及新的来源参考。
5. 目标 receipt 返回 §P 原字段加 `reversed_request_id`（仅本操作为 UUID，其余 null）。HomeFlow 校验 receipt actor、原当前审批 ID、签名 digest、reversed ID 格式、delta 非零（正或负）、original linked entry 的合法编码、时戳/household，未知结果仍进入 failed_retryable，按原工单 ID 的只读 receipt 恢复而非再记账。
6. 家計簿 #309 最终本节 HEAD `5a2c35a182db3e62559836768813ddcf31b5657c`、Validate `43603748785` success / WebKit `43603748722` success；HomeFlow #306 源/目标真实跨仓测试功能 HEAD `4f167b558c322a083cfffa70909bce63cce212b6`、Validate `43603895452` success。均在隔离内存 SQLite 和模拟 Service Binding 验证，不等于生产批准。所有 flags 默认 OFF，严禁自动合并 Draft PR、部署、执行 production migration、Preview 或复写历史余额。


## U. v1.0.15：原所有者历史积分单向不可变关联及逐字段快照指纹（仅 Draft）

- 新后端 `GET/POST /api/family-finance/legacy/points-links` 在已有 HomeFlow SSO 家計簿 family-finance 身份检查之后运行，另外要求 `KAKEIBO_POINTS_LEGACY_LINKS_ENABLED='true'`、`APP_ENV='production'`，由**当前活跃 household owner 本人**发起。默认 flag OFF；该接口无审批外部调用和不写任何现金、积分日记账、旧 entries 金额或证券资产。POST 必须带同源 Origin、JSON、`expected_user_id` 与显式确认；切换 iPhone 用户时不得继承以前的操作人。
- 仅准 `family_finance_legacy_entry_links` 已经签过原 owner、`entries.family_account_id` 对应相同 origin=legacy/account_kind=points/owner 的历史收入或消费；目标必须是**同一 owner**的新的 member_created/points/未归档/开户余额=0 稳定账户。旧交易不可自动按商户名称或支付方式猜成员，也不允许将旧遗留 member 数据归 owner。
- GET 按 entry id 上限 5 条逐页，返回原稳定账户 ID、entry ID、date/amount/type/category、原始全行字段加旧 stable mapping proof 计算的 SHA256 摘要，只供审核，不传 OCR 全文。POST exact keys `expected_user_id,entry_id,points_account_id,legacy_kind,source_digest,confirm`。后端重新读全部原 entry 字段生成摘要，SQL 写点用所有字段条件 CAS；同时以一次 DB batch 插入不可变 `family_points_legacy_links` 与 0039 新 `family_points_legacy_provenance`（保存 SHA、原 owner、原 legacy account、new point account、金额/类型、审查时间），缺任何条件失败整体回滚；重复原 entry 原证据只可幂等同样回执，不能绑定第二个目标账户。
- 新 0039 migration 添加历史来源与目标 owner/household 验证、source journal 不能同时 mint 的冲突检查、provenance 不可 UPDATE/DELETE、已证明关联的旧 entry 不可 UPDATE/DELETE。当前 `memberPointsBalances` 只读显示历史链接数，**不将旧 JPY 收入冒充新的积分单位**，无需跨 D1 原子写入。
- 家計簿 #309 HEAD `56d6924027994d7e70f5b7d9b65ccfc44c964aa6`、Validate `43604672577` success、WebKit `43604672511` success；HomeFlow #306 pin `544c2498694337a3fc9b762a039da1481e9430c8` Validate `43604745668` success。为隔离 SQLite 和模拟服务验证，实际 Cloudflare 绑定/生产迁移/旧积分批量确认仍在后续 F 阶段，五 Draft PR 禁止合并。


## V. v1.0.16：SBI 确认成交的积分买付账务（仅 Draft，§U 兼容）

- 精确增加 `finance.points.redeem_asset`（原 0034 白名单已有占位，真实执行仅此新阶段开放），必须本人 points source 和本人 securities target stable IDs/版本、人工核实 SBI 确已成交的 fund_code 8 位、NISA account_type growth/tsumitate、正 `sbi_confirmed_units`、broker trade reference hash SHA256、明确确认成交；`units`、`yen_value` 与分数估值不可误差。所有原本非 SBI points 操作都不得包含这些独有字段。
- 源端 `family_points_intents` AES-GCM 完整密文冻结这些私有财务值及目标证券账户 owner/CAS。HomeFlow 只接触通用 `resource_type=points_action`、原 32hex resource ID、`operation=finance.points.redeem_asset`、source account expected_version 和 SHA256 payload，不接收成交内容和金额。原 lease/nonce HMAC/fail-closed 开关与 signer 不变。
- SQLite `0040_points_sbi_lots.sql` 中 `family_points_journal` 负 delta 与 `family_sbi_point_lots` 目标份额/取得成本严格同语句不可分割，receipt 增加目标 version、code、NISA 类型、units、acquisition cost、post balance、日期和券商证据 hash。原 trade hash UNIQUE、所有行不可 UPDATE/DELETE。HomeFlow 按严格非负/等值和身份/审批人校验后才能 applied。
- 旧 SBI `investment_holdings`、`investment_plans`、`sbi_transfer_links` 和旧截图估值不可被这个新点数事件静默覆盖或增加第二遍。只在单独标记 **unreconciled / excluded from tracked assets** 的 `member_sbi_point_lots` 投影展示新确认的份额/成本；还需要真实券商截图/份额重叠对账。没有真实下单、没有实际券商 API。
- 功能提交与完成实测 CI 见 handoff §82、§84；正式 Cloudflare/手机尚未验收。

## W. v1.0.17：跨积分账户双向冲正（仅 Draft；§S/§T 向后兼容）

- `finance.points.reversal` 的原交易安全名单扩展为 `transfer_out` / `exchange_out`。必须原 HomeFlow UUID 未被 reversals 使用、原 source/target owner 与 household、现时目标 CAS/余额、安全日期；原入账仍全数不可变，禁止猜测外部积分运营商余额。
- `0041_points_transfer_atomic_refund.sql` 在新反向 source journal 返还原来源 `ABS(old.delta_units)` 后，SQL AFTER INSERT 原子创建 `family_points_transfer_refunds`，在原目标积分账户扣除**原 credit.target_units**（异倍率兑换可与源点数不同）。新目标可用余额必须足够；不能擅自反向套用当前兑换比率，也不能只给源账户返还单位。
- 实际目标余额 = `SUM(journal.delta_units)+SUM(transfer_credits.target_units)-SUM(transfer_refunds.debited_target_units)`。源/目标钱包投影、write-path CAS、原 hash 和审计不可损坏。HomeFlow 回执新增 `refunded_target_account_id`、`refunded_target_units`、`refunded_target_balance_after_units`、`refunded_target_version`，只对应原 transfer/exchange 时为非空；原 receipt 及原 HMAC 不变，source/target 必须一致才能标 applied。
- 以 §83/§84 实际两仓完整 CI 为验收基线，生产仍 OFF。

## X. v1.0.18：积分兑换储值卡的双边补偿退款（仅 Draft）

- `finance.points.reversal` 另允许原 `transfer_prepaid`，并且 **必须**原可验证的 `family_points_prepaid_credits` 与同一成员稳定 prepaid target。新 source 反向 credit 恢复原点数；同一 SQL trigger 为该原 approval ID 生成唯一不可变 `family_points_prepaid_refunds`，按原精确 `yen_value` 扣减目标预付余额，不生成现金收入、expense、银行转账或券商记录；原 target 余额不足/目标版本漂移/多次/失败均阻断整笔 source 退款。
- 预付净余额统一为 `SUM(family_prepaid_balance_journal.delta_jpy)+SUM(family_points_prepaid_credits.amount_jpy)-SUM(family_points_prepaid_refunds.debited_prepaid_jpy)`，真实 prepaid spend 与家庭只读持仓均遵守相同余额；receipt `refunded_prepaid_account_id/refunded_prepaid_jpy/refunded_prepaid_balance_after_jpy/refunded_prepaid_version` 只对应原 prepaid refund，有 source/target 身份及原 approval、签名和目标不可变审计约束。
- 真正 CI 全通过基线：家計簿 #309 HEAD `60a82b528a05a7c92d703461c20d12f042b88dcc` Validate `43609431396` success、Mobile WebKit `43609431342` success；HomeFlow #306 真实跨仓最新修复提交 `4c5b6633d68d5822fa47df10acf76896ca28b5c2` Validate HomeFlow `43615838190` success。测试仅模仿 Service Binding 的两套隔离 SQLite、没有真实生产服务、银行账户或第三方积分系统转账。原 flags 默认 OFF；不得操作生产/Preview/自动部署或合并。


## Y. v1.0.19：积分冲销真实信用卡应付的不可变反向恢复（仅 Draft）

日期：2026-11-15，兼容 §§P～X 与既有已验收 card settlement/points-offset 业务。
1. 不新增加 HomeFlow 操作类型：`finance.points.reversal` 允许原 `finance.points.offset_card` 且仅可指向原同一 member 原 source points、原 stable card account 与唯一特定 approved `family_card_purchase_applied.homeflow_request_id`。新申请必须严格原始 `original_request_id` UUID、当前 source points version/家庭/owner、原 `units` / 比率 / `yen_value` 全等、`effective_date>=original.effective_date`。原积分/卡抵扣不可双重 reversal。
2. 同一个家計簿 D1 SQLite INSERT 的新 `family_points_journal` source credit（source points restored） + `family_points_card_offset_refunds` counterpart（original card purchase 未还额 **增加** 精确原 `yen_value`，不是新消费）必须原子；任何旧凭证缺失、target owner/account version 或已归档、提交 actor/approve/lease 失效、卡账 SQL guard 错误或审计故障都整笔回滚。新退款有唯一 HomeFlow request ID/原抵扣请求 ID、关联卡 purchase ID、card CAS、恢复日元、恢复后实际负债、actor 时间，不可 UPDATE/DELETE；原 `family_points_card_offsets` / `family_card_purchase_applied` / bank settlement/expense **一律不可改写**。
3. 所有 purchase-level 的 outstanding、卡负债汇总、后来的银行 allocation 与积分 offset 共享预算公式：`original_purchase.amount_jpy - SUM(family_card_settlement_allocations.amount_jpy) - SUM(family_points_card_offsets.amount_jpy) + SUM(family_points_card_offset_refunds.restored_jpy)`。按 purchase ID、owner 及账户 ID 核验，不用账单名、商家或文字；一笔原 offset 最多一次 refund，因此 net offset 永不合法为负。银行还款只有已签署银行 statement 的正式审批才能再使用释放的应付空间，退款本身不生成银行 debit 也不产生额外 income/expense。
4. Points 家計簿只读 receipt 增加 `refunded_card_account_id`、`refunded_card_version`、`refunded_card_purchase_request_id`、`refunded_card_offset_jpy`（必须==原 `yen_value` 且 >0）、`refunded_card_liability_after_jpy`（安全非负），非卡 refund 一律 null。HomeFlow 原 owner review / HMAC / lease/nonce/proof/receipt 只接受回执证明旧 journal 和 target counterparty 同时存在，核对原 actor/requester、source 交易 ID/原 refund ID/目标 stable 卡 ID 和签名 SHA256 后才能置 applied；丢响应须按原 approval ID 只读查验，不得生成第二次转账。新增五个字段不会绕开已有积分双边 transfer/prepaid 的严格校验。
5. Unexecuted migration `0043_points_card_offset_refund.sql`，功能/测试实际 SHA 见 handoff §85。家計簿 #309 **`970be36c43337117b1da6e51c5514dd3013182c2`** Validate **43617293723 success** / Mobile WebKit **43617293697 success**；HomeFlow #306 pin 同一 K SHA `a4adccd4db0a5f9173760120d3911f789555abf8` Validate **43617539406 success**。严格限定两套隔离真实 SQLite/模拟 Service Binding，没有生产 API 跑单；全部 Draft/flags 默认 OFF/不合并、不部署、不建 Preview，真实用户四 D1、R2、银行/券商不修改。


## Z. v1.0.20：P0-4B SBI 现金積立/追加買付的独立审批与不可变取得成本（仅 Draft）

2026-11-15。在 §§P～Y 冻结签名和既有信用卡/积分/储值卡执行域之外，只新增专用操作 `finance.sbi_cash.tsumitate`、`finance.sbi_cash.additional`，`resource_type=sbi_cash_action`；**禁止**通过现金消费、卡账核销或积分投资执行器冒充 SBI 银行买付。HomeFlow 只接收 `household_id,requester_user_id,resource_id,payload_sha256,expected_version,kind`（kind 为 `tsumitate|additional`），`idempotency_key=kakeibo:sbi-cash:<32hex>`；无银行流水文本、证券基金代码、实际金额或私人交易详情。

1. 本人 `origin=member_created`、未归档 `bank` 源和 `securities` 目标 stable ID / version 双 CAS、同 household 同 member；另一成员账户、旧不确定映射、旧截图及旧 NISA 计划不得凭名称自动认领。前端只能在明确有已发生的银行扣款和经使用者核实的券商成交后，才能提交 `bank_debit_confirmed=true,broker_execution_attested=true`；交易参考须逐个给出。前端原始描述、基金和金额仅保留在家計簿 AES-GCM `kakeibo-sbi-cash:<intent-id>` 密文。
2. 冻结完整内部 payload：源/目标 stable IDs 和版本、`kind`、实际银行扣款 `debit_date`、券商成交 `trade_date`、资产适用 `effective_date`（顺序不可颠倒/不能未来）、JPY 实际扣款与取得成本、8 位已核实基金代码、`growth|tsumitate` NISA、正的 broker-confirmed units、独立 bank reference hash、broker trade reference hash、明确确认状态。**只有明确申请 `tsumitate` 才计作定投**；仅凭有 SBI 文本不得默认定投，另外的 `additional` 仍是追加买付；积分买付仍按 §V 独立处理。
3. 新未部署家計簿 migration `0044_sbi_cash_purchases.sql`，`family_sbi_cash_intents`、`family_sbi_cash_bank_evidence`、`family_sbi_cash_applied`、`family_sbi_cash_lots`、`family_sbi_cash_audit`。目标经 HomeFlow 独立 `kakeibo-sbi-cash:execution-proof` HMAC 和真实 member/owner 审批、nonce/lease、账户版本、银行可用余额核验后，用**一次 SQLite D1 batch**不可分割写入银行证据、实际内部 `transfer` 条目（银行→证券）、已批准应用索引、券商确认 lot 和真实 requester/approver/actor audit。任一步，包括 SQL trigger 中银行余额、版本、重复扣款、重复券商交易、审计检查失败，整批回滚。有效扣款参考不能与已有信用卡银行还款证据重复；同一券商 trade reference 不能在积分 lot 与现金 lot 双计。已申请历史不 UPDATE/DELETE；不得以这一业务自动修改旧 `investment_holdings/investment_plans/sbi_transfer_links`。
4. 签名目标请求 `homeflow:sbi-cash-execute` 与只读核验 `homeflow:sbi-cash-receipt` 独立于其他金融操作，所有审批前保护、租约、已核实 requester/approver、审批记录 ID/digest、丢回执只读重查及审计沿用既有 HomeFlow 核心。receipt 必须回传同源 HomeFlow UUID、proposal ID、银行/证券 stable IDs、双方版本、资金实际扣款/成交/适用日、`kind`、买付成本/份额、broker hash、不可变 transfer entry ID、`applied_at`、独立真实 actor、`broker_reconciled:false,included_in_tracked_assets_jpy:false`；只有实际同一 D1 五种凭证存在且 HomeFlow 验证签名和必要回执字段才可 applied。
5. Cash lots 与原 §§V/§82 的 point-funded lots、旧基金持仓截图和市场 NAV **不直接累计**。`memberSbiCashPositions` 是所有家庭成员可读、但完全独立的 `unreconciled` 证券记录，成本和份额均不进入正式已计价家庭资产总额。原持仓重叠、未建交易 ID 的历史 SBI 买付、买付取消/卖出/退回资金、基金实时成交真实性、净现金余额跨历史所有银行 records 的无损调和，后续仍须专项 reconciliation 和双边不可变冲正，不能因为此 draft 内部记录存在就认为已核实。
6. 所有新 flags、秘密、Service Binding 仅出现为**代码读取的默认 OFF**，未操作任何线上配置；不发券商买卖单、不移动真实银行资金。不执行生产 migration、旧资产重建、Preview、Cloudflare 部署和 Draft PR 合并。隔离 CI 有两库真实 SQLite 和模拟传输，但不等于真实 Service Binding、金融机构交易证明、双 iPhone 或 F 阶段验收。完成证据以 handoff §86 和 GitHub 最新提交/CI 为准。

## AA. v1.0.21：P0-4B SBI 现金买付全额撤销、已到账银行退款与不可变基金 lot 反向凭证（仅 Draft）

日期：2026-11-15。对 §Z 的定投和追加买付采用**独立新审批** `finance.sbi_cash.reversal`，不是旧 approval 直接改状态，也不能当新收入或实际券商自动撤单。§§P～Z 原签名、lot 和 HomeFlow 申请保持完全不可变；仅 append 新协议及家計簿未部署迁移 `0045_sbi_cash_reversals.sql`。原操作仅通过原本的 `finance.sbi_cash.tsumitate|additional` 完成。

1. 资格与证明：申请者必须与原 `family_sbi_cash_applied.homeflow_request_id` 的 member/household 完全相同；原始银行扣款、证券成交 lot、份额、成本、稳定 bank/securities ID 及当前双方版本都必须存在、合法、未归档且为 member_created。新申请必须提供**明确已经完成的券商取消与银行真实到账退款**日期和各自独立参考、`bank_refund_confirmed=true`、`broker_cancel_confirmed=true`，并满足原成交日 ≤ 取消日 ≤ 退款日且退款日 ≥ 原适用日；未来或仅“申请退款中”的资金不得提前算入银行可用余额。交易证明仅是用户确认，**不是与 SBI/银行 API 自动核对**。
2. 只允许**完整原 lot** 的全额成本和全部份额反冲。部分卖出、红利、已赎回、历史净额难以证实或证券资金已被转出/消费导致可用证券净余额不足均拒绝，不得借本接口凭空给银行充值。跨成员账户、名称模糊匹配、旧持仓截图、积分买付等不能通过现金反冲接口处理；积分 lot 的安全反冲另行设计和测试。
3. Kakeibo 源 `POST /api/family-finance/sbi-cash-reversals` 准备、提交、取消和按成员列举，使用 SSO 真实 user 与同源 Origin，独立 `KAKEIBO_SBI_CASH_REVERSALS_ENABLED=true`（默认 OFF）；原 approval UUID、所有金融细节和两项确认状态冻结在 AES-GCM `kakeibo-sbi-cash-reversal:<32hex intent>` 密文中。HomeFlow 新 approval 只见 `household_id,requester_user_id,resource_id,payload_sha256,expected_version,kind:'reversal'`，`resource_type='sbi_cash_action'`、`idempotency_key='kakeibo:sbi-cash:'+resource_id`，不暴露银行摘要、基金名、金额或退款日期。
4. HomeFlow 采用 §Z 不变的专用 `kakeibo-sbi-cash:submit`、`kakeibo-sbi-cash:execution-proof`、`homeflow:sbi-cash-execute|receipt` HMAC 域、不同 owner 审核、nonce/lease、UUID 幂等、failed_retryable 和独立 target receipt 证明。未部署 HomeFlow `0054_household_approval_core.sql` 的 CHECK 白名单**追加** `finance.sbi_cash.reversal`，不可只修改 JS 列表而漏掉 SQL。HomeFlow `expected_version` 是原 bank 当前 CAS，securities 是目标额外 CAS；目标只在实际 `executing` 且当前 member/owner 活跃、审批签名有效时写账。
5. 家計簿一个 D1 原子 batch 追加四条不可变凭证：`family_sbi_cash_refund_evidence`（原审批、bank refund + broker cancel 双参考 hash 唯一、实际日期、精确全额）、`entries` 反向 `transfer`（`securities -> bank`、唯一 `hfsbicashrefund:<approval UUID>`；**不是 income**）、`family_sbi_cash_reversals`（同一原 approval 仅一次、准确原单位和成本）及 `family_sbi_cash_reversal_audit`（真实 requester/approver/actor）。原银行 debit、旧银行→证券 transfer、原基金 lot/成本、旧审计无 UPDATE/DELETE；原 refund 证据和反向 transfer 也不可修改/删除。任一账户版本、资金净余额、金额/日期、重复参考、外键或审计失败必须整个 SQLite batch 回滚。
6. 签名回执新增 `kind:'reversal'`、`original_request_id`、`bank_refund_hash`、`broker_cancel_hash`、`bank_refund_date`、`broker_cancel_date`、`original_transfer_entry_id`、`reversal_entry_id`，并保持 §Z 的原 bank/securities IDs/version、当前批准 ID、payload SHA、actor、正的原 acquisition_cost_jpy/confirmed_units、fund_code、account_type、原借/成交/适用日期及 `broker_reconciled:false,included_in_tracked_assets_jpy:false`。HomeFlow 必须同时校验操作类型、双退款证明和反向 entry≠原 entry；目标必须只读再次确认四条真实凭证后才能返回 applied。丢 receipt 使用**原新审批 ID** 的只读查证，禁止再创退款。
7. 只读 `memberSbiCashPositions` 对已反冲 lot 计算 `confirmed_units - reversed_units` 和 `acquisition_cost_jpy - reversed_cost_jpy`，保留原历史 lot、`confirmed_trades` 和 `reversed_trades` 以供追溯。新现金/积分 lot、旧 `investment_holdings` 合并截图、`investment_plans` 以及 `sbi_transfer_links` 均不擅自互相合并或计入新的家庭已估值净资产。尚无真实券商账户、成交与截图逐笔对账，不允许假称 reconciliation completed。
8. 验收要求：家計簿 0045 实际 SQLite 的完整迁移重放、双账户转账、摘要/原 lot 不变、同 ID receipt 恢复、负余额与版本漂移、错误审计 rollback、真实 reverse 余额投影；HomeFlow 两套**独立**内存 SQLite，精确 Git Commit SHA pin 真实目标 handler，owner approval/HMAC/lease、原始与反向审批两轮执行及响应丢失重试。CI 只是隔离自动化，不是真实银行或券商退款/两台 iPhone，也不代表四应用全部上线。
9. 与 §Z 向后兼容：从未有反冲的原定投/追加买付沿用旧回执/原数据，当前原操作服务与全部老签名域不变。新增开关默认 OFF，生产 Cloudflare Workers/Pages/D1/R2/Secrets/Binding/Cron、历史财务、银行和证券均未改变；五个 PR 始终 Draft，不执行生产 migration、不合并、不建 Preview。最新功能 SHAs 和 CI 结论以唯一交接文件 §87 为准。

## AB. v1.0.22：SBI 历史截图与现金/积分 lot 的**待核对证据候选**、原所有者与当前成员身份隔离（仅 Draft）

2026-11-15。严格兼容 §Z/§AA 的已提交及已全额反向现金 lot，以及 §V 的原积分 lot。不修改任何原 `investment_holdings`、`investment_plans`、`sbi_transfer_links`、`family_sbi_*_lots`、NAV 或家庭总资产值。只是不可变记录一个可供未来逐笔券商核对的“证据候选”，**绝不宣布两笔交易已经证明为重复、卖出成功或持仓正式已核验**。

1. 源资产身份：原新现金/积分 lot 都由**申请买付的 member** 持有，`source_owner_user_id` 与 `securities_account_id` 的当前稳定 owner 必须一致、有效、同 household、`origin=member_created`、账户未归档且证券 opening_balance=0；已完全冲正的现金 lot 不可新建候选。旧 `investment_holdings` 源截图可能属于家庭原 owner，与新 lot member **不得直接合并成同一人的账户**。只有已通过 `family_financial_resource_owners(resource_kind='investment_holding',legacy_key='<fund_code>:<account_type>')` 留下不可变历史 owner 认领的**当前家庭 owner**，才可审查这张原截图；新旧 owner 分列冻结，审核角色不可代替当前 lot 真实成员身份。
2. 旧截图是**可能聚合多笔、跨 NISA 帐户**的持仓快照，并不是一笔具体成交。禁止通过相同基金代码、名称、同一天、OCR 文本或似是而非的截图直接判断“这就是原买付”；尤其 `account_type='combined'` **不得**自动归属于 `growth` 或 `tsumitate` 新 lot。只容许相同精确 `fund_code` 和相同具体 NISA account_type 的**候选并列展示**，其状态始终 `pending_broker_reconciliation`，不影响老持仓计价或重复导入判断的最终结论。
3. 新未部署家計簿 migration `0046_sbi_legacy_holding_review.sql`：唯一 `(lot_type,lot_homeflow_request_id)` 的 `family_sbi_legacy_holding_candidates`，记录双主体 owner、旧 holding 每一字段（fund name、units、cost、reported value/date、updated at）、新 lot 金融事实快照、双 SHA256、原 36 字节审批 ID、审查时间。SQL trigger 对原 owner proof、active member 真实证券账号、旧截图**字段完全相等**的当前内容、新 lot 不变成本/单位/券商指纹和未被反冲逐条核对；审计 `family_sbi_legacy_candidate_audit` 用同一 SQLite `DB.batch` 原子写入。candidate、actor audit 不可 UPDATE/DELETE；源截图即使以后发生变化也不重写 candidate，而在只读投影标记 `candidate_snapshot_stale`。
4. 新 owner 专用 `GET/POST /api/family-finance/sbi-legacy-review` 受 `APP_ENV=production`、现有家庭 SSO、`KAKEIBO_FAMILY_FINANCE_ENABLED` 和**新增默认 OFF** 的 `KAKEIBO_SBI_LEGACY_REVIEW_ENABLED` 共同约束。GET 按 request UUID keyset 限 5 笔，返回原 member 的**独立** lot 与经老 owner 证明的旧 holding 精确 SHA256。POST 还必须同源 Origin、JSON、`expected_user_id`、`lot_kind='cash|points'`、原 lot UUID、独立 securities stable ID、源 lot digest、老 snapshot digest、`confirm_candidate_only=true`；后台重算所有金额/日期/owner/证据，变更即拒绝，禁止旧账号/另一成员自行确认。
5. 新 target 没有跨 App approval 或外部资金转账、不会触及 HomeFlow D1：只是**同一 Kakeibo D1** 的只读核对记录。返回永远 `broker_reconciled:false,valuation_changed:false,ledger_changed:false`，候选 `included_in_tracked_assets=0,source_trade_confirmed_as_historical_duplicate=0` 由 SQL CHECK 冻结。UI 不可据此加总旧截图和新单位，亦不能因为候选状态剔除真实银行余额；真实券商独立交易流水、实际 lot 回溯与去重验收仍需专项新证据与用户批准。
6. 已编写真实 SQLite 回归：原 owner 与新 member 不同、旧截图缺少不可变 owner 证据、combined/NISA 归属模糊、错误/过期 SHA 指纹、显式审核+重复幂等、原凭证与截图不被修改、旧截图改动后的 stale flag、不可变候选及 audit 故障时整批 rollback。功能 Commit/CI 详见 handoff §88。仍未完成全部 `sbi_transfer_links` 的原真实银行扣款/券商对应，不能将“录入候选”描述为“交易已对账”。
7. 本协议仅 Draft 代码及隔离 SQLite；生产 Worker/Pages/D1/R2/Secrets/Binding/Cron 未变，不创建 Preview、不合并五功能 PR、不执行旧持仓合并、金融机构交易、生产 migration 或自动导入。F 阶段必须取得用户批准及两台 iPhone 实机验收。


## AC. v1.0.23：SBI ポイント投資全额取消及发行方返积分的不可变双边冲正（仅 Draft）

日期：2026-11-15。本节扩展既有 finance.points.reversal，仅为既有 finance.points.redeem_asset 的原始审批对应一笔完整反冲，继续复用 HomeFlow 的独立 HMAC 签名、owner 审核、lease、nonce、幂等回执和重试。原积分 journal、券商基金 lot、旧截图、NAV 和既有所有原始审计均不得 UPDATE/DELETE。

1. 原始证据：必须存在同一家庭、同一 member、同一稳定 points/securities 账户的原 family_points_journal 与 family_sbi_point_lots，旧积分实际扣点、原基金单位和原取得成本完全对应。仅支持全额、唯一原审批 UUID 的反冲，部分卖出、已反冲及已进入历史截图候选流程的 lot 必须拒绝。独立 source points 和证券目标版本均要即时 CAS，家庭身份停用、跨成员或归属不明确一律拒绝。
2. 必须显式提交 SBI 券商**已完成取消**和积分发行方**已实际返还点数**两个确认及独立参考、两个实际日期；仅提交预计到账或待取消时不得创造点数。确认是用户显式 attestation，并非访问真实 SBI/积分商 API 后的机构确认。退款的 source_reference 必须与 sbi_points_refund_reference 完全一致；系统按独立命名空间记录券商取消 hash 与积分返还 hash，按原成交日 ≤ 取消日 ≤ 退点日 ≤ 新适用日且不可未来的时间链保护，不能直接生成新的现金 entries。
3. 新增尚未部署 Kakeibo migration 0047_sbi_point_full_refund.sql：给原 family_points_intents 添加五个不可变取消/返还证明字段并扩展原反冲 whitelist，保留所有旧 points/prepaid/card/transfer 审计及校验。在一笔新正向 points reversal journal 的同一个 SQLite INSERT 的 AFTER trigger 创建唯一 family_sbi_point_refunds：关联原不可变基金 lot、证券版本/账户、原基金单位、原成本、实际返回原积分单位、真实 member 与 owner approver/actor、两个不可重用证据 hash 与日期；任何一个 target 证据、当前 owner、版本、重复参考、现时份额/成本或 actor audit 冲突则整体回滚。
4. 目标的签名回执只有从原 journal + 原基金 lot + 新反冲凭证重新读取并逐字段相等后才可返回 applied。仅本反冲有 refunded_sbi_securities_account_id、refunded_sbi_securities_version、refunded_sbi_units、refunded_sbi_cost_jpy、refunded_sbi_points_units、refunded_sbi_broker_cancel_hash、refunded_sbi_issuer_reference_hash、refunded_sbi_broker_cancel_date、refunded_sbi_points_returned_date、refunded_sbi_evidence_kind、refunded_sbi_fund_code、refunded_sbi_account_type 和 refunded_sbi_original_trade_hash。HomeFlow 逐项验证金额、份额、对应原基金、日期/两个证据、审批人、目标 ID、原新 UUID 与 HMAC，才把 approved/executing 变成 applied。跨 HomeFlow D1 与 Kakeibo D1 不存在全局原子事务；按原 request ID 的只读回执恢复，禁止再次 mint。
5. 家庭只读 memberSbiPointPositions 以原始单位/取得成本减去合法全额 reversals 计算净持仓，保留原 lot、原取得成本及 reversed_trade_count；始终 broker_reconciled=false、included_in_tracked_assets_jpy=false，不与旧 investment_holdings/sbi_transfer_links/基金 NAV 或现金 lot 自动合并或双重估值。真实券商流水、积分发行方 API 与历史截图未做独立机构逐笔对账时，一律维持未对账标记。
6. 真实自动验收：Kakeibo #309 功能 SHA d8f357f8bc08c6d5e710380f701b1c17641bfe7c，Validate 43675660210 success、Mobile WebKit Smoke 43675660094 success；HomeFlow #306 功能 SHA fe9a397deb2c12042c476f0f504b059e63c293eb，Validate HomeFlow 43675812986 success。真实两套独立 SQLite、双方真实 handler、模拟 Service Binding，覆盖原买付、积分完整返还、账户版本漂移、target 故障全部回滚、同审批重复执行与丢回执恢复；本测试不是机构联网操作或双人 iPhone 实机验收。
7. 一切新代码仅位于原五个 Draft PR，新增 KAKEIBO_SBI_POINT_REFUNDS_ENABLED 代码开关默认 OFF；未更改正式 Workers/Pages/D1/R2、Cron、Secrets、Service Binding、生产金融数据、真实银行与 SBI 账户。不合并、不开 Preview、不跑正式迁移、不自动部署。本节真实 Commit/CI 和剩余 P0-4C/B～E 清单以 handoff §89 为准。


## AD. v1.0.24：P0-4C 家庭审批中心批量审核的全有或全无 CAS / 审计与安全回执（仅 Draft）

日期：2026-11-15。严格复用原 HomeFlow §D 审批状态机与已冻结的金融 execution、lease、nonce、HMAC 契约，不修改任何已批准银行/证券/积分/储值卡操作的目标执行器，也不把批量 review 当作批量执行入账。

1. 独立默认 OFF 的 HomeFlow 代码标志 APPROVAL_BATCH_REVIEW_ENABLED=true 才开放新的 POST /api/approvals/batch-review 和 GET /api/approvals/batch-review/{batch_id}。既有 APPROVALS_ENABLED 必须同时为 true，调用者必须是真实会话+实时数据库 verified owner；GET 只允许该 owner 读取自己的批次回执；POST 必须通过原 HomeFlow 同源 Origin/登录/家庭验证。当前 iPhone 切换家庭账号后 expected_user_id 不匹配立即拒绝。
2. POST exact JSON：batch_id 为唯一 UUID、decision 仅 approve 或 reject、expected_user_id 为当前 owner、items 为 1～20 个不同原始 request_id UUID + 每笔正整数 expected_version CAS。不得包含金额、金融账户、凭证文本、开放式 SQL 或 target URL，不允许同一批次向不同家庭申请混送。保持 user 提供的 items 顺序与版本做固定 JSON manifest + SHA256，复用相同 batch_id 且 manifest/actor/household/decision 完全相同只能返回原审计回执，任何异值一律 idempotency_conflict。
3. 未部署 HomeFlow migration 0057_household_batch_reviews.sql 创建 immutable household_approval_review_batches 表，精确绑定家庭 owner、哈希、items、decision 和执行日期；一条 SQLite INSERT 的 BEFORE guard 必须在提交时逐一检查：相同 household，owner 当前活跃，不是请求人自批，所有申请都仍是 pending、未过期、原成员当前有效、request.version 与 expected_version 精确一致、无重复 ID、数量正确。AFTER trigger 在同条 SQLite statement 中统一 UPDATE 所有申请 status=approved|rejected、reviewed_at、approver_user_id 和 version，并为每个 request 插入独立 household_approval_events owner actor immutable 审计；更新数和审计数必须分别全等 item_count，否则整个 SQLite 语句回滚，没有一笔部分批准。
4. 一次审核不调用 Kakeibo 等任何目标 App Service Binding、不写实际 D1 金融 entries，不创建资产、冲正或转账。reviewed=true 与 applied=false 永远分列；owner 必须之后使用原每笔 approval UUID 的签名单独 execution+receipt 才可 applied。多个独立 D1 的跨应用操作继续没有全局事务，批量审核不能推断目标跨仓均已执行，也不得将 failed_retryable 自动改为 applied。
5. HomeFlow UI ApprovalCenter.vue 只在后端安全发现 batch_review_enabled=true 时为真实 owner 展示当前页（通常最多 5 个 pending）选择框与“批量批准/批量拒绝”，二次确认文案明确审核不入账。提交前后守住 account epoch、item.version 与当前筛选及身份，离线/网络丢回复时保留原 batch_id 并以 GET receipt 核验，不自动生成第二批。旧单笔批准/拒绝、撤回、执行、安全重试原路不变，特性默认 OFF 不影响当前正式 UI。
6. 安全验收包括 tests/approval-batch-review.test.mjs 真 SQLite 测试：完整审批多项+真实独立审计、同批重试/冲突、过期/已批、CAS drift/重复 ID/外部 ID、当前成员停用/owner 停用、审计异常与原子回滚；原 tests/household-approvals、approval-execution-feedback、rewards-shop、迁移 manifest + Vue build/Worker dry-run 均不删除断言，随着新增真实 0057 迁移更新固定数目 fixture。最终功能 SHA 37c45cd33f568f00469390d52afcb362fc7153c5，Validate HomeFlow Run 43676772681 completed/success。完整证据与未完成的金融转账、恢复、周期授权详见 handoff §90。
7. 五个功能 PR 始终 Open/Draft，本节绝不执行生产 D1 migration、修改生产 Worker/Secrets/Service Binding/Cron/R2/Pages、创建 Preview、合并功能 PR 或改变真实银行/证券账户。F 阶段上线和两台 iPhone 实机验收需要独立许可。


## AE. v1.0.25：P0-4C 本人双银行**实际扣款+实际到账**的资产转移与独立家庭审批（仅 Draft）

日期：2026-11-15。§P～§AD 保持兼容。新增 `finance.asset_transfer.bank_to_bank`，只能表示**已经发生且在转出、转入两个本人银行账户都能核实的转账**。不是新收入/消费/储值卡充值、证券买付、跨成员资金代付或银行 API 汇款；不把 HomeFlow 家庭 owner 的审核认作银行实际执行、银行确认到账或跨 D1 全局原子事务。

1. 新申请只允许当前有效 household **member 本人**名下两个不同 `account_kind='bank'` 的 32hex 稳定账户 ID，二者都要 `origin=member_created`、未归档、同 household、owner 是原 requester、当前 `source_version` 与 `target_version` CAS 均匹配。不同 owner（跨成员）、现金、证券、储值卡、信用卡和归属未证实的历史账户**不得复用本操作**；跨成员转账未来需要收款人独立确认与权限模型。
2. 源 exact JSON：`expected_user_id,idempotency_key,source_account_id,source_version,target_account_id,target_version,debit_date,credit_date,amount_jpy,source_bank_reference,target_bank_reference,bank_debit_posted,bank_credit_posted`。必须**真实源银行已扣款+目标银行已到账**都为 true、各自完整参考和金额精确相同，日期顺序 `debit_date<=credit_date<=当前日本日期`，JPY 正整数 1..10,000,000。任何一边仅预计、待处理或未证实，不得创建到账凭证或银行余额；使用者提供这两份信息属于**用户 attestation**，并非本系统直接登录银行核验。
3. Kakeibo 源 `POST /api/family-finance/bank-transfers` 保存 AES-GCM `kakeibo-bank-transfer:<intent-id>` 密文。源/目标 stable ID、版本、原始银行 reference digest、两种日期与金额只留在 Kakeibo；HomeFlow 独立 HMAC 入口 `/api/internal/approvals/bank-transfer-submit` **只接收** `household_id,requester_user_id,resource_id,payload_sha256,expected_version` 五字段，`resource_type='bank_transfer_posted'`、`operation='finance.asset_transfer.bank_to_bank'`、`idempotency_key='kakeibo:bank-transfer:'+resource_id`。现有 owner/member、不可变状态机、签名/lease/nonce 与记录期满检查完全保留。默认关闭 `KAKEIBO_BANK_TRANSFER_ENABLED` 和 HomeFlow `BANK_TRANSFER_APPROVAL_SUBMISSION_ENABLED`，不自动部署任何 secret/binding。
4. 专用签名域：Kakeibo→HomeFlow 提交 `kakeibo-bank-transfer:submit`，执行证明 `kakeibo-bank-transfer:execution-proof`，HomeFlow→目标 `homeflow:bank-transfer-execute` 与只读 `homeflow:bank-transfer-receipt`。禁止复用 SBI、信用卡还款、积分账户或通用现金执行 secret。Kakeibo 真实目标只有在 HomeFlow 最新审批为 `executing`、nonce/lease/本人+owner 身份仍有效、两银行账户 CAS 没变、原审批 SHA 完全一致时，才准执行。HomeFlow 新 `BANK_TRANSFER_APPROVAL_EXECUTION_ENABLED`、专用 execution/proof secret 和 `KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE` 均为**代码要求而不是已配置的生产资源**。
5. 未部署 Kakeibo migration `0048_posted_bank_transfers.sql`：`family_bank_transfer_intents`、`family_bank_transfer_posted_evidence`、`family_bank_transfers_applied`、`family_bank_transfer_actor_audit`。新完整目标 D1 `DB.batch` 原子写入**双边已到账证据、单一 `entries.type='transfer'` 的 `source_account_id→target_account_id`、新审批 application/资金核算约束、真实审计人**。一笔 transfer 必须源额扣一次、目标额入一次，源银行 opening + 所有已记录转账/消费等结果不得负值；不产出第二笔 expense/income。新银行 statement digest 不得与已用 SBI 现金买付、SBI 退款、信用卡银行扣款或另一条已核验银行转账复用，双向 BEFORE triggers 防止先后冲突。原与新证据、转账 entry、审批人审计均不可 UPDATE/DELETE；任一错误包括 audit 失败整笔回滚。
6. 新目标 receipt 必须由同一 D1 重新读取这四组不可变记录，返回 `approval_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,payload_sha256,source_account_id,source_version,target_account_id,target_version,amount_jpy,debit_date,credit_date,source_reference_hash,target_reference_hash,entry_type:'transfer',transfer_applied:true,balance_conserving:true,transfer_entry_id,entry_id,applied_at`。HomeFlow 严格核对每个字段与签名/owner/当前申请及两种银行 SHA 才能 `applied`。失联、目标已提交而回应丢失，只使用**同一原审批 UUID** 的只读 receipt 回查，不得二次移动账面现金或再次登记同一凭证。跨 HomeFlow D1 与 Kakeibo D1 **没有全局原子事务**，使用既有 `failed_retryable` 和持久 lease/reconciliation 处理不确定状态。
7. Member PWA `FamilyFinanceBankTransfers.vue` 只在 family-finance SSO、后端新能力打开、本人成员权限及两个本人银行账户存在时展示可用流程；先录两边原始日期、参考及已确认勾选，仅加密 prepare，然后提交家庭审批，HomeFlow owner 之后单独执行。切换账号/页面前后台会清理临时参考号，服务返回的同一请求 ID 草稿可重新选取提交，防止同一笔交易因刷新重复记账。HomeFlow `ApprovalCenter.vue` 独立显示“已到账银行间资产转移”，不称为新收入或证券投资。
8. 测试用 Kakeibo SQLite 真正加载 `0006,0025,0031～0048` 及真实 source/target handlers，验证分别确认/未确认的银行参考、身份/账户版本和归属、双边 balanced transfer、原资金负余额拒绝、参考号重复、SQL audit 故障 rollback、同一审批 receipt 幂等；HomeFlow 两套**独立**完整 SQLite + 新真实 K handlers/模拟 Service Binding，真实 owner review→execute→applied、目标入账后回复丢失同一 ID 恢复、撤权/故障不留单边资金。测试最终 SHAs/Run IDs 以唯一 handoff §91 及 GitHub Actions 最新结果为准，WebKit Smoke 不是双台真实 iPhone。
9. 本节**不声称**已经完成银行↔现金、银行↔证券不伴随基金买付、储值卡之间或跨成员真实转账、双成员批准、旧银行数据匹配/恢复、批量金融目标执行和所有 PWA R1～R9/T01～T14。任何新增 flag/secret/binding 均只在隔离 Draft 源码被读取且生产默认 OFF；未操作生产 Workers/Pages/D1/R2、迁移、Cron、Secrets、Service Binding、真实银行或 SBI，未合并五 Draft PR、未建 Preview。正式上线和实机 F 阶段仍需用户另外批准。


## AF. v1.0.26：P0-4C 跨家庭成员资产转移的**双人真实同意＋管理员单独授权**、撤销与只读 HMAC 证明（Draft；**非资金执行闭环**）

日期：2026-11-15。本节仅新增 HomeFlow D1 授权前置状态机，不改变前面 §AE 的**本人**银行↔银行双边已到账记录；旧身份/积分/SBI/普通审批与财务回执冻结契约照旧。

1. **两位不同真实 HomeFlow 用户，不等于两个前端布尔值**：登录源 `source_user_id`（家庭 owner 或 member）使用完整服务端 SSO session 创建不可变原申请，原行为即本人发起和确认。收款人 `recipient_user_id` 必须是同一 household 的**另一位**活跃 owner/member，使用自己独立有效的真实 SSO session 执行 accept/reject，不能凭 source 的前端声明替代其同意。家庭 owner **另行**执行 `authorize`，其角色每次重新从 D1/活跃 users 验证；即使 owner 就是收款人或转出人，也必须分别点击接收/发起和管理员授权，不能把同一次事件当作两个审批。任何禁用、跨家庭、来源目标同一个 user、伪造 session role 与非同源 POST 都拒绝。
2. 尚未部署 HomeFlow `0058_cross_member_transfer_consents.sql`：专用不可变 `household_cross_member_transfer_consents` 和逐次 append-only `household_cross_member_transfer_events`。只存 `consent_id`、家庭/双方 user ID、Kakeibo 待联动 `resource_id` 32hex、`payload_sha256`、两方开户账号**预期版本号**、scoped idempotency SHA256、创建/决定/管理员授权时间和 actor。**不存**原账户名称/银行账号、转账金额、两边实际银行原文/流水参考、卡号、邮件/文书原文。原资源/双方主体、两个账户版本、SHA、idempotency、到期时间严格 immutable。单一 D1 SQL `INSERT/UPDATE` 的触发器检验在写入时的活跃成员身份、双方不同、实际权限、前状态、expected_version CAS、24h 内不可延长时间窗，且**同一 SQLite 语句**自动插入独立 actor/action/version/time 审计；审计触发器失败会使状态变更全部回滚。任何无效多次重放只读原状态，不追加重复事件。
3. 受两个默认 OFF flag `APPROVALS_ENABLED` 与 `CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED` 限制的已认证 API：
   - `POST /api/finance-cross-member/consents`：exact `expected_user_id,recipient_user_id,resource_id,payload_sha256,source_account_version,recipient_account_version,source_confirmed=true,idempotency_key`，新申请标记 `awaiting_recipient`，创建者强制等于服务端 SSO user 而非客户端角色。按 household+source+stable key 的 SHA256 幂等且 `UNIQUE(household_id,resource_id)`，冲突不能复制。
   - `GET /api/finance-cross-member/consents` 与 `.../{consent_id}`：仅本次转出或收款两人读取最小摘要，普通读取不生成 D1 审计。别的家庭与第三方即使猜到 UUID 仍 404。
   - `POST .../{id}/recipient` 仅真实收款人，exact `expected_user_id,expected_version,decision=accept|reject`，只能从 `awaiting_recipient` 转 `recipient_accepted|recipient_rejected`。
   - `POST .../{id}/authorize` 仅目前有效家庭 owner，必须**另一次请求**从 `recipient_accepted` 转 `owner_authorized`；`POST .../{id}/cancel` 仅转出人于未完成审批前撤回；`POST .../{id}/revoke` 原双方或实际 owner authorizer 可对已经授权的申请永久撤权。所有变更要求当前 version CAS，所有接受/授权动作还需未过期，状态不回退、不复用、不 UPDATE 或 DELETE 审计。获授权后 24h 到期无法凭过期记录继续执行。
4. HomeFlow PWA 管理页 `CrossMemberTransferConsents.vue` 以移动优先确认窗口分别展示收款人“确认接收/拒绝”、本人“撤回”、owner 独立“管理员授权”、已授权后“撤销授权”。在后端能力 OFF 时整个面板隐藏；身份切换、离开管理页、回到前台均失效旧读取与敏感状态，按当前账号重新查询。所有文案强调**双人同意≠银行已到账，owner 授权≠账本已入账**。此阶段没有从家計簿发起跨成员新资金任务的 UI，也不能称该转账已完成。
5. **新的只读内网核验** `POST /api/internal/cross-member/consent-proof`：`x-approval-client='kakeibo-cross-member'`、独立 `CROSS_MEMBER_TRANSFER_PROOF_SECRET` HMAC-SHA256，域 `kakeibo-cross-member:consent-proof\n<13位时间毫秒>\n<原请求JSON>`，±5 分钟有效，不允许浏览器 Cookie/Origin/Authorization。exact `consent_id,resource_id,household_id,source_user_id,recipient_user_id,payload_sha256,source_account_version,recipient_account_version`；当前 D1 的 consent 状态必须 **`owner_authorized`、version=3、双方历史确认、owner 实际授权、未过期、源/收款/owner 当前仍活跃且 owner 角色没变**，source/target、资源、原文摘要和预期版本全部一致。匹配后只返回 `consent_verified=true`、版本和最小 digest，并**明确** `ledger_applied=false`、`bank_statements_verified=false`、`target_ledger_authorized=false`。撤销、改原摘要/任意一方版本、跨成员/外家庭、过期/禁用均不返回有效证明。此 API 不写 D1、不能请求新 transfer、不能批准或执行目标财务，更不能成为浏览器越权途径。
6. **未来家計簿实际跨成员金融写入必须额外完整验证**：原资金来源与收款方账户真正归属（HomeFlow owner/admin 全局管理能力不能替代个人同意）、当前 live version+状态、独立银行源 debit/目标 credit 确认、精确金额与退款/取消限制、完整原 K encrypted pending 对应上述不可变 digest、余额非负、双方账务唯一记录与原子 rollback、实际执行对端的防重发和独立 HMAC/lease/receipt。不应从 `consent_verified` 推断 `applied` 或真实银行联网核验。对 owner→member 与 member→owner 两方向的 consent 都实现了；**两方向财务扣款/记账执行都尚未实现**，更没有跨 D1 分布式全局事务。
7. 本次 SQLite 单元测试 `tests/cross-member-transfer-consents.test.mjs` 实际使用新 migration 0058 与真实 Worker handlers，覆盖双方独立 session、owner 双身份场景、逐阶段动作、账户版本、乐观并发、CSRF、跨家庭/伪造 role、禁用/重复、audit failure 原子 rollback、immutable 事件、撤销后不可复用；专用证明还覆盖错误 HMAC、Cookie/Origin 冒用、pre-approval 拒绝、任意摘要/双方 ID/version 篡改、禁用账户、撤销、双边不触碰金融账本。GitHub CI 实际功能 SHA/Run ID 记录在 handoff §92。该 CI 是真实 SQLite / Vue build 和安全执行路径，**不是**两台 iPhone 真实登录验收。
8. 全部新迁移、Vue 与 Worker 代码仍位于 HomeFlow #306 **Open/Draft**，所有新开关默认 OFF；无生产 Workers/D1/R2/Secret/Cron/Service Binding、无任何真实银行/SBI/积分商接口、无 Preview、无功能 PR 合并或 F 阶段上线。契约的增加不能被用来绕过 §90 单次审核与 §91 本人账本的保留安全约束。


## AG. v1.0.27：家庭成员固定费/SBI 定投**受限月度授权与每期防重复预留**（仅 Draft，**不自动执行 Cron / 财务记账**）

日期：2026-11-15。正式设计书 R3/R4/R9、T05/T07/T08 为本新增合同的来源。严格区别“计划个人设定”“家庭管理员授权计划”“该月账务预留”“Kakeibo 实际正式记账”四个阶段；**本节仅实现前 3 项的 HomeFlow 权限和预留骨架**，但尚未实现与家計簿真实固定费/定投计划的签名绑定和最后一步 ledger execution。现有 §V～§AF 的审批/退款/SBI lot/银行资金和两人签名契约保持冻结。

1. 未部署 HomeFlow `0059_recurring_financial_authorizations.sql`：专用 `household_recurring_finance_policies`、`household_recurring_finance_events`、`household_recurring_finance_reservations`。家庭 member 在当前本人有效 SSO session 下创建本人专属的 `plan_resource_id` 32hex+原 Kakeibo `plan_payload_sha256` 64hex+预期银行账户版本，`plan_type='fixed_cost'|'sbi_tsumitate'`，每月实际扣款日 1～28、固定最高正整数 JPY 1～10,000,000、`start_month`/ `end_month` 的日本本地月份与最多未来 24 个月的期限。原计划版本、最大金额、扣款日、月窗口及 owner/user ID 在新数据库中全部 immutable；**HomeFlow 不存真实账单文字/银行参考、完整证券账号/基金报价或卡信息**。当前成员已禁用/不属本家庭、越权提交或尝试修改旧条款，拒绝。
2. `POST /api/recurring-finance/policies` 为 source member 个人申请的唯一入口；`GET /api/recurring-finance/policies[/{policy_id}]` 限同家庭真实 owner 或本人；`POST .../{id}/review` 强制有效 owner 独立 approve/reject 且要校验旧 policy.version+expiry，`POST .../{id}/cancel` 仅 source member 撤回待审计划，`POST .../{id}/revoke` 仅成员本人或实时 owner 对已批准授权永久撤权。所有动作是同一 SQLite 语句中 status/actor/version CAS + append-only audit；历史不可被 UPDATE/DELETE、不会因为更改 nickname/前端参数获得他人的资产控制权。跨家庭假 policy ID 404，默认 `RECURRING_FINANCE_AUTH_ENABLED` OFF。
3. 保持 **one plan × one month × one original occurrence** 的 `household_recurring_finance_reservations` 唯一 `(household_id,plan_resource_id,period_key)`、`(policy_id,period_key)`、`occurrence_id` 和原意图 digest。一次预留前 SQL 必须重查当前原成员与 owner 都 active、source 版本/计划 SHA、已独立批准的 owner 身份、月起止窗、原 due_day、`amount_jpy<=max_amount_jpy`，发生日不得未来且不得晚于本地 7 天宽限；不可凭旧 approval 在撤权/禁用后继续产生**新的**月度预留。一次 `INSERT` 以 SQL AFTER trigger 同时生成 `occurrence_reserved` actor 审计；任一失败原子 rollback。原预留不可修改/删除，网络错误只能用同一个 occurrence ID 查询原回执；**永不自动释放或再次预留同一个月**，因为目标 Kakeibo 可能已部分执行而丢包。
4. 内部只读/预留专用 `POST /api/internal/recurring-finance/reserve|receipt`：额外 `RECURRING_FINANCE_RESERVATIONS_ENABLED` 和独立 `RECURRING_FINANCE_RESERVATION_SECRET` 默认 OFF，仅接受无 Origin/Cookie/Authorization 的后台客户端 `kakeibo-recurring-finance`，HMAC 域 `kakeibo-recurring-finance:reserve|receipt\n13位毫秒时间\n原始 JSON`，±5min，有界 exact JSON `occurrence_id,policy_id,household_id,member_user_id,plan_resource_id,plan_payload_sha256,source_account_version,period_key,due_date,amount_jpy,entry_intent_sha256`，任何金额/时间/用户 ID/digest 被替换即失败。返回 `reserved_only=true, ledger_applied=false, execution_permitted=false`；本接口**不能执行真实账务、不能创建 Kakeibo entries/SBI lots/积分/储值卡入账、不能发真实证券订单**。
5. 新 `RecurringFinancePolicyCenter.vue` 已接入 HomeFlow `ManagePage.vue`，仅后端启用后展示成员本人计划/owner 家庭授权与撤销、固定费/定投、月最高金额/时间窗、原版本和未执行标签；二次确认提醒批准不等于收入支出或基金买付。切换账号或应用前后台失效旧数据，不使用频繁 D1 轮询。创建原个人计划的 Kakeibo PWA 签名源、Cron 日程、逐期真实 bank statement / SBI 基金确认、丢目标回复后的 Kakeibo 独立回执、取消/修复仍**未实现**。
6. SQLite 测试 `tests/recurring-finance-policies.test.mjs` 使用实际 0059 triggers + 真实 handler 与 Node crypto HMAC，验证正常 owner approve/reject、成员越权/冒充 owner/cross household、固定 JPY 上限、due_day 日期、账户版本、成员/管理员失效、撤销、重复同月不同 ID 防双计、同 ID receipt 返回不重复写、新账务始终不存在、审核/预留审计故障 rollback。原始 migration manifest 61 个实际文件含 0059 全部回放，保留原业务安全测试、Vue typecheck 和 Cloudflare Worker dry-run；功能最终 GitHub SHA `1a20584172ef6d800a04344a84c01dcca12ab4da`，HomeFlow Validate Run `43680966561` completed/success。此 CI 是静态/模拟 SQLite 验证，非真实 Cron/Cloudflare D1，亦非双人 iPhone Safari 实机。
7. 五个功能 PR 仍应 Open/Draft，未配置生产密钥/开关、Cron/Service Binding、未创建 Preview、未修改/导入生产金融数据、未合并/部署功能 PR，也绝不把授权预留统计为家庭账本已入账或真实 SBI 下单/对账。剩余 §AH 起待开发清单与真实 Commit/CI 见唯一交接文件 §93。


## AH. v1.0.28：文书助手 iPhone 主屏幕 PWA 的 HomeFlow OAuth 安全回跳与原会话恢复（仅 Draft）

日期：2026-11-15。本节补充 B～E 各 PWA 的首次安装、iOS 主屏幕 PWA Safari 外部授权/重连和账户切换回归。**仅完成文书助手单应用的明确问题修复和源码/Node 测试**；不将这一项等同全部四应用 E2E 或两台物理 iPhone 的 F 阶段实机验收。

1. 文书助手 HomeFlow SSO 继续只在后端 HOMEFLOW_SSO_ENABLED 和所有必要密钥/目标服务与独立用户 session 有效时显示与执行。发起 POST /api/homeflow-sso/start 后，真实服务器返回只用于 HomeFlow 授权的 HTTPS authorization_url，以及仅原文书助手 PWA 私有会话的 state + resume_secret。客户端继续把短寿命（最多五分钟）resume_secret 和 state 只留在原 App 的 sessionStorage，绝不附加到外部 Safari URL、本地持久缓存/IndexedDB、OAuth 查询参数、错误日志或对话，HomeFlow callback 不依赖 Safari 与原 PWA 共享 cookie。
2. 新文书助手 web/src/homeflow-sso-pwa-return.js 的 handoffHomeflowBrowserAuthorization 在已经校验的 HTTPS 跳转到 HomeFlow Safari 成功发起之后，**立即解除原仍存活主屏幕 PWA 的 homeflowSsoBusy 锁定**。iOS standalone PWA 可能启动 Safari，却不触发原 WebView 的 unmount/pagehide；原 App 需要继续显示“完成 HomeFlow 登录”按钮，才能凭原 sessionStorage 中的 state/resume_secret 调用 POST /api/homeflow-sso/complete。若外部跳转 API 抛错，保持调用者原异常处理，不能伪报完成。仅释放 UI pending，不生成新 session、绕过服务端 PKCE 或把 SSO 标记成功。
3. 新严格 validateHomeflowAuthorizationUrl(raw, expectedState, appOrigin) 先检查服务端返回的外部授权地址：HTTPS、无 URL 用户名/密码/fragment、/authorize；response_type=code，client_id=jp-document-assistant，client 指定 PKCE S256 + 43 位 base64url challenge、真实随机 48 字符 nonce、state 与本次服务器响应完全一致；严格同源 redirect_uri=原文书助手 App origin + /api/homeflow-sso/callback，且仅允许这 7 个 OAuth 参数，禁止额外携带 resume_secret。若任意 PKCE 客户端/回调/nonce/state 不符，在存储 pending proof 和转往 Safari **之前**拒绝。服务器依然保持真正的临时凭证、单次 code、独立用户/link/household/权限、旧账户数据隔离与回收。
4. PWA 登录页面明确提示：如 iPhone 转去 Safari，需在 Safari 完成 HomeFlow 授权，然后回到**原主屏幕文书助手**单独点击“完成 HomeFlow 登录”。不能凭另一独立 Safari/新 PWA tab 的 sessionStorage 或无效 callback 假设已完成；过期需重启登录，成功后必须 clearPrivateWorkspace、清空原私有内存和 accountEpoch，并等待真实 boot()/api/me 的原账号/家庭隔离确认。退出登录清除 pending state/resume_secret 与旧文书/Gmail/Drive 缓存。
5. 新测试 tests/homeflow-sso-pwa-return.test.js：模拟 iPhone 原主屏幕 WebView 在打开 Safari 后仍存活，验证原 pending 按钮不被 busy 锁死；跳转失败不误释放服务器状态；恶意非 HTTPS/URL credentials、篡改 client_id、state、PKCE method/challenge、nonce、redirect_uri 和附加的 resume_secret 字段全部拒绝；源代码继续只用 sessionStorage、账号退出清除 pending、HomeFlow 成功完成后先清私有数据再 boot。文书助手 #97 变更 web/src/homeflow-sso-pwa-return.js、web/src/App.vue 和测试，最终功能 SHA a337235de3a6c8e35db8aae63d454a37e34b9ace，GitHub Pre-merge CI 43681571778 completed/success。
6. 此修复**没有**配置生产 OAuth/Cloudflare Secret、修改 callback whitelist、创建 Preview 或发起真实 iPhone 跳转；PWA 外部 Safari↔主屏幕不同 storage 容器、真实再认证故障、两部 iPhone、HomeFlow/家計簿/知学各自 PKCE、文书 Gmail/Drive 私人与共享授权撤回仍必须以后实际设备和 browser E2E 验证，不能由 Node 模拟数据测试冒充生产登录成功。五个功能 PR 仍 Draft，F 阶段上线需用户另行授权。

## AI. v1.0.29：成员本人 → 家庭管理员银行账户的双独立同意、签名审批与不可变双边入账（仅 Draft）

日期：2026-11-15。继承冻结的 §AF 双人真实 SSO 同意／owner 独立授权，及 §AE 同一人银行间不可变转账。两种旧协议及强制 SAME OWNER 规则不放松。新增能力**仅 member→owner 两个不同人的 bank member_created account**，不是两家真实银行转账服务；owner→member、现金、储值卡、基金份额与证券的直接转移仍不支持。

1. 家計簿未部署 `0049_cross_member_bank_transfers.sql` 新增独立 `family_cross_bank_intents`（原成员 source 真实 SSO + AES-GCM SHA256 原文）、`family_cross_bank_recipient_evidence`（recipient 本人独立 Kakeibo SSO 确认已到账的参考/日期/金额）、`family_cross_bank_journal`（exact approval/consent/两边 stable account/version、唯一 transfer entry）、`family_cross_bank_actor_audit`（双方与 owner 授权、执行 actor）。所有不可变对象受 SQLite FK/CHECK/触发器保护。后端 `KAKEIBO_CROSS_MEMBER_BANK_ENABLED` 默认 OFF；实际启用必须另外进行生产授权和迁移。非真实银行卡发行方或银行 API 证据，依旧 `bank_statements_verified_by_institution=false`。
2. 家計簿 source 个人 API `/api/family-finance/cross-member-bank-transfers`：仅本人有效 user_id+member 角色、真实 source bank / receiver owner bank、不同账户真实 owner、相同 household、CAS 版本、已发生 source debit reference 和日期创建准备，原 24h 到期。收款人本人以独立 session 提交 `/{request_id}/recipient`，确认 target bank credit_reference/credit_date/amount，与 source amount 严格相等且时间有效；浏览器不可替另一人发送确认。两份真实银行原文只在本人发送后立即 SHA256 压缩为带 account_id 的证据 hash，不传入 HomeFlow；source 原始操作 AES-GCM 加密，HomeFlow 仅持 32hex resource / 64hex digest / 2 account version 与 actor ID。
3. 转出人须先使用 HomeFlow §AF 原 `/api/finance-cross-member/consents` 获得自己申请、收款人本人的 accept 及 owner **另一次**独立 authorize；原 `/api/internal/cross-member/consent-proof` backend-only HMAC 当前 verified 结果须包含 consent_id、resource/payload_sha256、两 owner/版本与 valid_until，不能由 `target_ledger_authorized=false` 假冒 target proof。随后转出人 Kakeibo `/{request_id}/submit` 通过原 `kakeibo-bank-transfer:submit` 后台 HMAC 创建原 HomeFlow `finance.asset_transfer.bank_to_bank` 审批。家庭 owner 再执行独立审批，最终 HomeFlow 原 nonce/lease/verify 路径签名调用 K `/api/internal/bank-transfers/execute`。
4. 家計簿 cross internal 分支只有在 `KAKEIBO_CROSS_MEMBER_BANK_ENABLED` 打开、原执行 HMAC 验证完全成功，原 sealed SHA、original approval ID、当前 signer/nonce/owner 权限、§AF recipient+owner 双同意 HMAC 当前有效、source/recipient 的稳定账户 owner/CAS、两侧真实已入账用户证据、非重复 statement、金额和日期及余额充足同时成立，才在同一 K D1 SQL batch 中写一条 transfer entry（同时影响 source debit/target credit）+ 不可变 journal + actor audit；异常回滚不产生半边账。**不宣称 HomeFlow D1 与 K D1 具全局原子性**，目标 commit 丢回执后只对相同原 approval ID 只读查询 `/receipt`，不新建交易。
5. 家計簿目标返回原冻结 §AE bank-transfer receipt 必需字段与 `cross_member=true, consent_id, recipient_user_id, source_owner_user_id, target_owner_user_id, owner_authorizer_user_id, bank_statements_verified_by_institution=false`。HomeFlow #306 `approval-execution` 在判断 applied 前从自身不可变 consent 表重新读取精确原申请/双方 ID/owner/账户版本/确认顺序核验，不因普通 `consent_verified` 预审就直接 applied。普通 §AE same-owner response 未新增字段，旧功能保持不变。错误/超时仍返回 unknown/failed_retryable，禁止伪写或替换审批 ID。
6. 真实代码和隔离测试位于 Kakeibo Draft #309 和 HomeFlow Draft #306；HomeFlow `.github/workflows/ci.yml` pin Kakeibo 已验证功能 SHA `11c5b0a20d65b42ff114f76c77652ef509d81888`。Kakeibo 新 SQLite 测试和 HomeFlow 两个数据库真实 handler/模拟 Service Binding 测试覆盖 source/recipient SSO、两次 owner 逻辑动作、真实 approvals、双边入账、immutable journal、重放、目标回执丢失、撤权、CAS/balance drift、审计触发器原子 rollback。详细测试结果/CI 与未覆盖功能必须以唯一 handoff §95 为准。
7. 安全限制：此阶段仅作本地独立 SQLite/CI，**没有实际外部银行的独立交易确认、真实机构核对、生产 Cloudflare D1/R2/Worker/Secrets/Cron/Binding、Preview、PR 合并与 F 阶段部署**。其他账户类型、owner→member、历史账目编辑与 R2 回收、周期计划实际执行、四 PWA 实机仍需继续完成。

## AJ. v1.0.30：跨成员银行流水回执与既有 SBI/信用卡/同一人银行账务间的**双向不可重复使用**约束（仅 Draft）

日期：2026-11-15。§AI 的双人真实 SSO 签名转账和已确认双边 `entries.type='transfer'` 不变；旧 §AE 及 SBI/信用卡双边 journal 的证据规范也不变。本节仅进一步冻结机构流水引用的**跨操作防重边界**，不扩大跨成员可转资产类型。

1. 家計簿未部署新增 `0050_cross_bank_statement_usage_guards.sql`，补充 `family_cross_bank_journal` 的 INSERT 前重复引用拒绝：原跨成员 source `(source_account_id,source_reference_hash)`、目标 `(target_account_id,credit_reference_hash)` 与既有 `family_bank_transfer_posted_evidence` 双侧、`family_card_bank_debit_evidence`、`family_sbi_cash_bank_evidence`、`family_sbi_cash_refund_evidence` 任何相同 account_id/reference_hash 均不能重入；交叉方向重放也拒绝。保留 §AI 的同一 D1 batch 对 `entries`、不可变 journal、actor audit 事务回滚。
2. 为了阻断先成功执行跨成员银行转账、再拿原提款参考做 SBI 投资/信用卡还款/同一人转账的重复记账，新增四个后续源表 BEFORE INSERT guard。**source debit 和 recipient credit 两侧**均受相同 reference 约束，不能只保护转出人。证据原文始终不在 HomeFlow D1，哈希跟稳定 `account_id` 绑定。目标可受原版本 CAS/已审批/真实接收用户确认保护，不会因新增此约束获得新权限。
3. 家計簿 #309 目标 commit、HomeFlow #306 的精确 pin/test、每个目标 CI Run ID、失败原因与生产限制一律由唯一 handoff §96 给出。依旧没有银行 API 机构核验，也不支持 owner→member/cash/securities/预付卡的跨成员直接划拨。五个 PR 保持 Draft，所有生产与 F 阶段功能开关仍 OFF。

## AK. v1.0.31：家計簿普通共享账目版本 CAS、回收/恢复、R2 附件墓碑与不可变修订审计（仅 Draft）

日期：2026-11-15。继承 §AI～AJ 的跨成员真实金融账务与 §AF 的双方同意边界，不修改任何已执行金融 journal，不将本节误称为**所有家庭成员已可提出并由 HomeFlow 批量审批修改账目**。

1. 家計簿 #309 新增**未部署** `0051_shared_entry_lifecycle.sql`，独立 `family_shared_entry_registry` 把**新创建的普通 income/expense** 映射至单条真实 `entries.id`，不创建第二套统计数据源；新增所有版本变化触发器自动产生 `family_shared_entry_audit` append-only 历史。原版 `family_shared_entry_write_context` 是同一个 SQLite D1 批量事务中的短暂 SQL 权限证明，`entries` BEFORE UPDATE/DELETE triggers 禁止其他旧账本 API 更改被管理的共享记录；改名/金额/分类被预先结构化验证并要求 `expected_version` CAS。源行仍只计入现有家庭收支一次，删除后计数归零、恢复时同一个稳定 `entry_id` 恢复，不会再生成第二笔支出。
2. 新 PWA/API `/api/family-finance/shared-entries` 提供已登录双方同家庭**只读**列表/单条、家庭 owner 的普通账目新增/更新/移入回收箱/恢复/明确二次确认永久删除；任意家庭 `member` 不能调用直接写，旧网络请求/错误 household 与旧 session 被拒绝。所有写入要求后端二次查询 `homeflow_identity_links` 的当前 owner active 且服务端 SSO `user_id` 匹配，更新及删除/恢复必须使用原始 resource_id + current version CAS，数据库每一步用 1 批量事务确保真实 `entries`、version 和 trigger audit 同时成功，否则全部 rollback。普通 record 的稳定 ID 与已审批执行的 bank/card/SBI/points immutable journal 永不共享写入口。
3. 新专用 `family_shared_entry_attachments`（`object_id` 32 hex + `resource_id`）与 R2 私有键 `shared/v1/{resource_id}/{object_id}`，绝不访问 `receipts/v1/{entry_id}` 旧数字 ID 目录。仅 authenticated owner 可预留/上传新图片，必须 WebP/JPEG、≤200KB、精确 SHA256 和 R2 只允许 `If-None-Match:*` 条件写入；服务器校验 R2 返回的长度/metadata 和 DB 标记后才成为 ready。家庭 active reader 可只读，回收箱后仅 owner 可查看。独立上传失败留下 pending，不能自动显示为有效图片。
4. 删除普通共享账目是 D1 软删除，附件保留以便日后恢复；**永久删除**先以单库原子 CAS 标记 `purge_pending`、清除原账目 snapshot、把附件全部标记不再可读，然后调用 R2 batch delete；如果对象存储失败，D1 墓碑仍先存在并且无旧用户可以重新下载。原资源/原证据 ID 的重复清理只按同一个 ID 恢复，只有确认各附件已删除后才落 `purged` 与审计；不能凭 DB/R2 两边存在绝对全局原子事务。保留不含原文的审计摘要以供后续对账；任何 `purge_pending/purged` 不可 restore。
5. PWA 新 `FamilySharedEntries.vue`：移动端普通收支新建、修改、回收/恢复、附件图片压缩和上限、回收箱与明确永久删除警告；session 切换/后台恢复时舍弃旧私有状态，切勿因旧请求回执切换家庭；功能后端 flag `KAKEIBO_SHARED_ENTRY_ENABLED` 默认 OFF。
6. 本版范围**有意限制**：目前只有 owner 直接管理新普通共享收支；成员拟修改旧账目的 HomeFlow `finance.entry.update/delete/restore` 原审批与真实 Kakeibo target 执行、批量审批后逐笔入账、历史共享账目合法采用及跨老 R2 引用修复均未完成，不能以本 API 代替它们。资产转移/SBI lot/卡账单等原不可变记录必须使用相应原正反 journal，不在这里修改或删除。原私人/共享文书 R2 不受该新命名空间影响。
7. 本次不触及任何生产 Worker、Pages、D1、R2、Cron、Secrets、Service Binding、Preview 或 F 阶段。实际 Commit/CI 与尚未完成项由唯一 handoff §97 记录。跨独立 D1 不存在全局 SQL 原子性。

## AL. v1.0.32：家庭成员普通共享账目创建/修改/删除/恢复由原 HomeFlow 审批签名实际执行（仅 Draft）

日期：2026-11-15。继承 §AK 的普通家庭共享收支 `family_shared_entry_registry`、版本 CAS、审核审计、R2 私有附件与 purge_pending 安全恢复，以及原 §54～§96 的唯一 HomeFlow 审批状态机。本节不是第二套审批系统；已执行的银行转账、信用卡负债、SBI lot、积分 journal 等 `entries` 继续原不可变金融限制，不能以 `finance.entry.update` 修改其历史。

1. 家計簿 #309 新增未部署 `0052_shared_mutation_approved_execution.sql`，包括 `family_shared_mutation_intents`（真实成员 SSO 原请求 AES-GCM 加密、SHA256、CAS 及 14 日限制、个人/家庭隔离、稳定幂等）、`family_shared_mutation_applied`（一笔 HomeFlow 审批/原 K request 对应一个 immutable journal+真实普通 entry version+auto-trigger actor audit）。`finance.entry.create/update/delete/restore` 的新成员申请仅可作用于 §AK 的新普通 income/expense，共享成员必须是当下本人 SSO，无法只凭前端声明冒充管理员。原源资料在家計簿 D1，加密等待审核期间不进入 `entries`，HomeFlow 仅收 resource/digest/type/expected_version，不收原金额、账本原文、R2 图片或私人文书。
2. Kakeibo member `/api/family-finance/shared-mutation-requests` 本人 session 创建 `prepared`、列表及原 ID 重试、取消未提交申请；后端 HMAC client `kakeibo-shared-entry` + 专用 submission secret，以不含私有内容的 original proposal SHA 通过 HomeFlow 新 `/api/internal/approvals/shared-entry-submit` 调用现有 `approvalRoute`，生成 `resource_type='shared_entry_mutation'`、operation `finance.entry.create/update/delete/restore`、idempotency `kakeibo:shared-entry:<proposal_id>` 的**现有审批**。HomeFlow owner 必须独立批准，approved 不等于账本已写；已签发原审批 ID 不能通过网络重试生成二次账目。
3. 原 HomeFlow `/api/approvals/{id}/execute` owner/session/nonce lease 模块新增精确 `shared_entry_mutation` 分类，内部服务 `KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE` + 专用 HMAC `SHARED_ENTRY_EXECUTION_SECRET`（与 bank/card/SBI 分离），向 Kakeibo `/api/internal/shared-entries/execute|receipt` 发送 **同一个** request ID 与 payload digest，不能浏览器提交、不可 Origin/Cookie 冒用。家計簿再次独立向原 HomeFlow `/api/internal/approvals/verify` 以新 client `kakeibo-shared-entry`、`SHARED_ENTRY_APPROVAL_PROOF_SECRET` 和领域 `kakeibo-shared-entry:execution-proof` 核验当前 owner/member/真实审批状态、nonce、原文 SHA、operation、CAS、租约和 expiry。HomeFlow 只能在收到目标 original immutable receipt 并验证 actor/operation/receipt version/ID 后标记 `applied`。
4. Kakeibo target 重新 AES-GCM 校验原 member 请求、原 `family_shared_entry_registry` 资源/版本/state/current actor，修改及删除、恢复必须在**同一个 Kakeibo D1 .batch** 内执行 `entries` UPDATE/DELETE/INSERT、短寿命 SQL `family_shared_entry_write_context`、registry version+state 更新、trigger `family_shared_entry_audit` 及 `family_shared_mutation_applied` immutable journal；任何中间触发器失败全部 rollback，禁止 half-applied。每个原 `approval_id` 唯一，不可变审计并保留 actor 的 member/requester 与 owner/approver；仅 `income/expense` 可执行，新金融账务及老 legacy shared adopted 数据尚不允许。撤权、老版 CAS、到期、跨 household 或错误授权都返回拒绝。
5. 真实 K journal commit 后 HomeFlow 接收网络回执丢失，则原 `/receipt` 只按原审批 ID 读取 ledger+audit 的不可变匹配结果，不得再次创建/修改一笔或重发新的审批 ID。这里绝对不声称 H D1 与 K D1 具全局 SQL 事务；目标 journal 和租约/原 ID read-only 回执使分布式网络失败可恢复。
6. 家計簿新增 `FamilySharedMutationRequests.vue` 的 mobile-first 成员提议 UI、原草稿 ID 恢复、历史状态标记，在账号切换和前后台时清空上个用户私有状态；与 owner 的 `FamilySharedEntries.vue` 使用同一个正式共享账目源。默认关闭 `KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED`，HomeFlow `SHARED_ENTRY_APPROVAL_SUBMISSION_ENABLED` / `SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED` 等开关亦默认关闭。
7. 本次实测 CI/commit 与局限详见唯一 handoff §98。§90 仅原先 20 笔**全有或全无审核**；本章不能当作跨两库的原子批量财务执行，仍须对每一个原审批独立 target write+original receipt。R2 附件凭证仍按 §AK 的 tombstone 回收/恢复，并不随金融审计永久删除而误删；外部银行/SBI/积分机构对账与四 PWA 双 iPhone 真实验收仍未完成。所有生产 Flag、Cron、Secret、Service Binding 保持 OFF，五 PR Draft，不新增 Preview、不动生产、不合并。
