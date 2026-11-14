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
| 文书审批状态 | HomeFlow `POST /api/internal/approvals/document-status` | 后端签名域 `jp-document-assistant:status\\n{ms_timestamp}\\n{raw_json}`；固定 `approval_id,household_id,requester_user_id,resource_id,payload_sha256,target_app`；无目标执行证明，始终 `applied:false,target_changed:false` | 只读确认 Draft |

旧 `JPDA_BRIDGE_SECRET` 及旧单用户直连是**过渡通道**，不等于新 SSO 审批证明；新双用户不能仅凭旧桥接 allowlist / 客户端 `approved:true` 写目标。新的协议不能复用旧弱绑定来冒充 member 审批。

## D. 后续目标执行器统一要求（尚未实现，禁止界面假显示）

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
