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
