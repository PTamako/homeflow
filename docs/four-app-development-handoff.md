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

## 3. 按 A → F 的实时进度（最新用户决定；优先于旧调查快照）

**A 固定为「待用户完成」**：用户有电脑时自行进行生产加密备份和隔离恢复验证。开发助手不再执行、尝试或询问 A。用户主动通知完成前，四应用不得执行生产 SQL、开新身份/审批开关、合并会触发生产部署的 PR。允许继续 B～E Draft 代码、测试、UI 和 SQL 文件。

| 阶段 | 最新真实状态 | 已完成（Draft / CI） | 未完成与下一步 | 生产状态 |
|---|---|---|---|---|
| **A：生产备份与恢复** | **待用户完成（用户自行安排，开发助手不再处理）** | 此前仅有生产只读清单、导出预检与私人 Drive 目录；未取得完整、已验证恢复的备份 | **无需询问或重试**；未来用户主动告知成功后才进入生产步骤 | **生产迁移/部署前置门槛未通过** |
| **B：统一账号与昵称** | **Draft 开发中，未上线** | HomeFlow #305、家計簿 #309、知学 #179、文书 #97：分离身份/PKCE、源会话验证、旧 owner 安全确认、member 不继承私人资料；此前相应 CI 已通过 | PWA/双人首次绑定、昵称显示、账号切换与本地缓存清理、撤销后端到端检查 | HomeFlow 0053、家計簿 0022、知学 0180、文书 0020～0022 未迁移；所有开关 OFF |
| **C：家庭账本与个人金融账户** | **部分 Draft 功能已通过测试** | 家計簿 #309：稳定账户 ID、成员各自设置、历史金融资源不可变归属、夫妻共同账本与月度统计的只读 API、已知储值和证券资产汇总、受限现金入账映射 | 双方同名信用卡/储值卡/SBI/固定费完整私有设置、余额、资产统计全 UI 与历史无损核对 | 0022～0026 未执行、未部署 |
| **D：家庭审批与执行** | **受限现金单笔审批→一次入账 Draft 子链已通过自动 CI；整体未完成** | HomeFlow #306：审批/审计、签名提交及核验、短租约、remote receipt 后 applied；家計簿 #309：加密草稿、幂等提交、丢包恢复、仅现金账户稳定 ID 的原子 entry + 执行日记 + actor 审计。HomeFlow Validate #43428049072 success、家計簿 Validate #43427933666 success（此检查点） | 审批中心 UI/通知、跨服务真实联调、信用卡/储值/SBI/固定费/文书审批执行器、全部失败恢复和双人验收。**批准不等于已入账** | HomeFlow 0054/0055、家計簿 0024/0026 未执行；所有功能 PR Draft、开关 OFF |
| **E：文书共享/知学隔离与跨 App 联动** | **部分 Draft 完成，未上线** | 文书 #97：身份映射、共享文书和附件部分协作、真实 actor 审计/R2 原 owner 保护；知学 #179：独立身份 API，旧个人学习 API 默认不授新会话 | 知学个人进度/生词/考试及离线缓存按 user_id 隔离；文书所有共享路径与跨 App 同步审批/执行、两应用 PWA UI | 知学 0180、文书 0020～0022 未迁移，开关 OFF |
| **F：生产迁移与双人验收/清退旧鉴权** | **未开始，等待用户 A 完成和 B～E 功能稳定** | GitHub CI / 本地 SQLite、部分 WebKit 冒烟并非两台真实 iPhone 验收 | A 完成后再统一安排正式 SQL、线上部署核验、双人真实 PWA、业务/R2 数据/费用对账及回退；不得提前删除密码/Token | 未部署统一身份，不放行 |

**本节为唯一现行状态口径**：旧 §6、§8 里的导出/备份下一步是历史审计记录，不再构成工作指令。尤其 HomeFlow .github/workflows/deploy.yml 对 main 的任何 push 都自动触发生产 deploy；因此本阶段交接文件也只能以独立 Docs-only 分支/PR 提交，不得合并。

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


## 6.1 2026-11-13 续开发检查点（本节为最新实查，优先于旧快照）

### 阶段 A：四库、main 与部署最新实查
| 仓库 | main HEAD | 当前相关 open PR |
|---|---|---|
| HomeFlow | 06b055f311b77c2e5239266d15aed4664e09d75a（旧基线之后仅增加本交接文件） | Draft [#305](https://github.com/PTamako/homeflow/pull/305) 身份，Draft [#306](https://github.com/PTamako/homeflow/pull/306) 审批；#306 基于 #305 |
| 家計簿 | 3bac4610078729556a7068c761e3e7c1729ab27d | 无 open PR |
| 知学 | ae8c0dea3468006d0fbbfaaf953afbf3f4f645da | Draft [#178](https://github.com/PTamako/it-study-platform/pull/178) 题库，不得覆盖 |
| 文书助手 | b19603e2060cc7ef5a709a42133a2745480509e2 | Draft [#97](https://github.com/PTamako/jp-document-assistant/pull/97) 统一账号 |

正式 Cloudflare D1 只读确认的迁移头仍为：HomeFlow 0052_achievement_thresholds.sql、家計簿 schema-0019-verified（按 rowid）、知学 0176_fe_exemption_sample_duplicate.sql、文书助手 0019_document_translation_cache.sql。阶段 A–F 的 HomeFlow 0053/0054、文书 0020/0021 **均未执行**。四个独立 D1、三个 R2 Bucket 仍存在，未创建任何 Preview。本次并未写入生产数据，完整 SQL/R2 加密持久副本与隔离恢复测试**依旧未达标**，禁止在完成备份前执行写迁移或合并启用身份/审批 PR。

Worker 活跃 deployment/version（均 100%）复核：HomeFlow 3e4e1196-eb69-491a-9d9e-3200fb9ebcd1 / bda6b1f3-c3d3-45b3-b85e-c550476c61d4（2026-11-13 08:49 UTC）；知学 cbdd6b4b-e421-4852-a903-0a52fc8d1e4d（06:58）；文书 bf16d3a8-fb15-44d4-88a0-cbad1a1189ea（05:43）；家計簿桥接 d2413db6-df06-4dcf-bba2-2b00a38ab2ef、nav 58fca012-f9ea-4d52-95ba-0f99753dfa5c。Pages kakeibo production_branch=main，latest deployment a9075ac5-865c-47a4-b981-7ff97f6aced2。**上述既有生产版本都不含新统一账号功能。**

### 阶段 B：此次实际新增（Draft，仅代码与测试，不上线）
复用文书助手 feature/homeflow-identity-link-safety-20261113 / [Draft PR #97](https://github.com/PTamako/jp-document-assistant/pull/97)，没有再创建重复功能 PR：
- 63c20a578b4998046f3e9d58b37c4a52de140d28：尚未执行的 0021 schema 增加独立 PWA 续接凭证 SHA-256 摘要与加密回调列。
- a5a49789409e6391bb75b013cc28c22b16377f6f：Safari callback **仅 AES-GCM 加密暂存 code，不签发会话**；原 PWA 持有从未出现在授权 URL 中的 256-bit 一次性 resume_secret，在 POST /api/homeflow-sso/complete 兑换会话；维持 HomeFlow 角色/家庭/audience 校验和旧 owner 双身份凭据。
- cb60c8d73cc0a72289bf21c29eeee4036e1fe27d、75427586f01ffc9cb584b313d5d09976128e5bc6、516e834ce8d6907dc9f395470ac80711b87c11d3：注册 /complete 与只在服务器全部配置满足时为真值的 /status。
- 43f19a2f7cf93470198bfeb10ddd6a3a044b1cca、7c6fbff9a3c0a84f496a2ecd3ed352108f98b38f：内存 SQLite/Worker 测试新增外部 Safari 与独立 PWA 无 Cookie 共享、伪造 proof、Origin、防重放、旧 owner 会话失效及个人空间/旧数据保护。
- 60f6329a724820a873212fb9a5e1107d550f75a6：Vue App 增加服务器启用后才显示的“使用 HomeFlow 登录／完成登录”入口；原 PWA 的临时 proof 仅保存当前 sessionStorage 5 分钟；成功切换账号清理私人端侧状态。
- e824ab5572b667893e5ce0f0c4249271476f7314：安全门槛文档更新；本轮文书功能最新 head 即此 SHA。

**CI**：[文书 Pre-merge #43397762675](https://github.com/PTamako/jp-document-assistant/actions/runs/43397762675) test job 已核实 success（源代码 syntax、Node/Python/SQLite 回归、Vue build、PWA 资源）。**不是 iPhone Safari/PWA 双人真实验收**；功能默认关闭，文书 PR #97 仍为 Draft、未合并/未部署。其余三个仓库本次没有功能代码提交，不重做已有实现。

### 下一步：A→F 与必须避免的步骤
A：完成四 D1 SQL 和三 R2 的真正加密持久备份（当前仅有 Export API complete 的临时对象）、逐项 SHA-256 和隔离恢复；可用可信传输环境，不在 GitHub/聊天保存 signed URL 或密钥。B：HomeFlow 与三 App 的注册回调 allowlist、完整 PWA 流程、账号冻结/注销跨应用 session 失效、iPhone 两人验收。C：家計簿支付来源 name PK 的稳定 ID 迁移、金融配置个人隔离、家庭账本共享、member 写入 pending 拦截。D：HomeFlow approved → 目标服务安全幂等执行 / 重试 / 生效审计 / Push；目前批准**绝不等于记账生效**。E：文书共享写权限、知学多个人表 user_id/复合唯一键与端侧缓存隔离。F：两人真机和所有历史保护验收后清退旧鉴权。

**继续开发必须先核对 live 状态**：不重复执行 A 阶段临时 SQL export、不重复应用任何迁移、不重建 Preview，不把 CI success 当作线上功能。文书 PWA 功能虽已写代码，仍缺正式备份、跨 App 注销撤销、HomeFlow 真正启用及原设备验收。所有已存在的数据与历史归属规则保持不变。


## 6.2 2026-11-13 家計簿 B 阶段身份底座增量（用户明确备份稍后自行完成）

**用户新指令**：备份与恢复由用户之后在电脑上自行处理；此时继续开发尚不依赖生产迁移的代码与测试。**这不是对正式写迁移/上线的豁免**：A 阶段的持久加密备份及隔离恢复仍为正式发布硬门槛，本次没有重新执行任何生产 SQL/R2 写入。

**新功能实际保存**：[家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，分支 `feature/homeflow-sso-isolated-foundation-20261113`，相对 main `3bac4610078729556a7068c761e3e7c1729ab27d` 开发，**PR Draft 未合并、未部署**。提交（从早到晚）：
- `6974548f0bd3f8bb5d976ad0eb62fdee229cefcc`：新增 `migrations/0022_homeflow_identity_foundation.sql`，HomeFlow 用户唯一绑定、owner/member 身份、5 分钟一次性 Safari 回调状态、单独应用会话及带真实 actor 的身份审计。**未在正式 D1 执行，也不能自动重跑旧迁移**。该迁移不改旧家账、个人金融设置、已有设备会话。
- `75319eb77a8b7447c379c7311a11afc6da019c75`：新 `functions/api/homeflow-sso/[[path]].js`，默认开关关闭、缺绑定或 Preview 环境直接 503；后端 HomeFlow Authorization Code + PKCE、固定 audience、原 PWA 一次性 proof，Safari 仅加密暂存 code，首次 owner 与原家計簿有效设备会话双重证明，member 在同家庭 owner 绑定后才建立独立空身份。
- `8a27a0baf9c3bfd1eec24e055ff9b3cfe114c9d9`：Node 内存 SQLite + 真路由测试，验证浏览器分离、重放/盗用、错误 Origin、账号置换、先 owner 后 member、旧财务数据不变及 **member 的 SSO Cookie 访问原 /api/entries 为 401**。
- `2fade8f00202e02fd451e7f1e17131c3c153585c`：功能安全说明 `docs/homeflow-sso-phase-b.md`。
- `87d46cc27044e642888b76cd55c7ac12774bbe6c`：第一轮 CI 明确发现 SQLite 严格解析不接受 SQL 状态文本双引号，已更正为单引号。**失败已经修复，不要恢复旧写法**。

**实际 CI 验证**：家計簿 [Validate #43400307504](https://github.com/PTamako/kakebo_jp/actions/runs/43400307504) **success**；日志显示 `845 passed / 0 failed`，含新增 6 组完整 HomeFlow SSO 测试；Vite 构建与生产依赖审计通过。此前 [Validate #43400186459](https://github.com/PTamako/kakebo_jp/actions/runs/43400186459) 为发现双引号问题而失败，不能称首轮即通过。独立 [Mobile WebKit Smoke #43400307439](https://github.com/PTamako/kakebo_jp/actions/runs/43400307439) 在最近一次查询时仍在运行，需重新取 run/job 结论，不能假定实机 iPhone 测试通过。

**重要授权隔离**：新 `__Host-kakeibo_hf` Cookie **不被旧 `functions/api/[[path]].js` 识别**，所有新 SSO 状态响应明确 `ledger_access:false`。`KAKEIBO_HOMEFLOW_SSO_ENABLED` **绝不能启用**，否则仍无完善的财务 API 权限路由；这阶段不是“成员能登录并看到共享账本”。尚无正式 client allowlist/服务绑定，未加真正跨 App 停用/注销会话撤销。家計簿的旧单人访问码与线上功能未改变。

**后续顺序**：A 由用户电脑完成四 D1/三 R2 加密可恢复备份后记录 SHA/隔离恢复报告（绝不贴秘密）；B 先补齐 HomeFlow 与三个业务应用实际 server-side 会话实时撤销/授权、知学统一登录、PWA 前端登录/切换，完成预发布联调；C 基于稳定账户 ID 修正 `payment_sources.name` 主键和同名账户问题，按 owner_user_id 隔离个人金融，保持账本和统计家庭共享；D 仅在 HomeFlow 审核后以幂等事务真正记账，不可将“已批准”当“已生效”；E 文书与知学按真实 user_id 隔离；F iPhone 双人真实验收后逐步清退旧登录。**不要重新创建 Preview 或直接合并 Draft #309、#305、#306、#97**。


## 6.3 2026-11-13 阶段 B：跨应用源会话撤销验证完成（代码/自动测试，未上线）

用户明确把生产 D1/R2 备份与隔离恢复延后，计划有电脑后亲自操作；**本次许可仅指继续开发分支与测试，不豁免生产备份门槛**。阶段 A 依旧阻断任何生产迁移、功能 PR 合并或启用开关；本节所有新 SQL 文件均未执行。无新增 Preview、无正式业务数据/资源改写。

| 项目 | 本轮增量 | 最新头 SHA | CI | 生产 |
|---|---|---|---|---|
| [HomeFlow Draft #305](https://github.com/PTamako/homeflow/pull/305) | 在尚未执行的 0053 新增短期 `oauth_session_assertions`，与 HomeFlow 原登录 session FK 绑定；OAuth 后端 code 兑换额外签发 15 分钟 server-only assertion，`POST /api/oauth/session-introspect` 精确按 client/user/family/role/session 活性校验；Logout、账号禁用、成员关系删除即时失效，普通校验只读 D1 不写审计；修复旧 OAuth UI 静态测试断言 | `b8b877388639b1a2b3ac19dbca58ea8072b8a037` | [Validate #43402025579](https://github.com/PTamako/homeflow/actions/runs/43402025579) success | 0053 未执行，OAuth OFF |
| [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) | 未执行 0022 增加 AES-GCM 加密 `session_assertion`，其 `/api/homeflow-sso/me` 每次服务端复核 HomeFlow 原会话；登出、换角色、禁用拒绝 401；新会话永远不接受旧财务 API，`ledger_access:false` | `7f386e16586d17a12ee2ad1617a9519e05065b18` | [Validate #43402915695](https://github.com/PTamako/kakebo_jp/actions/runs/43402915695) success，WebKit [#43400307439](https://github.com/PTamako/kakebo_jp/actions/runs/43400307439)（早期基础版）success | 0022 未执行，SSO OFF，无财务访问 |
| [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) | 新 0022 未执行迁移：`sessions.auth_source` 默认 legacy，HomeFlow 新 session 必须标记 homeflow 并在服务端加密保存 HomeFlow assertion 1:1；私人读写 `requireSession` 对 HomeFlow session 必须实时后端 introspect，失败或没有 proof 严禁旧账号兜底；既有 legacy 文书、Google OAuth/grant 不改 | `e255ce0de87bd4f0e31a674f38e87d66d778449e` | [Pre-merge #43402597451](https://github.com/PTamako/jp-document-assistant/actions/runs/43402597451) success（Node/Python/SQLite/Vue），此前 43402253437/43402422216 的旧 fixture 与 SQL 字段名错误已修复 | 0020/0021/0022 未执行，SSO OFF |

**HomeFlow 关键提交 SHA**：`57ad1798f532fb1dd87cac3046b45c02fb9098b6`（0053）、`f51976caf0e2ea2f23d0778403705055c56f7c18`（断言签发）、`34079ba4367c9b0f16accf318d9591f35d3d33cd`（单次只读验活）、`7471d0966f13fbef428e068d648289469aa32cff`、`4e59b45d901b1a7a2a7ae00ddb36cca06eda8a05`（路由）、`2b908646997ef4b53f01256267b22bdbb15ccf4e`（回归）、`b8b877388639b1a2b3ac19dbca58ea8072b8a037`（旧静态测试修复）。
**文书关键提交 SHA**：`a5f6beca50a01211e2c826a559b49db135d20ade`、`fdeef1f7b4841414180c249ae5b8c858322c356b`（迁移）；`d625dfe55c3e63ddb352c19802b451258016b0c4`、`a3d14cb18ec9cf9f948e1e1e716fb42d3ed4dc7b`、`48804bfc6a052ba69622117adac0a8a6c691bd44`（代码）；`8acb666e2b6803281abdc560dba9842bc788c55d`、`89069d3ee6281fba5e21d9d2f69406c021d4c5c3`、`ae7b7b8a4955b72fe7ce290e866934c7a4cd2357`（SQL fixture/回归修复）；`e255ce0de87bd4f0e31a674f38e87d66d778449e`（安全文档）。
**家計簿关键提交 SHA**：`bd38dfbbf0df1b903cfea85a81a815b3cdf9a900`（身份会话密文表）、`52c0e9049c926d40e5d837eea8044fd0e352b19d`（验活）、`7f386e16586d17a12ee2ad1617a9519e05065b18`（测试）。

**还未完成 / 无法宣称全系统完成**：知学尚未接入 HomeFlow 统一登录或用户级权限隔离；家計簿虽有独立身份会话但没有开放共享账本/资产读、更没有个人金融归属的稳定账户 ID 与审批前置；HomeFlow Draft #306 已有审批请求、决定与审计但不执行真实账务；文书助手共享写权限和跨 App 审批候选仍待开发；三 App 真 iPhone PWA 双人登录、注销、切号缓存隔离仍未验收；Cloudflare 正式资源没有启用本轮功能。下一步按 A→F，**A 备份由用户操作之前只继续离线开发**，B 知学身份及三个 App 受控真实登录，C 个人金融，D 事务审批，E 私人隔离，F 真机验收。严格不得重建 Preview、重复执行迁移或自行清理旧凭证/历史。


## 6.4 2026-11-13 知学 Stage B 增量：身份数据库草案（Draft，不具备登录能力）

用户将自行在有电脑时完成四个生产 D1 和 R2 的加密持久备份及隔离恢复；在完成之前，**继续代码/测试但禁止生产迁移和功能 PR 合并部署**。

针对知学 `PTamako/it-study-platform` 当前 main `ae8c0dea3468006d0fbbfaaf953afbf3f4f645da`，新建 [Draft PR #179](https://github.com/PTamako/it-study-platform/pull/179)，分支 `feature/homeflow-identity-isolated-20261113`。**仅数据库 schema 和测试**：
- `9e45d80a68715063243d79b3a7af18bec4407c4e`、`0824a85a799dc1e191433602c9d327f6c988e793`：**尚未执行** `migrations/0180_homeflow_identity_isolation.sql`，独立 HomeFlow owner/member/user_id、家庭归属/昵称状态，唯一 owner 与不可变归属，独立的 pending/state、加密会话、actor 审计表；0180 不依赖 0177，特意避开知学其他 Chat 未合并题库 [Draft #178](https://github.com/PTamako/it-study-platform/pull/178) 的 `0177_fe_exemption_20200614_systems.sql`。未来迁移时先检查 0177-0179 实际执行情况，绝不凭序号猜测。
- `a555cc1d9453759b678596cf3d145f57041ef5e3`：新 `scripts/homeflow-identity-foundation.test.mjs`，以真实 SQLite 验证旧生词本内容不变、身份不可重绑/双 owner 冲突、审计 actor 必须有真实 FK、迁移幂等。
- `2e72d1e8485f478360e11c152f8e8d1067a1bfb5`：新 `docs/homeflow-identity-phase-b.md` 明确尚无 SSO 端点/UI、不能给 member 开放旧个人学习接口、生产备份阻断门槛。

知学 [Validate pull request #43404224889](https://github.com/PTamako/it-study-platform/actions/runs/43404224889) **截至本次记录仍 in_progress**：第 30 步已完成，正在运行离线语言句库迁移生成的耗时步骤；后续必须查最终 CI 结论，如失败修复本分支，不要把运行中视为通过。未读取/改写私人学习行或题库资料；实际只读检查生产 D1 schema，确认 `saved_vocabulary_entries_v2(language,term)`、`daily_task_completions(task_id,study_date)`、`language_card_progress(card_id)`、`language_card_reviews(card_id)`、`question_review_state(question_id)`、`daily_word_reviews(word_key)` 等当前主键**均无 user_id**，另 `study_attempts/scenario_attempts/exam_history/mock_exam_submissions` 也无 owner 字段。**阶段 E 必须重建相容的个人复合键、保留公用题库、旧历史安全归属 owner、member 新空间空白，并批量改造所有个人 SQL 与 PWA 本地缓存**，仅建立身份链接不允许第二位成员看到学习内容。

**知学阶段 B CI 后续修复**：首次 [Validate #43404224889](https://github.com/PTamako/it-study-platform/actions/runs/43404224889) 已结束 **failure（463 pass / 1 fail）**：失败仅在新 `homeflow-identity-foundation.test.mjs` 中将实际列 `assertion_scope` 错写成 `proof_scope`；迁移 SQL 并无对应错误。已以 commit `c6494d4dff397b88b7704074517dd0ca6c6d90ab` 修正断言；第二次 [Validate #43404725255](https://github.com/PTamako/it-study-platform/actions/runs/43404725255) 在本次记录时 **in_progress**，正在重新生成离线句库。**切勿把 in_progress 写为 success；下次恢复必须核对最终 run/jobs 并处理失败**。Draft [#179](https://github.com/PTamako/it-study-platform/pull/179) 未合并，0180 未执行，其他用户个人学习权限仍未开放。

当前真实状态：A 备份未完成；B HomeFlow OAuth+会话验活 Draft #305、家計簿身份 Draft #309、文书身份/验活 Draft #97；知学只有这份 Draft #179 schema/test，**没有可用 SSO 登录**。C 家計簿个人账户/审批前置未完成；D HomeFlow 审批 Draft #306 只是批准意图、不写真实账本；E 跨 App 私人隔离未完成；F 双人 iPhone PWA 验收未开始。本轮仍无生产迁移/部署及 Preview 重建。继续时先复查 HomeFlow main 本文件与四仓库最新 PR、CI、Cloudflare 正式状态，避免重复开发或执行旧迁移。


## 6.5 2026-11-13 本轮继续开发：C/D 金融隔离/安全预备、文书共享写权限、知学独立身份 API（最新检查点，优先于 §6.1–6.4）

**用户当前授权边界不变**：在电脑上自行完成**四个生产 D1 和 R2 的持久加密全量备份与隔离恢复测试**。本轮仅允许功能 Draft 分支的离线开发、测试和文档合并，绝不合并功能 PR、执行生产 SQL、部署新 Worker、启用 OAuth/审批/家庭金融开关、创建 Preview 或修改正式业务数据。本轮无服务间生产授权/密钥配置、无 D1 或 R2 线上写入。所有改动源自 Drive 设计书 v1.1（资源 ID `1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY`）。

### 本轮功能保存位置、验证与剩余

| A～F | 仓库 / Draft 分支 | 已提交实物与实际结果 | 尚未完成 / 禁止误判 |
|---|---|---|---|
| B | [知学 #179](https://github.com/PTamako/it-study-platform/pull/179) `feature/homeflow-identity-isolated-20261113` | 在此前**未执行** 0180 身份表基础上，真实新增 `worker/homeflow-identity.ts`、`worker/index.ts` 的 `/api/homeflow-sso/status/start/callback/complete/me/logout` **独立身份路由**。PKCE S256、Safari 仅密文暂存 code、原 PWA 续接 proof、首次 owner 必须在开始和完成分别持有真实旧 12h 签名 Cookie，member 必须等 owner 先绑定；HomeFlow source-session 逐请求验活、错户/换角色拒绝。所有返回 `study_access:false`，**新 SSO 不被旧学习私有 API 认可**；新 `scripts/homeflow-sso-isolated.test.mjs` 内存 SQLite 双人证明。仅测试用 `inline-chinese-dictionary.mjs` 处理 data URL 的旧 Worker 模块加载。最新 commit `9e8297741b8da8961b949094d8d255c7d992b82b`，完整 [CI #43410533667](https://github.com/PTamako/it-study-platform/actions/runs/43410533667) **success（全套回归、TypeScript/Vue 编译、D1 本地迁移验证、Worker dry-run）**；此前 data-URL import 问题已修复。原单纯数据库身份 schema 的前一次 [#43404725255](https://github.com/PTamako/it-study-platform/actions/runs/43404725255) 已 success。 | `0180` 未执行，开关 OFF，没有可用 PWA 统一登录；**尚未迁移**生词本/错题/语言进度/考试等所有现有无 user_id 私人主键和 SQL，也未隔离前端缓存。新 identity-only 端点的 code + 构建已通过 CI，但仍需 iPhone 双账号 PWA 实机；不得称知学双账号已可用。 |
| C | [家計簿 #309](https://github.com/PTamako/kakebo_jp/pull/309) `feature/homeflow-sso-isolated-foundation-20261113` | 新**未执行** `0023_family_financial_account_identities.sql` 为真实 HomeFlow user_id + 稳定 account_id 的个人金融账户表，允许夫妻同名卡，个人设置归自己，owner 可管理家人；禁止旧账户猜测归属。全新**默认 OFF** `/api/family-finance/accounts` / `legacy/adopt` 后端，真实 old-owner 双证、显式确认后只**复制**旧支付手段至同 owner 稳定映射，旧数据不改；`shared/entries` 和 `shared/ledger-totals` 两人相同家庭月度简计/分页明细。成员绝不使用新 SSO Cookie 进入旧 `/api/entries` 写账；双人 SQL 回归通过。 | 目前只是 **新账户独立管理与家庭账本的只读 API**；仍未将旧 `payment_sources.name` PK 及卡账单、SBI、定投、储值、固定费、余额、完整统计页面全部迁为 per-user stable ID，旧个人设置修改仍 409，前端还没实现；不是完整 C。 |
| D | [家計簿 #309](https://github.com/PTamako/kakebo_jp/pull/309) | 新**未执行** `0024_family_finance_pending_actions.sql` 和 `functions/api/family-finance/pending.js`：经过 HomeFlow member 身份验证，只有本人 `member_created` 未归档账号可以提交独立**加密财务草稿**，用独立待配置 `KAKEIBO_FAMILY_PENDING_KEY` 的 AES-GCM 保存 private payload，严格白名单 expense/income/日期/金额/商家/类别、14 天限期，按真实 actor+幂等键避免重复，取消仅请求人，审计不可变。不允许转移/SBI 非专用事项，**没有任何正式 entries 写入**；严格响应 `prepared_not_submitted,homeflow_approval_id:null,ledger_changed:false`。[最新 Validate #43410411032](https://github.com/PTamako/kakebo_jp/actions/runs/43410411032) success（含 0022/0023/0024 真实 SQLite、老账不变、同名独立卡、加密、重试/取消）。当前 HEAD `722ac91a3f61c988297403d0cba87aa4d5e9fa8b`。 | **草稿没有向 HomeFlow 提交申请，owner 没收到审批，也未入账**。HomeFlow [Draft #306](https://github.com/PTamako/homeflow/pull/306) 当前只含审批申请/审核，不执行目标账本事务。需要 service-bound 客户端 Actor 授权/提交/核对 hash、管理员 decision、目标 idempotent apply 与状态 `executing→applied`，错误恢复先查远端。不要将 prepared、approved、applied 混为一谈。 |
| E | [文书助手 #97](https://github.com/PTamako/jp-document-assistant/pull/97) `feature/homeflow-identity-link-safety-20261113` | 完成共享文书的元信息编辑（非原 owner 不改 `visibility`，不可擅自转敏感类别）、字段核验、软删除/恢复、共享附件软删除/恢复/排序；写操作验证同户且 document.visibility=shared、版本 CAS、D1 原子追加真实 `actor_user_id` 审计，撤销共享后立即不可访问。附件物理永久删除**仍归原 owner** 以保护私有 R2 对象属主；测试保证双人不泄漏私人文书、不误删 R2。基本 [#43406353483](https://github.com/PTamako/jp-document-assistant/actions/runs/43406353483) success；共享附件 [#43408316526](https://github.com/PTamako/jp-document-assistant/actions/runs/43408316526) success。当前 HEAD `e0bb5f7bfdbb7e9dbae747192be87ff97656076a`（含独立阶段说明文档）；该 HEAD 的 [#43410618095](https://github.com/PTamako/jp-document-assistant/actions/runs/43410618095) **success**。 | 文书助手新 0020/21/22 与功能均未生产执行；共享原件跨 owner 的永久删除与新增附件、审批关联跨 App 动作、双人 PWA 仍待完成。按业务真实 user ID 做全链路关联仍未闭环。 |
| F | 全部 | Draft 代码与自动化 D1 mock 测试，部分 WebKit 冒烟测试 | 用户尚未完成四 D1/R2 备份与隔离恢复；无生产部署/SQL 迁移、无双人真实 iPhone Safari→PWA 重新认证/账号切换/退出和旧 Cookie 清理验收，不可标记 F 成功。 |

**生产状态汇总**：HomeFlow `0053/0054`、家計簿 `0022/0023/0024`、知学 `0180`、文书助手 `0020/0021/0022` **全部仅 GitHub 提交，未在生产执行**；`OAUTH_ENABLED` / `KAKEIBO_HOMEFLOW_SSO_ENABLED` / `KAKEIBO_FAMILY_FINANCE_ENABLED` / `HOMEFLOW_STUDY_SSO_ENABLED` / `HOMEFLOW_SSO_ENABLED` / `APPROVALS_ENABLED` 均不能视作已启用。新加密待处理凭证仍需独立 Secret，**无需用户现在配置**。禁止自动重建 Preview。

**本轮关键 commit（全部在各自 Draft）**：
- 知学：`30e4a2438787c041cc346aaa45d6c2025e60eeb1`（身份 API）、`de22b9814bc5479c14753417eeed01bbafb01a78`（真实 Worker 路由）、`0ec21afe2ed2ed4ae1fe255894e79a8a9355e474`（双人内存 D1 回归）、`3bb03bc7dea7e175c3258751419ee8c645ffcb37`（测试隔离模块）、`9e8297741b8da8961b949094d8d255c7d992b82b`（真实状态文档）。
- 家計簿：`f78f28d9e83071297e78421896c513dc3a9b164a`（稳定账户表）、`9c634fc339ae1be7379c47fb29c215b71cd079ea`（家庭金融 API）、`a6286313a82566cb9b0442d2498239be8fbb1111`（双人回归）、`0f4b3bb20ec4054ef81f91c7c50b311448cdadf4`（写前独立 GET 身份核验）、`f28bbb7fa40b52e712e2e5a0a39effb455ddf5e8`（审计事件扩展）、`ed0500525ead97d86c3306835c1ca512d69c9b4c`（待审核草稿表）、`d32f2e901192cf06ac4589f5121f98403fc2b6cc`（密文/幂等处理）、`86ebea4139cc194d17a68a4ecbe4026ad77f27ac`（回归）、`722ac91a3f61c988297403d0cba87aa4d5e9fa8b`（阶段文档）。
- 文书助手：`25442f25dceb1bef64df676a78bb480da6c62de2`（初始共享更新）、`37c45e3be3a3fcdafb1bc7b2935ae51644a84fab`（原子审计）、`25d53ea0fbeaee7b8bb74ae209aaaab01dd98292`（真实 member audit 测试）、`87e5560fae003b0ff08b10f2e6f5634382587c28`（共享附件移动与权限）、`4bf7164ae07270d9926968c238337019d494d651`（共享附件排序）、`4d7f733f48db2fdc55a093bb7ab17c4fac323b8f`（双人 R2 不误删回归）、`e0bb5f7bfdbb7e9dbae747192be87ff97656076a`（阶段文档）。

**下一 Chat 恢复优先顺序**：第一步重新读取本文件、Google Drive v1.1、四仓最新 main/功能 PR head 和 CI，已验证知学 [#43410533667](https://github.com/PTamako/it-study-platform/actions/runs/43410533667) 与文书 [#43410618095](https://github.com/PTamako/jp-document-assistant/actions/runs/43410618095) 均 success；下次仍先核对最新 HEAD/CI，不得把后续 in_progress 当通过。第二步在备份门槛仍没完成期间继续 C 的账户主键/统计及个人金融字段 owner_user_id 无损迁移设计，D 家計簿草稿与 HomeFlow Draft #306 安全服务间审批执行器，E 知学全部私有学习 SQL 与 PWA 缓存隔离、文书权限剩余；每项独立 commit、CI、实时更新交接，不能抢跑合并部署。阶段 A 与 F 必须等用户实际操作电脑备份/隔离恢复及 iPhone 实机验收。


## 6.6 2026-11-13 第二轮 Stage C/D 持续开发：资产汇总、固定费/SBI 归属、受信审批提交与只读校验（**最新状态，优先于 6.5**）

**约束与实查**：用户在有电脑后自行完成四生产 D1/R2 持久加密备份、哈希校验及隔离恢复；目前该阶段 A 仍未完成。本次只提交代码、测试、文档到现有 **Draft** 功能分支；未合并任何功能 PR、未执行任何生产迁移、未启用 OAuth/审批/家庭金融/写账开关、未创建 Preview。**下文“通过 CI”不是“已上线”。** 必须再次查看最新 GitHub 分支/PR 状态后继续，不准拿旧交接自动覆盖更新。

### Stage C：家計簿读资产与旧个人金融归属（Draft #309，已完成本轮代码和测试）

- 现有分支 `feature/homeflow-sso-isolated-foundation-20261113`，PR [#309](https://github.com/PTamako/kakebo_jp/pull/309)，本次最后 HEAD **`367965186782363a232c880f0c8b70209f0645e2`**。
- `functions/api/family-finance/assets.js` + 路由：新增默认 OFF 的 `GET /api/family-finance/shared/asset-summary?month=YYYY-MM`。复用现有 `prepaid-assets.js` 的充值/积分/期初余额和 `investment-portfolio.js` 的 SBI 实际持仓估值（不把定投计划当资产），以及 `card-bill-snapshots.js` 的信用卡账单快照。夫妇两人经实时 HomeFlow 来源会话验证后读取同一家庭资产视图，没有“我的/对方/全家”切换。**银行/现金未记录的余额、无报价的持仓不能计成完整资产**；返回 `tracked_assets_complete` 及 `excluded_from_assets`，信用卡账单快照单列而不重复减款。没有任何 D1 写动作。
- **新增且未执行** `migrations/0025_family_financial_resource_owners.sql`：旧 `recurring_plans`（固定费）、`investment_plans`、`investment_plan_history`、`investment_holdings`、`card_bills` 的稳定资源键 + **原管理员 HomeFlow user_id** 的不可变归属 sidecar，不改老表业务行、金额/交易日期、原 actor；成员新资源仍不继承历史。
- `functions/api/family-finance/resource-owners.js` + `POST /api/family-finance/legacy/resource-owners`：只有经过 HomeFlow source-session 验活的管理员可显式 `confirm:true`，对五类现有资源各最多 50 条/批，返回续页 cursor；同一旧 key 幂等，唯一键防跨户冒领，`assigned_by_user_id` 是真实操作者，append-only actor event 原子写入。SQL 触发器禁止把旧资源改归丈夫或删除归属证明；`GET` 只暴露映射数量。未实现对旧配置的个人改写 API，避免破坏历史。
- 验证覆盖双人资产同值、未估价不伪造总资产、无资金更动、旧资源逐类哈希/行等价、重复 50 条分页和权限不可篡改；[家計簿 Validate #43421249522](https://github.com/PTamako/kakebo_jp/actions/runs/43421249522) **success**。当前 Head 还包含 Stage D（见下）。

### Stage D：真正提交“待审批” + 审批真实性证明（**已提交申请，仍未执行账本**）

**HomeFlow Draft #306**：分支 `feature/family-approval-state-machine-20261113`，base 是 HomeFlow OAuth [Draft #305](https://github.com/PTamako/homeflow/pull/305)（不可跳过 0053）。当前 HEAD **`06564a82d86ee42b0cbc8951d9fa62d94cca205f`**；[HomeFlow Validate #43424209401](https://github.com/PTamako/homeflow/actions/runs/43424209401) **success**。
- 新 `worker/approval-submission.js`：只受信 Kakeibo 服务器、仅 POST `/api/internal/approvals/submit`，要求生产 + `APPROVALS_ENABLED` + 新 `APPROVAL_SUBMISSION_ENABLED` + 独立 32-byte hex `APPROVAL_VERIFICATION_SECRET`，当前均 OFF。HMAC 输入 `kakeibo\n{millisecond_timestamp}\n{raw_json}`，±5 分钟，客户端不能携带 Cookie/Origin 或指定操作、SQL、金额、目标 URL。内部固定请求类型 `finance.entry.create`、target `kakebo`、`resource_id` 为家計簿 pending id、`idempotency_key='kakeibo:finance:'+resource_id`；继续使用 HomeFlow 0054 原审批核心的真实 member 身份/D1 不可变申请和审计，重复网络请求收敛到原审批 ID。再直接核对保存的 DB 原 sha/actor/household，不能仅信公共 Response。
- 新 `worker/approval-verification.js`：`POST /api/internal/approvals/verify` 受 **独立 `APPROVAL_VERIFICATION_ENABLED` 默认 OFF** + 同一受控服务密钥保护，只读校验特定的 `request_id/resource_id/household_id/requester_user_id/payload_sha256/idempotency_key/expected_version` 是否严格等于 HomeFlow 原审批单，且状态真实 `approved`，当前 member 和审核 owner 都仍有效、未过期。拒绝 pending/rejected/cancelled、签名错误、跨户、失效身份。只返回 `verified:true,applied:false`，不改变审批或目标账。
- `worker/index.js` 在浏览器 Cookie/same-origin 授权逻辑前将这两个**固定后端内部路径**路由至各自严格签名校验；其余用户 API 授权规则保持不变。全部依赖仍未迁移的 0053/0054，签名 Secret **未配置**。
- CI 曾发现一项现有 1ms 到期测试与毫秒时钟竞争（偶现 `200` vs `409`），只在测试加 15ms 稳定等待，业务逻辑不改；最新 [Validate #43424209401](https://github.com/PTamako/homeflow/actions/runs/43424209401) success。

**家計簿 Draft #309**：与 HomeFlow 严格相同的 HMAC 契约，调用已有 `HOMEFLOW_IDENTITY_SERVICE` Service Binding，不允许浏览器直接构造“已批准”。
- **未执行** `0024_family_finance_pending_actions.sql` 向前兼容地从 `prepared/cancelled` 扩展 `prepared→submitted`，只允许写一次 `homeflow_approval_id` 和 `submitted_at`，保留旧草稿 AES-GCM 私有载荷、禁止重新指定原 owner 或更换 digest。原始旧 `entries` 没有更改。
- `functions/api/family-finance/approval-submit.js` + `POST /api/family-finance/proposals/{id}/submit`，要求实时 HomeFlow member source-session、该成员本人的未归档 stable account、显式 `KAKEIBO_APPROVAL_SUBMISSION_ENABLED`（OFF）、`APP_ENV=production`、`KAKEIBO_APPROVAL_VERIFICATION_SECRET`（未配置）。只发送四个最小字段（household、member、private pending id、SHA256 digest），**不发送消费金额、商家、文件原文或 AES 密文**。收到 HomeFlow 原申请 ID 后以 D1 原子事务保存 `state=submitted` 和 `finance_entry_submitted` 真实 actor 审计。
- 断网补偿：HomeFlow 可能已提交、但家計簿没收到回执，保留 prepared 和 `safe_to_retry`；下一次发送相同 `kakeibo:finance:{pending_id}` 幂等键并取得原 ID，再写本地回执；之后的本地重复提交不请求 HomeFlow。提交后不能调用本地 `cancel` 假称远端已取消，需 HomeFlow 真审批中心后续管理。
- `functions/api/family-finance/approval-proof.js` + `POST /proposals/{id}/approval-proof` 只对数据库**已有 submitted 回执且传入 HomeFlow request ID 一致**的本人草稿通过另一个 opt-in 开关去 HomeFlow 验证真实 approved；返回明确 `approved_not_applied`、`applied:false,ledger_changed:false`，对错摘要、错误 receipt、源会话失效拒绝。
- [家計簿 Validate #43424086084](https://github.com/PTamako/kakebo_jp/actions/runs/43424086084) **success**（本轮最终代码/文档 Head），此前 [#43423823312](https://github.com/PTamako/kakebo_jp/actions/runs/43423823312) **success** 专门覆盖 HomeFlow 提交后网络断连、同一 ID 恢复、只一条 actor 事件及前后家庭账本未改。移动 WebKit CI 与真机双人 E2E 不是同一个验证，必要时检查最新 GitHub Run 的结论。

**现在确切能做的事**：源成员可以（**仅在备份后配置新功能开关并上线时**）保存私人加密草稿、通过后端在 HomeFlow 产生一张 `pending` 审批单、本人和管理员在 HomeFlow 核实其审核状态；owner 批准后家計簿服务端可以只读核实真正批准。

**绝不能宣称已完成**：owner 批准后 **还不会**自动在家計簿正式 `entries` 入账，也未实现审核状态 `executing→applied`、签名目标执行器/服务间结果回报、卡账单/积分/SBI 的幂等财务变更和失败恢复、批准通知/拒绝/取消与 PWA 家庭审批中心 UI。旧卡/储值/SBI/固定费全量个人管理及资产完整统计页面也尚未迁移；知学 E 阶段私人进度/端侧缓存、文书附件跨所有者清理、F 双人真机联调仍待开发。

### 本轮准确提交与恢复线索

- 家計簿：`260c1e165ce3fa98c8aeb58f611b1666ab209769`（家庭资产 GET）、`2623345c9396a369675aa458610fb283bffa1c93`（0025 归属 schema）、`844e2b40f0745ff8513c6493e819e3c5659b8a21`（旧资源映射）、`1145d7a27110437e64603e8aa56461e1f612d053`（归属回归）、`9d12e52e5c53f6eef0ac060f645cf5c973368494`（只读审批证明）、`1ae9d5aa1f74e90941bb8a5ed418c10fcba19d37`（submitted 单向回执）、`9ea512e317e04a9980892a2365cbb6c0121044c3`（签名提交）、`19b6b21000f236eca8522c6266e01687dc49238c`（API 路由）、`7123fc33c12f54b658811d318d5540468255a9c5`（必须持有审批回执才能核验）、`0e734c62895466f533e12b8a988fc95a645cc64c`（丢回执补偿测试）、`367965186782363a232c880f0c8b70209f0645e2`（最终文档）。
- HomeFlow：`b7e9ecbc0274ef82277e299ee544e1787a9942f2`（已批准证明模块）、`ce14c50f5ebe329a321d8034fb6160c10eab8de7`（验证路由）、`c02df9a054b3f8d24fc0c83f66f35915612db73c`（签名提交模块）、`1b05453f906d9d64004bcaf089f07d44585c5b95`（校对不可变 DB 原文 digest）、`0aa74316ae6f29706c25de6eb0d55f59ac3061fc`（提交路由）、`1735f872a3f959546930d66176f5f7ce2c889d59`（双回归）、`06564a82d86ee42b0cbc8951d9fa62d94cca205f`（时钟测试修复）、最终代码/文档 HEAD `06564a82d86ee42b0cbc8951d9fa62d94cca205f` 需下次以最新 PR 头复查（此处文档提交实际还可能在后）。
- [家計簿 Stage C/D 说明](https://github.com/PTamako/kakebo_jp/blob/feature/homeflow-sso-isolated-foundation-20261113/docs/family-finance-stage-c-d.md)、[HomeFlow 受信审批契约](https://github.com/PTamako/homeflow/blob/feature/family-approval-state-machine-20261113/docs/household-approval-contract.md) 是实际功能口径，早期本交接 §6.1～§6.5 的“没有审批提交”仅为旧状态，本 §6.6 覆盖。

**生产阻断项不变**：HomeFlow `0053/0054`、家計簿 `0022/0023/0024/0025`、知学 `0180`、文书助手 `0020/0021/0022` 本轮仍**未在正式 D1 执行**；代码均未生产合并部署。用户电脑完成四 D1/R2 加密可验证备份与隔离恢复前，禁止启用 `OAUTH_ENABLED`、`APPROVALS_ENABLED`、`APPROVAL_SUBMISSION_ENABLED`、`APPROVAL_VERIFICATION_ENABLED`、`KAKEIBO_HOMEFLOW_SSO_ENABLED`、`KAKEIBO_FAMILY_FINANCE_ENABLED`、`KAKEIBO_APPROVAL_SUBMISSION_ENABLED`、`KAKEIBO_APPROVAL_PROOF_ENABLED`、知学与文书 SSO。共享 HMAC Secret 只能存 Cloudflare Secret，不能提交 GitHub/Drive/聊天。后续先做**可信 target approved-action execute + 幂等恢复、结果回传**，才可称 Stage D 完整。绝不重建 Preview。

## 7. 安全声明

本文件不包含密码、原始 Token、API Key、OAuth Secret、完整个人文书、银行账户号码、HomeFlow 会话或数据库导出签名 URL。重要的“用户已明确的历史归属”在项目层面已足够，不需要在公开仓库写入个人身份资料。首次统一身份验证必须**由真实 HomeFlow 已认证会话确认 owner_user_id**，不可从昵称猜测或生成一个伪 owner ID。


## 8. 2026-11-13 阶段 A 再核查：跨连接传输受限（未完成）

> **状态：A 仍为进行中／阻断；本次没有完成任何生产数据备份、加密文件持久保存或隔离恢复，绝不放行迁移。** 本节是独立于 §1.4 较早调查快照的本轮增量核查，不覆盖前人记录。

### 本轮实际执行（生产只读）

- 已先读取本交接文件并复用既有 2026-11-13-A阶段 私人 Drive 目录，不重建目录、不重复创建已 complete 的 D1 导出任务。
- Google Drive 文件夹元数据实查 `shared=false`、仅 `user:owner` 权限；文件夹直接子项 **仅有 1 个 `backup-preflight-status.json`（3149 bytes）**。它是 `NOT_A_RESTORABLE_BACKUP` 元数据，不是任何 D1 SQL/R2 副本。目录中没有发现实际生产加密备份文件。
- Cloudflare 实查四个生产 D1 仍在：`homeflow`（文件大小 1,064,960 bytes）、`kakebo`（385,024 bytes）、`it-study-platform`（31,793,152 bytes）、`jp-document-assistant`（483,328 bytes）；三个 R2 Bucket 均存在。数据库文件大小是 API 元数据，**不代表已取得可恢复备份**。
- D1 只读 `SELECT COUNT(*)`：HomeFlow `users=2, tasks=9, household_members=2`；家計簿 `entries=296, payment_sources=11, investment_plans=4`；知学 `language_cards=16170, questions=2099, saved_vocabulary_entries_v2=8`；文书助手 `documents=0, attachments=0, users=1`。本轮 D1 查询元数据均报告 `changed_db=false, rows_written=0`。相较较早 §1.3 的 `tasks=10/documents=2`，当前为 9/0；这只是两个不同时间点的只读快照，原因未查明，不得因此断言数据损坏。未来实际备份/恢复比对需采用同一时间点的快照。
- R2 实时 LIST 再核：`homeflow-family-media` **3 对象 / 772872 bytes**；`kakeibo-receipts` **3 对象 / 440351 bytes**；`jp-document-assistant-private` **0 对象 / 0 bytes**；与之前清单的对象数/总大小一致。本轮仅 LIST，没有下载、上传、修改、删除任何 R2 对象。

### 备份与恢复验收清单

| 项目 | 实际本轮结果 | 阻碍与下一步 |
|---|---|---|
| HomeFlow / 家計簿 / 知学 / 文书助手 D1 | **未取得 SQL 文件，未加密，未上传，未恢复** | 既有 API export `complete` 不等于 SQL 已下载并持久保存；需受控跨系统文件传输环境处理原始字节 |
| HomeFlow / 家計簿 R2 六个对象 | **只读列出，无可恢复副本** | 应逐对象获取完整字节，加密备份、SHA-256、隔离恢复与源对象一致性检查 |
| 文书助手 R2 空桶 | **本轮确认 0 对象** | 保存有时间戳/来源的空桶快照及恢复后 0 对象证据即可；不能把空桶清点误记为其他两桶备份完成 |
| Google Drive 私人目录 | **目录及访问控制通过；实际备份文件不存在** | 仅含 preflight 状态文件，未有 SQL/R2 数据包、manifest、校验后恢复报告 |
| 隔离恢复 / 数据完整性 | **未执行 / 未验证** | 需从 Drive 下载密文、校验密文哈希、解密到隔离 SQLite/测试目录、执行 `integrity_check`、全表计数/业务摘要；R2 逐对象字节哈希和对象数一致 |

### 本轮传输阻断的实际技术原因

当前 Chat 可以使用 Cloudflare、Google Drive、GitHub 连接器，但**没有可调用的 ChatGPT Work 云端计算机/交互浏览器**。Cloudflare 连接器只能通过自身 `cloudflare.request` 调 Cloudflare API；D1 Export API 产生的是短时签名 SQL 下载地址，无法把这个 URL 直接当成 Google Drive `upload_file` 所需的 `file_uri`。Google Drive `upload_file` 仅接收已有的 connector 文件引用，不接受任意临时 URL/base64。当前执行容器实测解析 `api.cloudflare.com`、`google.com` 和 `github.com` 均失败（DNS Temporary failure in name resolution），无可靠途径直接下载 SQL / R2 二进制到工作文件系统。**未尝试以编造 file_uri 或上传元数据文件代替实际备份。**

下次请在**实际具备文件系统、浏览器/外网访问、Cloudflare 只读导出权限、Google Drive 私有目录写入权限**的同一安全环境中执行，不要再重复无意义的 API export polling。建议在该环境内临时取得新的正式 D1 export 文件后立即下载；保管加密密钥于 Drive 与 GitHub 之外；加密实际 SQL 和 R2 完整对象；上传到既有私人目录并从该目录取回全量密文进行校验及隔离恢复；生成**不含秘密、明文记录/签名 URL**的摘要验收报告，再据实将 A 改为完成。严格不得创建 Preview、执行正式迁移、覆盖生产 DB 或删除原 R2 对象。

**安全结论**：本轮 GitHub 只追加文档记录；未改动生产数据、Cloudflare 正式 Worker/Pages/数据库、任何功能开关；不含密码、Token、密钥、SQL 内容、R2 私有对象键或备份签名下载链接。

## 9. 2026-11-13 用户最新开发授权：A 由用户负责，B～E 继续（优先于历史文字）

- A 的唯一状态为 **待用户完成**；用户自行安排生产 D1/R2 的持久加密备份与隔离恢复。当前和后继 Chat 不得再次尝试 A，也无需重复询问用户；仅在用户主动报告成功后解除生产门槛。
- B～E 继续独立功能的 Draft 代码、数据库迁移 SQL 文件、前后端 UI、回归测试与 CI。每完成一个模块都更新此文件、Commit SHA、PR、准确的 CI 状态、剩余任务、部署状态；不得重复开发。
- 不能生产执行新 SQL、不能启用统一身份/审批开关、不能合并会自动生产部署的 PR；绝对不修改/覆盖正式业务数据，不重建 Preview。
- 本检查点基线（读自实际 GitHub）：HomeFlow Draft #305 b8b877388639b1a2b3ac19dbca58ea8072b8a037；HomeFlow Draft #306 3e08197422efbe96419004cfe1fe6f26ce99f515（CI 43428049072 success）；家計簿 Draft #309 baab1adbad163f0ad6fa377827f0f60de0d1c443（Validate 43427933666 success）；知学 Draft #179 9e8297741b8da8961b949094d8d255c7d992b82b；文书 Draft #97 e0bb5f7bfdbb7e9dbae747192be87ff97656076a。下次按最新 HEAD/CI 重新核查。
- 本轮已存在但未执行的 HomeFlow 0055 和家計簿 0026 是受限现金目标执行器所需迁移；不可据文件存在推断生产已执行。信用卡、储值卡、SBI、固定费与文书写入执行尚未覆盖。
- 交接文档也只走 Docs-only PR，因为 HomeFlow main push 会触发 deploy；用户 A 未完成之前**不可合并触发自动生产部署**。
