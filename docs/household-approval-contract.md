# HomeFlow 家庭审批核心（阶段 D Draft：仅申请/审核，**未执行账本**）

> 依赖 HomeFlow Draft [#305](https://github.com/PTamako/homeflow/pull/305) 的迁移 0053；本 Draft [#306](https://github.com/PTamako/homeflow/pull/306) 追加 0054。两者**都未合并、未应用到生产 D1、未开启**。唯一进度日志仍为 `homeflow/docs/four-app-development-handoff.md`（main）。

## 已实现的后端与防护

- `migrations/0054_household_approval_core.sql`：`household_approval_requests` / `household_approval_events`。迁移只新增表、索引和不可变事件触发器。申请的固定身份、家庭、目标、操作、幂等键、载荷 digest 都不可改；状态跳转受数据库触发器限制。
- `worker/approvals.js`：`APPROVALS_ENABLED='true'` 才打开（目前未设置）。全接口复查实际 HomeFlow member/owner 身份，不接受客户端伪造操作者 ID，修改操作要求同源。
- `POST /api/approvals`：仅 member，`idempotency_key` 唯一且重试保持同一申请。只收来源/目标 App、操作种类、最少资源元数据、`payload_sha256`、expected_version；严禁金额、原文、凭证、任意 URL、SQL 进入审批日志。真实待执行载荷应在**目标 App** 的受控持久 pending 表保存；HomeFlow 仅存摘要。
- `GET /api/approvals?page=0&status=pending`：每页 5 条；owner 查看所在家庭的申请，member 只能看本人的申请。不逐次写读审计。
- `GET /api/approvals/{request_id}`：受家庭和操作者限制的详情及不可变事件列表。
- `POST /api/approvals/{request_id}/review`，body `{"decision":"approve"}` 或 `{"decision":"reject"}`：仅实际 HomeFlow owner，必须是本家庭 pending 且尚未过期；不得自审；条件写入与事件采用同一 D1 batch。重复批准/拒绝不会重复记录。
- `POST /api/approvals/{request_id}/cancel`：仅原 member，pending 才能取消；不伪造 approver 和 reviewed_at。

**最重要的语义：** `approved` 只表示管理员允许，不代表财务更改已经成功写入。API 返回的 `applied` 仍为 false。只有后续目标 App（家計簿等）完成签名校验、权限/expected_version 条件写入、幂等确认并回传 remote_id，HomeFlow 才能在未来专用内部适配器里依次设置 `executing → applied`。本 PR **没有任何执行入口**，也不直接操作家計簿 D1。

## 未完成（后续开发必须处理）

1. 阶段 A：四个 D1 与 R2 实际字节的持久加密备份和隔离恢复测试未完成；`0053/0054` 不能应用正式 HomeFlow D1，不能开启开关。
2. 家計簿侧：需要保存全家账单待审核变更、`expected_version`、scope/owner 及真实 payload；未获批准不得变更账本。等待 target 端的具有可信身份的 `approved-actions/execute` 和 idempotency 状态查询。
3. HomeFlow 服务间执行器：审核后发起受签名的 Service Binding 请求，任何超时先按幂等键查询实际结果，禁止盲目重放产生重复账；分别实现 `executing`、`failed_retryable`、`conflict`、`applied` 的系统授权转移和 append-only 审计。
4. 只读复核和审批 UI：HomeFlow 管理/家庭页五条分页与状态徽章、待审批数量、通知接入；禁止把申请记录放到会被短期清理的通知表。避免重复 D1 扫描。
5. 验证 `source_app` 与 HomeFlow 用户的可信关联、限流、目标合法操作类型及账号跨站点退出/禁用传播。直接浏览器模拟审批请求不能当成真实家計簿产生的授权变更。
6. 用户已确认家計簿账本及统计对夫妻均可读；不得在公开统计增加审批；个人信用卡/储值卡/SBI/固定费用设置由所属人管理，owner 可管理全体。历史 HomeFlow 原有数据仍保持各自 member/owner。

## 自动化验证

`tests/household-approvals.test.mjs` 覆盖：默认禁用、成员提交、同一幂等键重放与变更冲突、本人取消、owner/跨家庭权限、仅批准不生效、拒绝最终不可重试、过期不能审核、SQL 不可变事件和非法状态跳转、过滤/5 条分页 GET 不写审计、禁止原文或任意 URL/SQL payload、禁用账号拒绝操作。整仓 CI `npm run check`、本地完整迁移/SQLite 与 Worker dry-run **必须全部成功**方能调整 Draft 状态。PR #306 当前以 #305 为 base，后续切换到 main 之前先解决迁移顺序冲突，禁止跳过备份。


## 2026-11-13 增量：只读签名批准证明（Draft，绝非真实入账执行）

`worker/approval-verification.js` 新增后端 `POST /api/internal/approvals/verify`，由 `worker/index.js` 在浏览器 Cookie/同源登录校验前单独路由；只有持有专用 HMAC-SHA256 Secret 的受信业务后端可通过。请求不得携带 Cookie/Origin/Authorization；校验 `X-Approval-Client=kakeibo`、13 位毫秒时间戳（±5 分钟）、`X-Approval-Signature` 对 `kakeibo\n{timestamp}\n{raw_json}` 的签名，Body 限 2KB，读取单条 indexed approval，不向 D1 写阅读审计。

只验证 `status=approved` 的 `finance.entry.create`，并要求 `source_app=target_app=kakeibo`、`resource_type=finance_entry`、`resource_id/household_id/requester_user_id/payload_sha256/idempotency_key/expected_version` 与数据库原始不可变申请**完全匹配**；recheck requester 是活跃 member，审核者是未禁用且仍具 owner 角色，reviewer≠requester，`reviewed_at` 非空且未超过 expiry。拒绝 pending/rejected/cancelled/failed、错户、错 hash、假审核、过期、双方禁用、账号角色变化。返回 `verified:true`、`applied:false`，既不改变审批状态也不写业务 App D1。

仅 `APP_ENV='production'` + `APPROVALS_ENABLED='true'` + `APPROVAL_VERIFICATION_ENABLED='true'` + 32-byte hex Secret `APPROVAL_VERIFICATION_SECRET` 全部配置才可调用。当前全部保持 OFF。与家計簿 Draft #309 的 `/api/family-finance/proposals/{id}/approval-proof` 配合，只能核实本人草稿是否获批准，**不能凭此单次 GET/POST 结果当作财务已生效**。签名密钥不得写入仓库/日志/GitHub Issue。

已新增受签名的可信家計簿→HomeFlow 申请创建（见下方协议），但尚未实现从审核到 Service Binding 执行器的端到端事务、`executing→applied`、幂等结果查询及重放对账、通知与 PWA UI。0053/0054 在生产都未迁移，要求先按阶段 A 完成备份与隔离恢复，不可启用服务、合并功能 PR 或新建 Preview。


## 2026-11-13 申请提交后端（已通过 CI、仍 Draft，不入账）

`worker/approval-submission.js` 新增 `POST /api/internal/approvals/submit`：与只读 `/verify` 共用独立的 HMAC-SHA256 后端签名 Secret（`APPROVAL_VERIFICATION_SECRET`），但要求额外 `APPROVAL_SUBMISSION_ENABLED='true'`，并仍要求 `APPROVALS_ENABLED='true'`、`APP_ENV='production'`。**当前全部没有在生产开启**，无新 Preview。

- **入参**：只允许 `household_id`、`requester_user_id`、`resource_id`（家計簿 D1 32 hex pending ID）、`payload_sha256`。无浏览器 Cookie、Origin、Authorization、金额、账号信息或任意 SQL/URL；签名 `kakeibo\n{millisecond_timestamp}\n{raw_json}`，允许时钟误差 ±5 分钟，严格限制 JSON 大小。
- 签名通过后固定设置 `source_app='kakebo'`、`target_app='kakebo'`、`operation='finance.entry.create'`、`resource_type='finance_entry'`、`idempotency_key='kakeibo:finance:'+resource_id`，**不采纳客户端指定的操作或幂等键**。调用已有 `approvalRoute` 并复查真实 D1 household_member role=member 与非禁用账号；复用原有 0054 的不可变工单/审计事务。
- 初次提交返回 HomeFlow `approval_id,status:'pending'`；重复或网络重试对同一稳定 resource id 返回同一工单 ID。调用后再校验数据库原记录的真实 digest、actor、resource、household 和幂等键，不能依赖缺少 digest 的公共列表返回体。
- **审批只创建申请，不代表同意或生效**：后续 owner 在现有 `/api/approvals/{id}/review` 才能人工批准；本模块没有家計簿 D1 写入、没有自动执行，也不修改 `executing/applied`。

[HomeFlow Validate #43423671632](https://github.com/PTamako/homeflow/actions/runs/43423671632) success，覆盖首提、重复、不同 digest 的幂等冲突、跨家庭/无效成员、账号禁用、过期/伪造签名、Cookie/Origin 拒绝及零账本副作用。与 [家計簿 Validate #43423823312](https://github.com/PTamako/kakebo_jp/actions/runs/43423823312) 对接。**真正入账及通知/审批 UI 尚未完成，切勿将 submit/proof 与 applied 混同。**
