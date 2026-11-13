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

**2026-11-13 追加：用户明确同意使用其个人 Google Drive 保存四应用生产数据的加密备份。** 已创建私人目录 [四应用生产加密备份 / 2026-11-13-A阶段](https://drive.google.com/drive/folders/1xDPwtw5u42sju89B4bFu9t5o94W0pZH3)，通过 Google Drive 原生元数据验证文件夹 `shared=false`，权限仅 `user:owner`；成功上传了仅含元数据、明确声明 **NOT_A_RESTORABLE_BACKUP** 的 [backup-preflight-status.json](https://drive.google.com/file/d/1dU7JxnHY23Ba6HEhFtcU2sVsGZD7Qgv3/view)，并读回验证其权限仍仅 owner、未共享。**该文件不是 D1 SQL 或 R2 备份，不得作为生产迁移放行依据。**

**最新四库导出结果**：对 HomeFlow、家計簿、知学、文书助手的 Cloudflare D1 Export API 均确认 `status=complete` 且生成临时 SQL 签名下载地址；**实际 SQL 字节尚未安全下载、加密、持久保存到 Google Drive，也没有恢复测试**，临时签名地址会过期。当前跨连接文件传输无法把 Cloudflare 导出下载到本地备份环境：网页读取返回不可访问，本地容器没有互联网 DNS，Cloudflare connector `request` 无法直接读取预签名对象，Google Drive `upload_file` 只接受合法 connector 文件引用（不能直接接受 URL/data URI）。这是**传输能力限制，不是 D1 导出失败**；不要重复制造 SQL 导出任务后误认为备份已完成。禁止将签名链接/SQL/密钥写入公开 GitHub。

**R2 实物逐个只读核验**：Cloudflare R2 GET 成功读取 6 个现有对象（HomeFlow 3 个：772,872 bytes；家計簿 3 个：440,351 bytes；文书助手 0 个），与 LIST 中对应大小逐项一致；在 Cloudflare 内计算全部 6 个文件的 SHA-256，校验摘要和大小已经保存在上述**仅 owner 可访问**的 Drive 检查清单。**没有对象被更改/删除、没有可恢复副本落盘。**

**阶段 A 仍阻断**：需要在可访问 Cloudflare SQL/R2 二进制和 Google Drive 写入的同一工作环境完成传输（例如用户授权的 Cloud Browser/Work 或带有正式凭证的本地安全备份流程）；对实际数据使用独立保存的加密密钥完成加密上传，逐文件验 SHA-256，恢复至隔离的本地 SQLite/测试区验证，绝不恢复覆盖生产库。此时**不需要用户再次确认备份目的地**，已获准；如需用户操作，只提出传输/密钥保管的具体必要步骤。



**R2 只读对象清单（2026-11-13，再核对）**：`homeflow-family-media` = **3 个对象、772,872 bytes**；`kakeibo-receipts` = **3 个对象、440,351 bytes**；`jp-document-assistant-private` = **0 个对象、0 bytes**。每桶只调用一次元数据 LIST，均未截断；没有读取或修改对象内容。此清单是基线，**尚非 R2 备份**。下一步对这六个既有附件建立安全、可验证的恢复副本或其他可信恢复方案。

**功能隔离的额外结构证据（只读）**：家計簿 296 条 `entries` 按 `type` 为 expense 260 / income 16 / transfer 20。知学 `language_cards` 16,170 条是 licensed 16,000 / generated 170，检查时没有 `source_type=personal`；可继续作为共享学习资源，但收藏/复习是私人状态。HomeFlow 共有 **2 个 linked person profiles + 1 个 unlinked pet profile**，昵称取 linked person，不要用宠物档案匹配账号。

**账户/学习复合主键冲突清单**：家計簿 `payment_sources.name PRIMARY KEY`、`card_bills(payment_source,bill_month)`、`investment_plans(fund_code,account_type)` 均未包含 owner_user_id。知学 `saved_vocabulary_entries_v2(language,term)` 和 `daily_task_completions(task_id,study_date)` 也未包含 user_id。两人使用同名信用卡、同基金、同生词/同一天做题会碰撞，必须在**可回滚迁移**中建立真实 ID/owner 复合唯一约束和所有读写过滤，不能只给表简单追加 user_id 而保留原唯一键。


**补充只读核验**：四个生产 D1 的 Cloudflare Time Travel 当前 bookmark 查询都成功，说明**当前可取得恢复书签**；这并不代替完整、持久保管且已测试的 SQL 备份，不允许据此越过生产迁移门槛。书签原文不写入公开仓库。

**正式 migration journal（2026-11-13 实查）**：HomeFlow `d1_migrations=54`，最后名 `0052_achievement_thresholds.sql`；家計簿 `schema_migrations=16`（`version` 是多种文本标识，字典序 MAX=`unified-merchant-rules-v1`，**不代表最新执行时间**）；知学 `d1_migrations=174`，字典序最后 `0176_fe_exemption_sample_duplicate.sql`；文书助手 `d1_migrations=19`，最后 `0019_document_translation_cache.sql`。这些是**当前线上既有迁移**，本项目 A–F 新迁移仍为零。


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
| **A 调查、只读基线、备份** | **进行中，备份文件传输阻断正式迁移** | 冻结 v1.1 需求与 §3.1；四库正式表计数/现有迁移、Cloudflare 资源/生产版本、各库 Time Travel bookmark；四 D1 Export API 生成临时 SQL；六个 R2 对象逐项 SHA-256/大小通过；已建私人 Google Drive 文件夹并上传检查清单、确认 owner-only | **未能将实际 SQL/R2 字节加密上传 Google Drive 或恢复验收**；待受控文件传输通道；待全表/金额摘要；已定位家計簿 GitHub deploy 缺 Secrets | **A–F 新迁移零** | **无本项目新功能部署** |
| **B SSO/昵称/首次登录** | **开发中：HomeFlow PKCE + 文书助手后端回调均通过 CI，仍非 iOS 可用 SSO** | HomeFlow Draft #305 身份/昵称读 API、短期 code+PKCE、审核确认 UI/写审计和注销联动；文书助手 Draft #97 新增独立服务绑定 code exchange / userinfo + 15 分钟本地 HttpOnly Session / 双证 owner / 空白 member 测试，[CI #43393452443](https://github.com/PTamako/jp-document-assistant/actions/runs/43393452443) success | 待 HomeFlow 与三 App 真正集成；文书 Safari/PWA Cookie 隔离和跨 App 账号停用注销传播仍未解决；家計簿/知学 OAuth 客户端/会话及 iPhone 双人实机测试未开始；非 OIDC ID-token/JWKS | **HomeFlow 0053 / 文书 0020/0021 均未执行** | **未上线；两 Draft PR 均未合并、所有 OAuth feature flags 默认关闭** |
| **C 家計簿个人账户 + 家庭共享 + 审批前置** | **未开始** | 只读确认旧 schema/计数、支付来源 name PK 风险 | 支付账户稳定 ID、owner_user_id、家庭读权限、正式账务 pending 拦截、同名账户回归 | 无 | 无 |
| **D HomeFlow 审批** | **开发中：审批申请/管理员审核/取消/永久事件日志 + 并发幂等/防伪审核均 CI 通过，Draft PR #306 未上线** | 在 HomeFlow Draft #305 分支之上另建 [Draft #306](https://github.com/PTamako/homeflow/pull/306)；0054 未执行增量迁移，append-only 事件/SQL 状态合法性与 reviewer 同家庭 owner 强验证；默认关闭的 5 条分页、member 申请/取消、owner 批准/拒绝；同一幂等键并发提交仅产生一单一条事件；[CI #43395978998](https://github.com/PTamako/homeflow/actions/runs/43395978998) **success** | **仅审批意图，批准≠已生效！** 目标 App pending payload/expected_version 实际执行、安全 Service Binding、timeout 按 idempotency 复查、Push/通知与 UI、全链路双人验收尚未实现 | **0054 未执行（依赖 0053 未执行）** | **PR #306 Draft，feature flag OFF，未合并、未部署** |
| **E 文书/知学隔离与跨 App 同步** | **开发中：文书助手无损身份映射 + HomeFlow 后端 PKCE 回调，Draft PR #97 未上线** | 文书本地 owner 和 HomeFlow owner UUID 不同的实际情况已确认；0020 不可变链接、0021 加密 PKCE 待确认事务均以新增迁移形式编写；服务端 HomeFlow code→token→userinfo 校验且角色/家庭/audience 防串号，旧 owner 要本人两套有效会话双重验证、member 仅在 owner 已绑定后建空账号，不继承私人文书/Google 授权；CI [43393452443](https://github.com/PTamako/jp-document-assistant/actions/runs/43393452443) success | **iOS Safari/PWA Cookie 分离仍阻断真正首次登录**：当前 callback 只接受启动时同浏览器 SameSite=Lax state cookie；仍需安全跨容器一次性续接、App UI、账号禁用/退出实时传递、共享文书编辑、候选同步审批；知学个人表及缓存隔离仍未开始 | **0020/0021 未执行** | **PR #97 未合并，未部署；HomeFlow OAuth 同样未上线** |
| **F 全链路验收与旧鉴权清退** | **未开始** | 加入 §3.1 测试条款 | 两位用户、多站点/iPhone PWA 回归、旧 token 清退门槛、历史/R2/成本比对和回滚演练 | 无 | 无 |

## 4. 功能提交/PR/CI/部署流水账（每个功能完成立即追加）

| 日期 JST | 仓库/功能 | 分支 | Commit SHA | PR | CI | 正式迁移 | Cloudflare 部署版本/100% | 生产验收 |
|---|---|---|---|---|---|---|---|---|
| 2026-11-13 | HomeFlow — 首建跨四项目交接文档；仅记录真实调查状态 | `docs/four-app-handoff-20261113` | `1db3b510332bf3a2a37670584bc9a6bd7aa29aca`（首建）/ `8a15d29d44c3f58ebedf89b952ce2fed9206c17b`（补录）/ `3e984de3867410d93372112658205bbb4b89113a`（squash main） | [#304](https://github.com/PTamako/homeflow/pull/304) **已合并** | [Validate run 43384895765](https://github.com/PTamako/homeflow/actions/runs/43384895765) 成功；main Validate/Deploy 43384895765 后的新 run 已成功 | 不适用 | 文档合并触发既有 main 自动部署成功，**未上线新身份功能** | 文件 main 已重新读取确认 |
| 2026-11-13 | HomeFlow B2 — OAuth code+PKCE 禁用默认的后端基础（尚不是完整 SSO） | `feature/homeflow-identity-read-contract-20261113` | `8bd8bc7dc8ad6d63dd8089dd0a756bd05f5974b1` (worker/oauth.js), `acdb93af43c7826ff1bfbb40db75d54e7feb7d71` (0053), `7076fe976d897d5550a5f790a2caea94b5f92344` (router), `2406b7f68c3e4d53e87035a4153495b306bf2c93` (manifest), `253d54ef1a9820419c70f76e7fa6d68adef76f38` (PKCE tests), `9a8d0f949f00863cf3a71a1418199dfb54c571e9` / `89d781f25c770611c794c338f90684c04cef31a7` (legacy count fixture fix) | [Draft #305](https://github.com/PTamako/homeflow/pull/305) **未合并** | 初次 run 43387920629 等因为迁移总数固定写死为 54 导致失败；已修复并由 [run 43388105347](https://github.com/PTamako/homeflow/actions/runs/43388105347) **success** | **0053_oauth_code_exchange.sql 尚未生产执行** | **未部署；OAUTH_ENABLED 默认关闭** | 本地 CI success；真实账号/PWA/回调接入尚未完成 |
| 2026-11-13 | HomeFlow B1 — read-only `/api/identity/me` 与家庭成员昵称契约 + 五组隔离回归测试 | `feature/homeflow-identity-read-contract-20261113` | `a48752299b0d3253573b274038b10891cefc0560`（模块）/ `0128aa4a637e97fb4eb40ad8709cd72a0d6ab005`（测试）/ `52ee0731c4738f314d66d9a79536b18fe5337efd`（路由） | [Draft #305](https://github.com/PTamako/homeflow/pull/305) **未合并** | [Validate run 43385362454](https://github.com/PTamako/homeflow/actions/runs/43385362454) **success** | 不适用 | **未部署**（A 备份门槛未满足） | 仅测试成功，生产/双人 PWA 验收未执行 |

| 2026-11-13 | 文书助手 B/E — 一对一 HomeFlow↔本地 user ID 的无损链接表 + 老数据保留测试 | `feature/homeflow-identity-link-safety-20261113` | `b6e1d7d9d890154cc193230886356966b01db22f`（迁移文件）/ `b77bf4207094d6fd1cc706a85043a746f629d29b`（测试） | [Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) **未合并** | [Pre-merge CI run 43386709400](https://github.com/PTamako/jp-document-assistant/actions/runs/43386709400) **success** | **0020_homeflow_identity_links.sql 未在生产执行** | **未部署**（A 备份及服务端身份链接验收未完成） | 测试成功；生产/实机登录未测 |
| 2026-11-13 | HomeFlow B2 安全审计 + /authorize 用户确认页面 + 会话撤销 + D1 低读数优化 | `feature/homeflow-identity-read-contract-20261113` | 审计 `4a71f630d717277709d5854ed0bdfbd1aeb25aa0` / `debeea8791e7ff8f8102ed06aa2978d647298f58` / `383e478ca70d5d98ec45720652072e3e9221ec37`；同意 UI `81c19cc8145c2f95178dbe41352583810b224f55` / `dc277f93aca3932e92e57bb1562b7035cdc5fbd1` / `f97ed4c1440b4dd8f4a245b21afdbcf1bafb752e` / `6cad004c20c873f8fa3ea3e80ce23461583f8d52` / `6a7142cf4d8719d1acc2d1ac499956a83cabc8a4`；低读数 `ce54ad7ddb7d87f7a251800ac2cf0b859cd7eada` / `64a2b12736ef9e81bc4fc1111d1345feee84a31b`；会话绑定 `4c5dc922c5172dd615554941887527d8f0fec9b9` / `fb08a457096d3d6c48c2c839b676a438939d397a` / `358708098b5f745aa628c5af4482fe06f004a372` | [Draft #305](https://github.com/PTamako/homeflow/pull/305) | 中途 Vue ref 赋值/测试断言失败已修复；最新 [Validate run 43389573939](https://github.com/PTamako/homeflow/actions/runs/43389573939) **success** | **0053 未执行** | **未部署，OAuth 默认 disabled** | 自动化单测/类型检查通过；未进行真实应用回调和 iPhone 实机验证 |
| 2026-11-13 | 文书助手 B/E — 完整隔离的后端 HomeFlow PKCE 回调（Draft，禁止生产）+ 双重 owner 验证 + member 空白个人库 | `feature/homeflow-identity-link-safety-20261113` | `fc667d3b524f748e776c7b1c279ecbb7ac4ed009`（0021 待确认事务）；`af7b9b4c0670bd058bf9286722ba672e3935be7a`（SSO Service Binding/加密 verifier）；`aa3e8bf7ed3424e364da80b945aa62cb766c9aa3`（实际 HomeFlow household=`primary` 兼容）；`4d1b7b582e2b91fbc35c55fed629317e85a043c5`（路由）；`30dcd1213abd1b27e36a4d75e1fcebcd872e76bb`（双身份/旧数据隔离测试）；`acfc518f9af313445bc5123fcbd576a26d07327c`（上线前安全门槛说明）；`d556a360fb050ec76db57e7cefc4031408567781`（真实 Worker route、PKCE 加密测试） | [Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) | [Pre-merge CI #43393452443](https://github.com/PTamako/jp-document-assistant/actions/runs/43393452443) **success**（含旧现有测试与新增内存 SQLite 测试） | **0020/0021 均未执行** | **未合并、未部署、SSO 默认关闭** | 自动测试成功；真实 HF OAuth 服务配置/回调、iPhone PWA Cookie/跨浏览器续接、双人实机验收均未通过 |
| 2026-11-13 | HomeFlow D1 — 审批申请/取消/owner 审核/不可变事件核心，**不接入正式家計簿执行** | `feature/family-approval-state-machine-20261113`（base：Draft #305，包含 0053） | `7a8bf68466720672373ad20bc53276b4b2c5b0a3`（0054）；`6661e4e40179af98bdf62c97913d7427e55c8b30` / `1cca917f41fa5ed1540f21b08c7a3c29505b15ca` / `5ed2a11a1ba3d9356a11af5eb9f169072be8d29a`（server routes 与角色校验）；`f5fbf22dc41c3131f0e1a3d58e0309b8957560fa` / `ce560daba1632619ad17a99eed0657b82cccac3c` / `136343de7a71887a76ac7b5ef5e15399a087f6ff` / `be9875f50822db4b74d24fce1de27beb0a261807`（路由与迁移登记/测试 fixture）；`6a63c547a05058ff0d963113b32f89b96a1b8d9f` / `d9e4dec70714180ca94f06fc160232e8c04b4e29` / `e9ed21b5bd83d585e9e20528cb5144680f5dcd63`（新增测试与过期约束修正）；`09bd2f91c7493d244f05b2546910fd08dde44902`（安全合同） | [Draft #306](https://github.com/PTamako/homeflow/pull/306) | 初次 [run 43395163950](https://github.com/PTamako/homeflow/actions/runs/43395163950) 失败于人为测试输入破坏 `expires_at>created_at`；修正后 [run 43395287920](https://github.com/PTamako/homeflow/actions/runs/43395287920) **success**；PR 最后 docs commit 后新 CI 如有需再核查 | **0054 未执行，依赖 0053** | **未合并/未部署，APPROVALS_ENABLED 不存在默认为关闭** | 自动化 SQL 状态保护、五条列表、角色/幂等/审计通过；目标执行器与家計簿账单真写未开发 |
| 2026-11-13 | HomeFlow D2 — 并发重复审批提交与 SQL 层审核人防伪增强 | `feature/family-approval-state-machine-20261113` | `8355e4f935a0b094c6e690c39976e4bdd05862ca`（并发完全一致的申请返回已存在工单）；`d304fd050aff012d36d1b4e89522120ee6b34ba2`（SQL 只允许本家庭非申请人的有效 owner 审核，审核人确定后冻结）；`f3c807ed5f8ba3358064ef37f040e4b9e880e818`（两个新增并发/伪审核测试） | [Draft #306](https://github.com/PTamako/homeflow/pull/306) | [Validate run 43395978998](https://github.com/PTamako/homeflow/actions/runs/43395978998) **success**（Node 测试、SQL 迁移、Worker dry-run） | **0054 未执行** | **未合并/未部署，APPROVALS_ENABLED 默认关闭** | 双设备同 key 无重账、无审批重复事件；无真实目标记账执行器 |


**填写准则**：任何生产迁移仅能填「未执行 / 已执行（附 migration、数据库、执行时间、验证 SQL 与 count/hash）/ 失败回滚 / 阻断」。不要只写「迁移好了」。所有部署须附 GitHub Actions run 和 Cloudflare deploy/version ID、100% traffic 证据；中断时能判断是否安全重试。

## 5. 已知问题与失败项

1. **已查明 kakebo_jp main GitHub Actions `Deploy Private Kakeibo Bridge` run [43371145070](https://github.com/PTamako/kakebo_jp/actions/runs/43371145070) 失败根因**：job `131706942791` 中测试通过，但在 `Verify Cloudflare production credentials` 步骤因 GitHub repository/environment secret **`CLOUDFLARE_API_TOKEN` 缺失**失败（日志中 `CLOUDFLARE_ACCOUNT_ID` 也为空）；后续部署步骤 skipped。**这不是业务单测失败**。Cloudflare 当前 Worker 100% 版本是既有版本，不证明这次 push 已部署。不得把真实 token 写进本文件；恢复时由有权限人员安全配置 GitHub Actions secrets，或走经认证的 Cloudflare 发布流程，并验证生产版本。
2. **生产 D1/R2 持久备份未全部完成**；虽然 HomeFlow D1 导出 API 曾 complete，但未证实文件安全落盘和恢复。生产迁移继续阻断。
3. **家計簿 `payment_sources.name` 唯一主键无法支持两人同名账户**；制定有旧名称兼容的稳定 ID 转换策略前不得在生产逐项重构。
4. **知学仍有单人认证和个人数据无 user_id 的表**；禁止只开放桥接 ID 后让 member 进入 owner 旧数据。
5. **文书助手 HomeFlow 后端回调已经编写并通过测试，但非完整 PWA 登录**：新的 `0020/0021` 迁移未执行，SSO feature flag 仍 OFF。HomeFlow ID/role/audience 来自 Service Binding 的受信 userinfo，owner 必须绑定原本仍有效的文书账号才能关联；member 禁止冒领 owner。iPhone 独立 PWA→Safari Cookie 共享未解决，当前 SameSite=Lax 回调缺 Cookie 会拒绝；**不得为改善体验绕过 state 浏览器绑定**。需要另设计有 PWA 原始端确认的一次性 handoff，且要完成 HomeFlow 账号禁用/退出向业务 Session 的授权撤销传播。文书侧 [安全门槛清单](https://github.com/PTamako/jp-document-assistant/blob/feature/homeflow-identity-link-safety-20261113/docs/homeflow-sso-backend-gates.md)。
6. **已在两个生产 D1 内部只读比较**：文书助手本地 owner user ID、household ID 与 HomeFlow 的 owner 对应 ID **并不相等**，但均只有一位 owner，这与旧系统独立身份模型一致，**不是异常数据，也不需要用户重申归属**。Draft #97 为此设计映射表，尚无任何行被生产插入；绝不可直接复用/复制 OAuth Grant 或改变历史文书/R2 所有权。
7. **目前所有新阶段均未完工**；首次 PWA 实机验收尚无执行记录。
8. HomeFlow **Draft PR #305** 已扩展为身份 API、授权码 PKCE、用户同意 UI、会话级撤销、最小审计和免轮询优化，**最新 CI 已通过但尚未合并/上线**；它仍不包含三个业务 App 的回调和会话、真实 client URI allowlist 或完整 OIDC。生产备份门槛完成前不得启用/合并。

9. **阶段 D D1 审核意图及防伪已经通过 CI，但真实执行与审计尚未形成闭环**：新 Draft #306 只处理 Member pending 申请、Owner approved/rejected 和取消；**绝对不含 kakebo 正式账本写入或执行接口**。未通过 A 备份/真实两端身份校验前不得合并和启用。代码/依赖细节见 [家计审批核心合同](https://github.com/PTamako/homeflow/blob/feature/family-approval-state-machine-20261113/docs/household-approval-contract.md)。严格分别记录 requester、approver、future actor，并保持审计记录不可篡改。

## 5.1 必须提前通知用户的操作（用户已要求）

- **家計簿 GitHub 自动部署**：GitHub Actions secrets `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 目前在失败的工作流中为空，需要用户通过 GitHub 仓库 Settings → Secrets and variables → Actions（按实际环境选择）安全配置，或由开发方用已授权 Cloudflare 工具部署并验证生产；**不得要求用户将 Token 明文发到聊天或写入本仓库**。此项并非继续编写未上线代码的阻断项。
- **备份目的地已经获准并创建，无需再问**：私人 Google Drive 目录已验证 owner-only。当前**阻断的是 Cloudflare 临时 SQL/R2 字节跨工具传送到可加密/可上传的环境**。须在能够安全下载与上传二进制的会话（如 Work Cloud Browser）或用户本地设备使用有权限的 Cloudflare / Google Drive 客户端；若需要用户配合，只需明确安全传输流程和解密密钥的离线保管方式，不要求在聊天或 GitHub 提供密码/Token。不得用临时 SQL 导出/Drive 检查清单替代真正完整备份。
- **iPhone 双账号实机验证**：阶段 F 请 owner 和 member 各自从独立 PWA 完成授权、登录、注销、切换账号、私人数据/Google OAuth 隔离验收；当前不需要操作。
- 其他规则无须重复询问，只有发现真实生产数据与明确历史归属冲突，才隔离具体异常行。

## 6. 恢复时优先的下一批可执行事项

1. 复读设计书（核对 §3.1 有没有新增变化），检查四仓库 main 与本文件的 SHA 差异及所有 open PR，保留知学 #178 的变更。
2. 确认本次交接文档 PR/commit 已保存；如尚未合并，优先合并文档 PR，并在后续功能提交中持续更新此文件，**不创建第二套交接日志**。
3. **只读**完成 D1 全表/关系索引清单、金额/余额/归属摘要；对四生产 D1 做完整可验证备份并测试恢复；R2 对象数量/安全恢复方案，避免拉取敏感文件正文。
4. 排查 kakebo bridge 失败 workflow（读 job/step/log，不盲目重新部署）。
5. B1/B2 HomeFlow Draft #305、文书助手 B/E Draft #97 与 HomeFlow 审批申请/审核 Draft #306 均已有 CI 成功的独立后端模块，无须重复开发。#306 以 #305 的分支为 base，包含 0053→0054 两个**未执行**迁移；应先审计并设计 HomeFlow/家計簿目标执行器的签名 Service Binding、expected_version 和幂等查询，所有财务明细在审批通过并且目标写入确认前绝不能显示已生效。**优先审计并实现 iPhone PWA 与 Safari 不共享 Cookie 时的一次性、受原 PWA 校验的授权回传**，并完成 HomeFlow 禁用/注销时其他应用 session 失效的安全机制；不得提前启用。备份 A gate 完成前不执行正式新迁移、不合并会触发正式部署的功能 PR。
6. 各功能完成即更新 **本文件** 的阶段状态、commit、PR、CI、生产迁移/部署、只读验证和真实遗留工作；不要把测试计划当作测试已通过。

## 7. 安全声明

本文件不包含密码、原始 Token、API Key、OAuth Secret、完整个人文书、银行账户号码、HomeFlow 会话或数据库导出签名 URL。重要的“用户已明确的历史归属”在项目层面已足够，不需要在公开仓库写入个人身份资料。首次统一身份验证必须**由真实 HomeFlow 已认证会话确认 owner_user_id**，不可从昵称猜测或生成一个伪 owner ID。
