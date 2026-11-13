# 四应用统一账号与家庭审批系统 — 持续开发交接（生产安全优先）

> **唯一交接文件**：`PTamako/homeflow/docs/four-app-development-handoff.md`  
> **冻结需求源**：[Google Drive 设计书 v1.1（2026-11-13，含新增 §3.1）](https://docs.google.com/document/d/1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY/)  
> **本次检查时点**：2026-11-13（JST；Google Drive 最新核对 16:07 JST）。  
> **重要：本文件的事实只代表检查时点；继续开发前确认 main/PR/生产资源是否发生变化。绝不从旧检查结果推断已经上线。**

## 0. 恢复工作的强制规则

1. 先阅读本文件及设计书最新全文（尤其 **§3.1 首次安装/登录**），然后比对各仓库最新 main/未合并 PR、迁移记录和正式 Cloudflare 资源；**只补增量，不重复已经完成的步骤**。
2. 四 App 保持独立生产 D1；HomeFlow 是唯一 `user_id/household_id/role/display_name` 身份源，昵称以 `family_profiles.display_name` 为准，昵称永不作为授权外键。
3. **历史归属已冻结**：HomeFlow 的旧记录保留两位成员原来的归属；另外三个 App 的全部已有个人历史/配置归 HomeFlow owner，member 从新的个人数据空间开始。家計簿正式账本和统计始终全家庭共享，不做「我的/他的/全家」统计切换。真实数据库出现与上述规则矛盾的异常时，仅隔离异常记录，不把全部历史数据重新设成待确认。
4. 个人金融设置（信用卡、储值卡、SBI、固定费、账户余额）member 仅管理自己的，owner 可管理全体；member 的正式家账新增/改/删必须先 HomeFlow 审批，**未审批不得写入账本**。私人文书不因 owner 身份向其他人开放；共享文书双方可管理；知学私人进度和句子卡严格按 user_id 隔离。
5. 所有新增写动作必须记录**真实 actor_user_id** 和持久化审计；旧历史 owner 回填不是伪造的历史 actor。敏感读/导出审计；普通 GET 只鉴权，不逐次写 D1 审计。
6. 对生产 D1/R2 的改写之前，先验证**可恢复的备份**、迁移前基准计数/摘要、可回滚方法、测试和回滚开关。不得通过直接跨 D1 绑定绕过应用权限；不得创建 HomeFlow/家計簿/文书助手 Preview；不得删除或覆盖原数据；不在本文件保存登录密码、JWT、API Key、R2/D1 导出带签名 URL。
7. 功能粒度：单独分支 → 代码/迁移/测试 → GitHub commit SHA → PR → CI → 正式部署 → 生产只读验收 → 回填本文件。**一个阶段完成就提交更新本文件，绝不等 A–F 全部完工才写。**
8. **不要将「备份导出 API 曾返回 complete」误认成已保存了可恢复备份**；必须确认备份文件持久保存、可以访问和测试恢复后方能迁移。不要将 GitHub CI success 误认为 Cloudflare 生产已更新，两个系统分别核对。

## 1. 本次已经保存的调查成果（阶段 A：进行中）

### 1.1 GitHub 已核查的 main 基线

| 仓库 | 检查到的 main SHA | 已查到的未合并 PR | CI / 最近部署线索 | 下一动作 |
|---|---|---|---|---|
| [homeflow](https://github.com/PTamako/homeflow) | `6d5cc87d7eacfcca7c2189feb7a9841feaf38abc` | 未检出 open PR | GitHub Validate + Deploy 成功；Cloudflare `homeflow` 100% 单版本活跃 | 身份协议/受控账户映射；保留现有 D1 热路径性能修复 #303 |
| [kakebo_jp](https://github.com/PTamako/kakebo_jp) | `3bac4610078729556a7068c761e3e7c1729ab27d` | 未检出 open PR | GitHub `Deploy Private Kakeibo Bridge` 最近 main run **failure**；Cloudflare 私有桥接 Worker 已有 100% 版本（不是失败已解决的证据）；Pages 项目 `kakeibo` 存在 | 查失败 job 日志；梳理现有按 `name` 关联的金融账户 PK 冲突 |
| [it-study-platform](https://github.com/PTamako/it-study-platform) | `ae8c0dea3468006d0fbbfaaf953afbf3f4f645da` | [#178 题库补充](https://github.com/PTamako/it-study-platform/pull/178) | GitHub Deploy 成功；Cloudflare `it-study-platform` 100% 版本活跃 | 不覆盖 #178；先做完整个人数据表/SQL/客户端缓存清单 |
| [jp-document-assistant](https://github.com/PTamako/jp-document-assistant) | `b19603e2060cc7ef5a709a42133a2745480509e2` | 未检出 open PR | GitHub production security smoke success；Cloudflare `jp-document-assistant` 100% 版本活跃 | 本地身份链接 + 私人/共享写权限 + Gmail/Drive 独立授权，不改旧外键 |

> GitHub PR 查询/生产状态仅覆盖所述检查时间；复工时先做差异化核查。知学的最新 Cloudflare worker 部署时间略晚于本次记录的 main CI 运行时间，需要单独确认版本来源，而不是猜测。

### 1.2 生产 Cloudflare 只读资源检查

- 已连接 Cloudflare 正式账户，确认 **四个不同 D1**：`homeflow`、`kakebo`、`it-study-platform`、`jp-document-assistant`。其他项目 `milkssales-jp` D1 与本次无关，不要操作。
- R2 Bucket 名称核对：`homeflow-family-media`、`kakeibo-receipts`、`jp-document-assistant-private`。**尚未进行每个 Bucket 的对象计数/可恢复备份验收**。
- Workers：`homeflow`、`it-study-platform`、`jp-document-assistant`、`kakeibo-homeflow-bridge`、`kakeibo-nav-sync`（另有不相关 `milkssales-jp`）。核对时各自最近 deployment 的 `versions` 均为一个版本、流量 **100%**；不能证明四应用统一身份功能已部署（实际尚未）。
- Pages：`kakeibo` 项目存在，`production_branch=main`；最初带不兼容 `per_page` 参数的列表请求报错，**不带该参数后成功**，不要重复把参数错误当成项目不存在。
- 当前清单里未见已弃用的 HomeFlow/家計簿/文书助手 Preview D1 或独立 Worker；不得重建。
- **本轮尚未执行任何生产 D1 schema/业务数据修改、R2 对象修改或正式 Worker 部署。**

### 1.3 生产 D1 基准计数（只读；检查时点快照）

| 数据库 | 查到的表与计数（不是全库完整清单） | 含义 |
|---|---|---|
| `homeflow` | `users=2`; `household_members=2`（owner=1, member=1）；`households=1`; `family_profiles=3`; `tasks=10`; `sessions=4` | 真实账号已独立存在；保留原成员归属；session 仅是当时数量 |
| `kakebo` | `entries=296`; `payment_sources=11`; `recurring_plans=3`; `investment_plans=4`; `investment_holdings=7`; `card_bills=5`; `trash_items=1` | 全部旧金融配置归 owner，entries 继续全家可见；后续还需金额/余额校验摘要 |
| `it-study-platform` | `study_attempts=0`; `scenario_attempts=0`; `saved_vocabulary_entries_v2=8`; `daily_task_completions=15`; `mock_exam_submissions=0`; `language_cards=16170`; `questions=2099` | `language_cards/questions` 包括题库或公共内容，不能把其数量都当作个人学习记录；其余个人记录全部归 owner |
| `jp-document-assistant` | `users=1`（owner=1）, `households=1`, `documents=2`（private=2）, `attachments=0`, `storage_objects=0`, `google_oauth_grants=2`, `audit_events=0` | 未有 member 文书历史；旧个人数据/Google 授权属于 owner，不可自动分享或复制 |

额外真实 schema 发现：家計簿 `payment_sources(name TEXT PRIMARY KEY)`，`merchant_rules(keyword TEXT PRIMARY KEY)`，`card_bills` 仍按名称关联；仅增加 `owner_user_id` **无法支持两人同名金融账户**。需要可逆的稳定支付账户 ID/兼容视图或映射层，完成不丢账的外键迁移、同名账户测试后才能开放两人独立新增。知学多张个人表缺 user_id，需要逐 SQL 改造。文书助手已有本地 `users/households/sessions` 和 `documents.owner_id`，必须有无损 `identity_links`，不能随意替换原 local ID。

### 1.4 备份真实状态（迁移阻断项）

| 数据库/资源 | 操作结果 | 已保存可恢复文件？ | 后续要求 |
|---|---|---|---|
| HomeFlow D1 | Cloudflare D1 export polling **complete**，生成 SQL 导出对象 | **未验证持久保存/下载/恢复，不能算已完成备份** | 使用安全存储持久化、验证 SHA-256、测试恢复/重建抽样；切勿把 signed URL 写入仓库 |
| 家計簿 D1 | 未启动导出 | 否 | 备份 + 金额/余额摘要 + 旧关联一致性验证 |
| 知学 D1 | 未启动导出 | 否 | 备份 + 个人学习数据/题库分别计数 |
| 文书助手 D1 | 未启动导出 | 否 | 备份 + 私人文书/OAuth 身份映射校验 |
| 三个 R2 Bucket | 只读列出资源名 | 未备份/校验 | 备份或确认可靠恢复能力、对象清单/数量/摘要，不改动原件 |

**生产写迁移门槛：目前未满足。不要把本轮阶段 A 的只读调查误写为已经完成迁移。**

## 2. 新增 §3.1 的强制开发和验收条款（已吸收设计）

- 丈夫已拥有 HomeFlow `member` 账号，不需要也不得在家計簿/知学/文书助手注册独立新账户，不使用 owner 共享密码或旧 AUTH_TOKEN。
- 三 App 正式站点分别在 iPhone Safari「添加到主屏幕」；独立 PWA 首次启动 → **「使用 HomeFlow 登录」** → HomeFlow 安全授权页（已有身份会话则确认；否则以自己的 HomeFlow 账号登录）→ 业务 App 后端完成 OAuth Authorization Code + PKCE / OIDC 语义校验 → App 专属 Secure+HttpOnly 会话 → 显示正确 HomeFlow 昵称与角色。
- 不依赖 Safari 与独立 PWA 共用 Cookie；可短暂重定向，不能复制 HomeFlow 密码/Token 给三 App；授权失败 **fail-closed**，不得默认 owner。
- 家計簿 member 首次进入：可直接阅读全家账本/统计/所有资产余额；个人金融账户设置空白，不继承 owner。知学 member 的学习进度/错题/收藏/句子卡空白。文书 member 私人库空白，仅能查看明确 shared 文书；单独授权自己的 Gmail/Drive，不继承 owner OAuth。
- 人工 + 自动测试：全新手机分别安装 3 个 PWA；HomeFlow 已登录/未登录；首次登录、登出、禁用、换账号/换设备、账号恢复；切换 user 后 IndexedDB/localStorage/PWA 缓存不串号；个人数据保留；三 App 不要求独立注册。受 iOS 设备限制的实机验收 **不得仅凭单测声称通过**。
- 这节在 **阶段 B 建立协议/首次登录**、**阶段 E 保护隔离**、**阶段 F 跨 PWA 人工验收** 都要逐条引用。

## 3. 按 A → F 的实时进度

| 阶段 | 状态 | 已完成 | 进行中 / 未完成 | 生产迁移 | 生产部署/验收 |
|---|---|---|---|---|---|
| **A 调查、只读基线、备份** | **进行中** | 读取最新 v1.1 + §3.1；四 repo main SHA/目录/部分迁移和测试；检查 GitHub CI、Cloudflare D1/Workers/R2/Pages；生产关键表计数；发现同名账户冲突风险 | 获取持久化四库可恢复备份、R2 物件清单/恢复方案、全表结构与历史金额摘要、检查 kakeibo bridge CI 失败原因 | **无** | **没有本项目的新部署** |
| **B SSO/昵称/首次登录** | **未开始功能开发** | 确认 HomeFlow 有 owner/member 和昵称源；代码入口初查 | 授权端点、PKCE/JWKS、稳定账号关联、App 安全会话、首次独立 PWA 路径、撤销/缓存及测试 | 无 | 无 |
| **C 家計簿个人账户 + 家庭共享 + 审批前置** | **未开始** | 只读确认旧 schema/计数、支付来源 name PK 风险 | 支付账户稳定 ID、owner_user_id、家庭读权限、正式账务 pending 拦截、同名账户回归 | 无 | 无 |
| **D HomeFlow 审批** | **未开始** | 确认现有 session/角色与路由基线 | 工单状态机/事件表/索引、幂等执行器、内部签名接口、通知/UI、异步重试审计 | 无 | 无 |
| **E 文书/知学隔离与跨 App 同步** | **未开始** | 确认文书本地旧身份与知学单人登录模式；只读旧记录数 | identity_links、shared 可写、OAuth 隔离、候选同步审批；学习所有个人表 SQL/前端缓存 user_id 化 | 无 | 无 |
| **F 全链路验收与旧鉴权清退** | **未开始** | 加入 §3.1 测试条款 | 两位用户、多站点/iPhone PWA 回归、旧 token 清退门槛、历史/R2/成本比对和回滚演练 | 无 | 无 |

## 4. 功能提交/PR/CI/部署流水账（每个功能完成立即追加）

| 日期 JST | 仓库/功能 | 分支 | Commit SHA | PR | CI | 正式迁移 | Cloudflare 部署版本/100% | 生产验收 |
|---|---|---|---|---|---|---|---|---|
| 2026-11-13 | HomeFlow — 首建跨四项目交接文档；仅记录真实调查状态 | `docs/four-app-handoff-20261113` | 见 PR commit（提交后补录） | 创建后回填 | 待运行 | 不适用 | 不适用（文档改动） | 不适用 |

**填写准则**：任何生产迁移仅能填「未执行 / 已执行（附 migration、数据库、执行时间、验证 SQL 与 count/hash）/ 失败回滚 / 阻断」。不要只写「迁移好了」。所有部署须附 GitHub Actions run 和 Cloudflare deploy/version ID、100% traffic 证据；中断时能判断是否安全重试。

## 5. 已知问题与失败项

1. **kakebo_jp main GitHub Actions `Deploy Private Kakeibo Bridge` run 43371145070 失败**。必须查 job logs 与 Worker 当前版本对应关系；已存在 100% 版本不等于 CI 失败已修复。不可在排查期间误改家账。
2. **生产 D1/R2 持久备份未全部完成**；虽然 HomeFlow D1 导出 API 曾 complete，但未证实文件安全落盘和恢复。生产迁移继续阻断。
3. **家計簿 `payment_sources.name` 唯一主键无法支持两人同名账户**；制定有旧名称兼容的稳定 ID 转换策略前不得在生产逐项重构。
4. **知学仍有单人认证和个人数据无 user_id 的表**；禁止只开放桥接 ID 后让 member 进入 owner 旧数据。
5. **文书助手现有单人本地 owner 与 HomeFlow owner 的链接尚未验证**；绝不可直接复用/复制 OAuth Grant 或改变历史文书/R2 所有权。
6. **目前所有新阶段均未完工**；首次 PWA 实机验收尚无执行记录。

## 6. 恢复时优先的下一批可执行事项

1. 复读设计书（核对 §3.1 有没有新增变化），检查四仓库 main 与本文件的 SHA 差异及所有 open PR，保留知学 #178 的变更。
2. 确认本次交接文档 PR/commit 已保存；如尚未合并，优先合并文档 PR，并在后续功能提交中持续更新此文件，**不创建第二套交接日志**。
3. **只读**完成 D1 全表/关系索引清单、金额/余额/归属摘要；对四生产 D1 做完整可验证备份并测试恢复；R2 对象数量/安全恢复方案，避免拉取敏感文件正文。
4. 排查 kakebo bridge 失败 workflow（读 job/step/log，不盲目重新部署）。
5. 完成 A 之后才创建阶段 B SSO/首次 PWA 登录单独功能 PR；以独立 feature flags、授权码短时效、受控身份映射和 fail-closed 为前提，不一次性替换全站登录。
6. 各功能完成即更新 **本文件** 的阶段状态、commit、PR、CI、生产迁移/部署、只读验证和真实遗留工作；不要把测试计划当作测试已通过。

## 7. 安全声明

本文件不包含密码、原始 Token、API Key、OAuth Secret、完整个人文书、银行账户号码、HomeFlow 会话或数据库导出签名 URL。重要的“用户已明确的历史归属”在项目层面已足够，不需要在公开仓库写入个人身份资料。首次统一身份验证必须**由真实 HomeFlow 已认证会话确认 owner_user_id**，不可从昵称猜测或生成一个伪 owner ID。
