# 四应用统一账号与家庭审批系统 — 持续开发交接（生产安全优先）

> **唯一交接文件**：`PTamako/homeflow/docs/four-app-development-handoff.md`  
> **冻结需求源**：[Google Drive 设计书 v1.1（2026-11-13，含新增 §3.1）](https://docs.google.com/document/d/1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY/)  
> **本次检查时点**：2026-11-13（JST；Google Drive 最新核对 16:07 JST）。  
> **重要：本文件的事实只代表检查时点；继续开发前确认 main/PR/生产资源是否发生变化。绝不从旧检查结果推断已经上线。**

> **2026-11-14 最新阶段 A 验收更新**：用户已完成四个生产 D1 的持久加密备份、Mac 本地 SQLite 隔离恢复、六个 R2 对象原始 Key/内容 SHA-256 比对、最终加密包解密一致性及私人 Google Drive 回下载逐字节核对。**仅本地备份和恢复验证通过；不等于生产 SQL 迁移/Cloudflare 回滚演练已获放行。** 以本文最新 **§10** 与 **§3** 为准；此前 2026-11-13「A 待用户完成」「尚未保存可恢复副本」属于历史检查点，不再代表当前备份状态。文书助手旧基线 `documents=2` 与此次生产及快照 `documents=0` 的差异，用户已于 2026-11-14 明确确认系本人主动删除，数量差异已解释，非备份遗漏证据。

## 0. 恢复工作的强制规则

1. 先阅读本文件及设计书最新全文（尤其 **§3.1 首次安装/登录**），然后比对各仓库最新 main/未合并 PR、迁移记录和正式 Cloudflare 资源；**只补增量，不重复已经完成的步骤**。
2. 四 App 保持独立生产 D1；HomeFlow 是唯一 `user_id/household_id/role/display_name` 身份源，昵称以 `family_profiles.display_name` 为准，昵称永不作为授权外键。
3. **历史归属已冻结**：HomeFlow 的旧记录保留两位成员原来的归属；另外三个 App 的全部已有个人历史/配置归 HomeFlow owner，member 从新的个人数据空间开始。家計簿正式账本和统计始终全家庭共享，不做「我的/他的/全家」统计切换。真实数据库出现与上述规则矛盾的异常时，仅隔离异常记录，不把全部历史数据重新设成待确认。
4. 个人金融设置（信用卡、储值卡、SBI、固定费、账户余额）member 仅管理自己的，owner 可管理全体；member 的正式家账新增/改/删必须先 HomeFlow 审批，**未审批不得写入账本**。私人文书不因 owner 身份向其他人开放；共享文书双方可管理；知学私人进度和句子卡严格按 user_id 隔离。
5. 所有新增写动作必须记录**真实 actor_user_id** 和持久化审计；旧历史 owner 回填不是伪造的历史 actor。敏感读/导出审计；普通 GET 只鉴权，不逐次写 D1 审计。
6. 对生产 D1/R2 的改写之前，先验证**可恢复的备份**、迁移前基准计数/摘要、可回滚方法、测试和回滚开关。不得通过直接跨 D1 绑定绕过应用权限；不得创建 HomeFlow/家計簿/文书助手 Preview；不得删除或覆盖原数据；不在本文件保存登录密码、JWT、API Key、R2/D1 导出带签名 URL。
7. 功能粒度：单独分支 → 代码/迁移/测试 → GitHub commit SHA → PR → CI → 正式部署 → 生产只读验收 → 回填本文件。**一个阶段完成就提交更新本文件，绝不等 A–F 全部完工才写。**
8. **不要将「备份导出 API 曾返回 complete」误认成已保存了可恢复备份**；必须确认备份文件持久保存、可以访问和测试恢复后方能迁移。不要将 GitHub CI success 误认为 Cloudflare 生产已更新，两个系统分别核对。

## 1. 本次已经保存的调查成果（阶段 A：2026-11-13 历史检查点）

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

### 1.4 备份真实状态（2026-11-13 历史检查点，已被 §10 更新）

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

**A 最新验收状态：「已完成加密备份 + 本地 SQLite 恢复验证」（2026-11-14）**。用户本人在 Mac 完成四个生产 D1 SQL 保存/哈希核验、四库离线 SQLite 恢复、R2 六个原始对象内容与 Key 核验、带元数据的加密包解压比对、私人 Google Drive 上传回下载 `cmp` 验证；证据见 §10。**仅代表该时间点的可恢复本地快照，不证明已验证 Cloudflare D1/R2 原位回滚，也未解除生产上线的独立审批门槛。** 文书助手文书数量旧基线 2→当前 0 已由用户确认主动删除，差异结案；允许继续 B～E Draft 代码、测试、UI 和 SQL 文件，禁止仅凭 A 的 PASS 自动执行生产迁移、打开新功能、合并会部署的功能 PR。

| 阶段 | 最新真实状态 | 已完成（Draft / CI） | 未完成与下一步 | 生产状态 |
|---|---|---|---|---|
| **A：生产备份与恢复** | **本地加密备份及隔离 SQLite 恢复验收通过（2026-11-14）；生产回滚未演练** | 4 D1 SQL SHA-256 + 四库 SQLite `integrity_check=ok`、外键异常 0；6 R2 原始 Key/大小/内容哈希比对 + 元数据清单；Keka AES-256 解密比对；私人 Drive 上传回下载逐字节 `cmp` PASS。 | 文书旧数据数量差异已确认属主动删除；生产迁移前重新制作新鲜快照、全表业务基线、迁移/回滚脚本和必要的隔离 Cloudflare 恢复演练；人工批准发布。详见 §10。 | **生产身份/审批写迁移仍未放行；不可自动上线** |
| **B：统一账号与昵称** | **Draft 开发中，未上线** | HomeFlow #305、家計簿 #309、知学 #179、文书 #97：分离身份/PKCE、源会话验证、旧 owner 安全确认、member 不继承私人资料；此前相应 CI 已通过 | PWA/双人首次绑定、昵称显示、账号切换与本地缓存清理、撤销后端到端检查 | HomeFlow 0053、家計簿 0022、知学 0180、文书 0020～0022 未迁移；所有开关 OFF |
| **C：家庭账本与个人金融账户** | **部分 Draft 功能已通过测试** | 家計簿 #309：稳定账户 ID、成员各自设置、历史金融资源不可变归属、夫妻共同账本与月度统计的只读 API、已知储值和证券资产汇总、受限现金入账映射 | 双方同名信用卡/储值卡/SBI/固定费完整私有设置、余额、资产统计全 UI 与历史无损核对 | 0022～0026 未执行、未部署 |
| **D：家庭审批与执行** | **受限现金单笔审批→一次入账 Draft 子链已通过自动 CI；整体未完成** | HomeFlow #306：审批/审计、签名提交及核验、短租约、remote receipt 后 applied；家計簿 #309：加密草稿、幂等提交、丢包恢复、仅现金账户稳定 ID 的原子 entry + 执行日记 + actor 审计。HomeFlow Validate #43428049072 success、家計簿 Validate #43427933666 success（此检查点） | 审批中心 UI/通知、跨服务真实联调、信用卡/储值/SBI/固定费/文书审批执行器、全部失败恢复和双人验收。**批准不等于已入账** | HomeFlow 0054/0055、家計簿 0024/0026 未执行；所有功能 PR Draft、开关 OFF |
| **E：文书共享/知学隔离与跨 App 联动** | **部分 Draft 完成，未上线** | 文书 #97：身份映射、共享文书和附件部分协作、真实 actor 审计/R2 原 owner 保护；知学 #179：独立身份 API，旧个人学习 API 默认不授新会话 | 知学个人进度/生词/考试及离线缓存按 user_id 隔离；文书所有共享路径与跨 App 同步审批/执行、两应用 PWA UI | 知学 0180、文书 0020～0022 未迁移，开关 OFF |
| **F：生产迁移与双人验收/清退旧鉴权** | **未开始，等待 B～E 功能稳定与用户单独授权生产上线** | GitHub CI / 本地 SQLite、部分 WebKit 冒烟并非两台真实 iPhone 验收 | B～E 验收并取得用户明确上线批准后再统一安排正式 SQL、线上部署核验、双人真实 PWA、业务/R2 数据/费用对账及回退；不得提前删除密码/Token | 未部署统一身份，不放行 |

**本节为唯一现行状态口径**：旧 §6、§8 里的导出/备份下一步是历史审计记录，不再构成工作指令。HomeFlow `.github/workflows/deploy.yml` 已在同一 PR 加入 `push.paths-ignore`：`docs/**`、`**/*.md`、`.github/workflows/deploy.yml`。纯文档及此部署策略文件的提交可以合并到 `main` 而不触发 Cloudflare 部署；`.github/workflows/ci.yml` 仍验证 PR 和 `main`。**仅在 CI 成功、PR 变更清单全部匹配忽略规则后合并**；任何非忽略文件混入必须重新审查。

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
- HomeFlow 部署工作流在本 PR 新增纯文档路径排除。**经 CI 和变更清单验证后允许合并只改 `docs/**`、Markdown 与部署工作流本身的 PR**；其他可能触发生产 Worker 部署的 PR 仍不得合并。用户 A 未完成前不开放生产迁移或身份开关。

### 9.1 Stage D HomeFlow 审批中心 UI（2026-11-13，独立功能完成自动 CI，未上线）

- 功能 Draft [HomeFlow #306](https://github.com/PTamako/homeflow/pull/306)，分支 feature/family-approval-state-machine-20261113，最新本轮模块 Commit **ca7a991692a98f51ffcb89860188cf735914f2aa**；[Validate HomeFlow #43429054673](https://github.com/PTamako/homeflow/actions/runs/43429054673) **success**（包含服务端回归与 Vue/TypeScript build）。本次文档由 #314 新增非部署变更的路径防护；仅在校验后合并，且不触发 Cloudflare deploy。
- 新组件 src/components/ApprovalCenter.vue，已挂载到 src/components/ManagePage.vue：管理员/成员按真实已登录 user ID 查看相同家庭内各自有权限的审批记录；状态筛选、每页 5 条、上一页/下一页、手动刷新；管理员申请批准/拒绝需二次确认；批准后的现金单独执行需再次二次确认，明确显示「已批准 · 未入账」与「已生效」不同状态。列表不展示文书原文/消费金额或密钥。
- worker/approvals.js 新增已登录 GET /api/approvals/status 轻量 flag 探测（无 D1 数据读取），默认 APPROVALS_ENABLED OFF 时 Vue 不显示审批模块，不反复轮询；切换用户/离开管理时清空上一个用户列表并撤销异步旧请求写屏；新增 tests/household-approvals.test.mjs 证明默认 OFF、无申请表/审计写入、独立执行开关状态均正确。
- **未完成**：Push/通知深链接、拒绝/取消/过期的自动状态刷新、跨 App 真实 Cloudflare Service Binding 执行联调、所有金融目标的执行器、完整审批状态流转 UX 与真机双人审查；此次只是 Draft 界面和已存在的受限现金执行器，不是生产系统上线。
- **生产维持原状**：HomeFlow 0053/0054/0055、家計簿 0022～0026 仍未执行，所有身份/审批/执行开关 OFF，功能 PR #306 不合并，A=待用户完成且不再由开发助手处理。

## 9.2 HomeFlow GitHub Actions 安全部署规则（2026-11-13）

- `Deploy HomeFlow` 的 `push` 仍只限 `main`，但加入 `paths-ignore`：`docs/**`、`**/*.md` 和 `.github/workflows/deploy.yml`。**只有本次推送涉及的全部文件都在这些忽略路径中，GitHub 才跳过 Deploy 工作流**；其他代码变更仍会触发正常工作流，不可误以为 A 已放行。
- `Validate HomeFlow` 的 `.github/workflows/ci.yml` 保留 `pull_request` 与 `push main`，纯文档改动仍跑验证；手动 `workflow_dispatch` 不受文档路径过滤影响（不是自动上线授权）。
- 此调整用于安全合并 #314 的 A 用户负责状态文档，不能视为 B～E 上线授权；所有功能 Draft 继续保留。合并前核对 GitHub 变更文件清单、CI；合并后检查 `main` 此提交没有运行 `Deploy HomeFlow`。


## 9.3 2026-11-13 本轮接续：审批撤回 UI／昵称及知学 CI 语法修复

> **A=待用户完成**，由用户自行完成四套生产 D1／R2 加密备份与隔离恢复；本轮没有启动备份/恢复、生产迁移、正式部署、Preview 资源或功能开关。B～E 保持现有 Draft PR 开发，绝不把 CI 成功写成已经上线。设计书：Google Drive v1.1（ID `1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY`）。

**本轮真实 GitHub 核查（以重新核对的最新 PR HEAD 为准）**：
- [HomeFlow #305](https://github.com/PTamako/homeflow/pull/305) 仍 Draft，身份代码 HEAD `b8b877388639b1a2b3ac19dbca58ea8072b8a037`，旧 CI 43402025579 success。
- [HomeFlow #306](https://github.com/PTamako/homeflow/pull/306) 仍 Draft，base 为 #305 的功能分支，**本轮新 HEAD `8c5c6848e5829969062c5fa8f3d63a19394777b7`**；[Validate #43433184629](https://github.com/PTamako/homeflow/actions/runs/43433184629) **success**，包括测试、Vue/TypeScript build、Worker dry-run。
- [家計簿 #309](https://github.com/PTamako/kakebo_jp/pull/309) 仍 Draft，HEAD `baab1adbad163f0ad6fa377827f0f60de0d1c443`，[Validate #43427933666](https://github.com/PTamako/kakebo_jp/actions/runs/43427933666) success，WebKit #43427933787 success；0022～0026 仍禁止生产迁移。
- [知学 #179](https://github.com/PTamako/it-study-platform/pull/179) 仍 Draft，最新原提交已包含**0181 HomeFlow 独立生词本**，不能再把它误写为“只有 0180”；最新基础 CI #43430486850 failure（**464 pass / 1 fail**）：`scripts/homeflow-sso-isolated.test.mjs:245` 的字符串含未经转义的英文撇号，导致 SyntaxError，而非迁移或用户数据失败。已在相同分支以 `6a5c8bf954e17b2e99788370ddb739f43e4e218d` 修复字符串；新 [CI #43432554821](https://github.com/PTamako/it-study-platform/actions/runs/43432554821) **本记录时 in_progress，不能宣称成功**。0180/0181 均未生产执行；生词本只是 E 的第一个独立模块，其余私有学习 SQL、PWA 缓存仍不隔离。
- [文书助手 #97](https://github.com/PTamako/jp-document-assistant/pull/97) 仍 Draft，HEAD `e0bb5f7bfdbb7e9dbae747192be87ff97656076a`，[Pre-merge CI #43410618095](https://github.com/PTamako/jp-document-assistant/actions/runs/43410618095) success，0020～0022 未生产执行。
- [HomeFlow #314](https://github.com/PTamako/homeflow/pull/314) **此前已合并**，merge commit `275c5cc773fd1bc1338e51bcd6581ba80ff0d8e9`；未重复处理。现 main `.github/workflows/deploy.yml` 的 push/main `paths-ignore` 包括 `docs/**`、`**/*.md` 和部署工作流文件本身；纯交接 Markdown 可独立提交 main 并不自动部署 Worker；CI 仍保留 pull_request 与 push/main。仍禁止合并任意功能 PR。

**本轮实际新增 HomeFlow Stage D 审批模块（仅 Draft #306）**：
1. `22c332e07668a80e7c9dfa7fc9bad3e2c6847c11`：`src/components/ApprovalCenter.vue` 中普通成员仅可对**本人** `pending` 申请点击「撤回申请」，二次确认，发送已经存在且经服务端同户/本人/状态校验的 `POST /api/approvals/{id}/cancel`；状态变化后重新读取，避免把 approved/applied 误当可撤回。退出页面/切换账号关闭旧确认面板，返回消息不会跨账号写屏。
2. `e4470c90d7734b975b3d9dfc3d3b593cd147c6c8`、`62ff5d15a6903725df4bc28756475c313459a7b9`：通过 App → ManagePage → ApprovalCenter 传入 HomeFlow 家庭档案 `profiles`；审批申请人**优先**显示 `memberUserId` 映射的 `displayName`，不存在才回退登录名。所有权限判断仍用不可变 user_id，不用昵称做关联。
3. `8c5c6848e5829969062c5fa8f3d63a19394777b7`：新增 `tests/approval-center-ui.test.mjs`，覆盖待审批本人撤回入口、确认/端点、切号关单、真实家庭昵称的 props 传递；原后端 `household-approvals.test.mjs` 已覆盖本人取消与 owner 后续批准被拒。CI #43433184629 已通过。**不表示推送通知、审批结果联动或生产 UI 已完成。**

**生产只读核对**：Cloudflare 正式 Worker 列表仍有 `homeflow`（最近修改 2026-11-13 12:25 UTC）、`it-study-platform`（06:58 UTC）、`jp-document-assistant`（05:43 UTC），家計簿还在既有 Pages 项目；没有执行本轮生产写入。GitHub 本轮功能分支均未合并，用户备份门槛仍在。真实生产迁移版本及功能开关未在本轮重新查询 D1/Secret，不把上述列表元数据当作迁移验收。

**接续应做**：先查知学 #43432554821 最终 CI；若失败只修最新真实错误。然后优先完成 E 知学其余个人题目/错题/每日进度的安全复合键和 server-side user_id SQL（旧 owner 数据原样保留）、C 个人金融管理和完整全家统计、D 审批目标真实执行范围/通知与失败恢复、E 文书同步受控申请。所有模块先上既有 Draft 分支，逐提交测试和写本文件，确保未备份前绝无生产 SQL/部署。


## 9.4 2026-11-13 第三轮：跨 PWA 身份入口与安全隔离 UI

> **唯一权威交接记录：阶段 A=待用户完成**。用户本人负责未来四 D1／三 R2 的完整加密备份、校验与隔离恢复；此轮不尝试 A，不执行生产 D1 迁移、不启用任何身份/财务/审批新开关、不合并功能 Draft、不修改生产 Workers/Pages、绝不重建 Preview。功能完成、自动 CI 成功、PR 合并、正式迁移、部署和真实双人验收**分别记录**，不互相替代。本节最新进度覆盖 §9.3 旧的“研究/待 CI”描述。

### B/E：知学独立 PWA SSO 入口、旧生词无损迁移保护

仍在 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 的原分支 `feature/homeflow-identity-isolated-20261113`，当前最新提交 **`eac76edd3bf9b2ce88f033eb4b3f5cea787c1d20`**（需下次恢复时核对 HEAD），[Validate #43434918211](https://github.com/PTamako/it-study-platform/actions/runs/43434918211) **success**；此前 CI #43432554821 也已 success，语法错误修复 `6a5c8bf954e17b2e99788370ddb739f43e4e218d`。

1. `d42b31e0b560eac715058985aa5fcbc05a6c582b`：`worker/homeflow-vocabulary.ts` owner 旧生词 adoption 查询现在检查同一页每条旧 `entry_json` 的 `json_valid`，任何坏行先返回 `409 LEGACY_CONTENT_REVIEW_REQUIRED`，**整批无写入、游标不前进**；不能因 INSERT 时 `json_valid` 过滤而悄悄跳过历史数据。保留旧表完整，禁止静默清洗生产历史。
2. `62ceb03f96163356b2a6220c57180481a745e92d`：在 `scripts/homeflow-sso-isolated.test.mjs` 加损坏旧词案例：一批同时含正确/坏 JSON -> 409、0 新记录、0 审计、原表字节等价；本地 fixture 明确修复后同一游标再次导入两条。**这只是自动测试，本轮没有真实 D1 迁移**。
3. `5e0c28af3d05cf52075c9e6c9b9588e441c39d5c`：新 `src/StudyHomeFlowAccess.vue`，只在 SSO 服务 status 开关打开时展示；发起 HomeFlow Authorization Code + PKCE，iPhone Safari callback 仍仅 park code，安装 PWA 用**五分钟一次性 state/resume proof**再次调原 PWA 的 `/api/homeflow-sso/complete`，会话由本 App HttpOnly cookie 管理；端侧不存 HomeFlow access token、旧密码或私密 OAuth code。展示绑定的真实 HomeFlow 昵称和角色、独立退出入口，但 `study_access:false`，**不能把 SSO identity 当成旧 `__Host-study_session`，member 不能读 owner 旧学习 API**。旧 owner 首次绑定需有效旧学习登录；member 旧知识空间仍禁止直接进入。
4. `6cf12ad595f825372f91e1a907bcf268aabfd113`：在现有旧登录页及旧 owner 登录后的首页分别放上述**默认关闭**入口，原有学习路由/题库/缓存不受影响。 `eac76edd3bf9b2ce88f033eb4b3f5cea787c1d20` 新 `scripts/homeflow-pwa-ui.test.mjs` 检验开启门槛、禁止旧 API 提权、一次性短凭证、Safari→PWA、清理/登出。
5. 尚未完成：知学全量考试历史、错题、学习进度、每日复习、词句卡片的每用户 SQL/身份隔离、所有旧学习 localStorage/IndexedDB 账号分区、服务端/客户端真正使用新个人 API、双人实机授权/切换与数据对账。本 UI **仅完成安全授权路径，不等于双人知学上线**。

### C/B：家計簿独立家庭账户 UI 与首次安装恢复入口

继续原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，分支 `feature/homeflow-sso-isolated-foundation-20261113`，此轮 HEAD **`a38119ec8be9fd3c3c2ed7adcdc6b66477ca876d`**；首批 [Validate #43435989719](https://github.com/PTamako/kakebo_jp/actions/runs/43435989719) **success** 与 [Mobile WebKit #43435989729](https://github.com/PTamako/kakebo_jp/actions/runs/43435989729) **success**。最终修复入口后的 [Validate #43436551448](https://github.com/PTamako/kakebo_jp/actions/runs/43436551448) **success**；[WebKit #43436551487](https://github.com/PTamako/kakebo_jp/actions/runs/43436551487) **success**（此后再次查询了 GitHub Actions，最新修复分支的 Validate 与 WebKit 均已成功）。

1. `c706142af012421ddac73e476ba89316fb052c98` 新 `src/FamilyFinanceAccess.vue`：**独立于旧访问码/旧单人账本**的 HomeFlow SSO 入口，Safari park callback → 安装 PWA 5 分钟一次性 resume proof → 本 App HttpOnly 身份 cookie，端侧不存 bearer token；调用后端 `/api/homeflow-sso/status` + `/api/family-finance/status`，未通过显式开关时不展示家庭财务。通过 source-session 服务端真实身份验证后，显示个人 HomeFlow 昵称、成员身份、双方一致的家庭月收入/支出摘要；`GET /accounts` 家庭账户列表，`POST /accounts` 新建**本人独立**账户，`PATCH /accounts/{id}` 以版本 CAS 改名/归档，只有 owner 或本人账户显示编辑入口，后端仍以用户 ID/家庭 ID 复核并写审计。历史 `origin=legacy` 账户**只读**，未完成旧账键映射前不绕过限制；本界面无直接新增、修改或删除正式 `entries` 功能。
2. `12eac82cc0a7fc79064b09953acc77d449aac985`：将独立入口挂载于家計簿退出旧访问码页和原管理页，原有旧页、统计和卡设置不改动。 `e1155e6c850ee94ffc4f03cb148885602089f6f6` 新 `tests/family-finance-ui.test.mjs` 防止身份入口误开启旧 `/api/entries`、验证 feature OFF、用户归属/版本、新家庭统计与端侧一次性证明。
3. `929ec41a6889ec23aba16c9aa683986939640538`：检查真实旧 App 首次加载：若未持有有效 legacy session 而 HomeFlow SSO 开关已启用，先通过旧 `/api/payment-sources` GET 的 401 判断登录状态，显示新的独立家庭授权入口，不让新成员卡在旧访问码的 `MobileLoginSheet`；当 SSO OFF 时保留原旧登录行为，不再额外查询正式 D1。 `a38119ec8be9fd3c3c2ed7adcdc6b66477ca876d` 新增测试，覆盖新成员首次安装及开关 OFF 后回退。
4. **明确不等于 C 完工**：这里只实现新个人金融账户基础 UI 和家庭月汇总；完整全家统计页、全部旧信用卡/储值余额/SBI/固定费归属映射、所有者/管理员分别管理的完整产品 UI、历史 entry 稳定 account_id 切换、审批后所有目标真实执行器都仍未完成。新家庭 member 只可通过受限新接口，并未获得旧单人家計簿的全部功能。

### D：HomeFlow 审批 PWA 返回前台同步状态

继续原 [HomeFlow Draft #306](https://github.com/PTamako/homeflow/pull/306)，此轮 HEAD `6c31cd6b1bc9d0fa2a1f1f92b8736ce04c04c817`，[Validate #43434113508](https://github.com/PTamako/homeflow/actions/runs/43434113508) **success**。

- `1cbda68f10e31e162aa7188406b9a2e949dde2c8`：`src/components/ApprovalCenter.vue` 在 iPhone PWA 由后台回到前台时（`visibilitychange/pageshow`），只对**当前活跃、展开、未请求**审批列表刷新一次，离开组件时拆事件监听器，**不增加定时高频 D1 轮询**。身份切换仍由旧 epoch 机制避免跨号写屏。
- `6c31cd6b1bc9d0fa2a1f1f92b8736ce04c04c817`：`tests/approval-center-ui.test.mjs` 增加无需轮询的前台刷新回归；CI 已通过。
- 尚未完成：可靠跨 App Push/推送深链及拒绝/过期通知、普通成员完整撤回后与家計簿草稿的多端状态同步、所有金融种类目标执行幂等/冲突/失败重试、双人真机端到端验收。

### 生产/接力安全检查点

- 所有上述代码**仅在已有 Draft**，无功能 PR 合并/部署；**本轮在 HomeFlow main 只写本交接 Markdown**，#314 的 docs-only `paths-ignore` 保证 push 不自动触发 Deploy HomeFlow。勿再次处理 #314。
- 设计书 A–F 仍按 A=用户负责待完成、B/C/D/E=分模块 Draft 持续开发、F=未开始实机联调。HomeFlow 0053/0054/0055、家計簿 0022–0026、知学 0180/0181、文书助手 0020–0022 **均未获本轮生产迁移授权**；本轮没有真实生产 D1 migration/Secret/开关的完整检查，因此需下次再单独只读核对，不能凭代码完成虚报已上线。
- 下一优先：知学按 user_id 隔离所有个人学习表与端侧缓存；家計簿完整家庭统计/个人余额与账单设置映射；HomeFlow 审批 Push/幂等结果重试；文书共享附件全流程与受审批同步；为各模块增加未登录、跨户、同户配偶越权和断网重试测试。完成新模块就将真实 CI/Commit/PR/部署状态追加本文件。


## 9.5 2026-11-13 本 Chat 续开发：文书共享附件删除与家計簿年度统计

> **阶段 A 状态不变：待用户本人完成生产加密备份与隔离恢复验证**。本轮未尝试 A；没有修改 Cloudflare 生产 D1/R2、没有启用 OAuth/审批/金融功能、没有创建 Preview，没有合并任何功能 PR。继续在现有 Draft #97/#309 工作；此前 #305/#306/#179 保持原状。#314 已合并，无重复开发或更改部署保护规则。

### E：文书助手共享附件的安全永久删除

- 原有 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)，分支 `feature/homeflow-identity-link-safety-20261113`。功能 `worker/lifecycle.js` 提交 [`06f9fb11`](https://github.com/PTamako/jp-document-assistant/commit/06f9fb11e0ab443de895767a384fe4985385d9ae)、真实 SQLite/模拟 R2 回归 `tests/worker.test.js` 提交 [`6df3a333`](https://github.com/PTamako/jp-document-assistant/commit/6df3a333bc1d0fb4263bf99b1e36a39f5b1ace4a)、模块说明提交 `1e97563b88c7309640c23d5ba7456acc192e6d35`。
- 已按设计书 R5 扩展**已明确共享的文书附件**：成员与原所有者均可将附件移入回收站/恢复/二次确认后永久删除。R2 实际 object `owner_id` 和墓碑始终保留原主人 ID；实际执行人在 `audit_events(kind='attachment_permanently_deleted',actor_user_id)` 持久审计；不可因删除而误以为历史 owner 是真实 actor。取消共享或私人文书继续服务端 404；永久删除前重新检查仍有共享权限。
- **R2 完整性**：同一 object 被两附件引用时，删掉一份只移除该 attachment 元数据，最后一个引用消失才精确清理原 R2 key；不做跨用户全桶清理，失败沿用受控删除状态/重试。测试还覆盖双人权限、重复删除无二次审计、共享撤销之后拒绝、R2 原件保存。
- [文书助手 Pre-merge CI #43438562835](https://github.com/PTamako/jp-document-assistant/actions/runs/43438562835) **success**（真实自动测试，非真机或生产验收）。完整增量说明见该 PR 的 `docs/homeflow-sso-backend-gates.md`。
- **尚未完成**：整份共享文书跨 owner 永久删除和附件孤儿补偿的所有竞争路径、旧用户名到 HomeFlow 的正式迁移/双人手机验收、跨 App 最小字段审批同步、个人 Google OAuth 独立授权验证。此处只修共享**附件**删除，不冒称全部共享文书安全生命周期已完工。

### C：家計簿真正共享的年度统计接口与家庭 UI

- 原有 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，分支 `feature/homeflow-sso-isolated-foundation-20261113`。
- `functions/api/family-finance/[[path]].js` 新增 `GET /api/family-finance/shared/year-summary?year=YYYY`：要求业务 App 当前独立 HomeFlow source-session 双向身份验证，读取原家庭全部 `entries`，以 D1 三种分组查询完成年度 12 个月/收入支出资产转移/按分类及支付方式统计，带金额、笔数与结余，**双方同一结果**，没有 owner/member 视角切换；资产转移不重复计算为收入/支出，普通 GET 不产生审计写入。
- `src/FamilyFinanceAccess.vue`：新家庭管理页年度选择、收入/支出/结余总计、月度趋势、分类列表、资产转移单列；原单人旧统计页不在本轮改写。非法年份 400；存在未知交易类型/损坏汇总则 409，禁止静默丢弃真实账目后显示 `complete:true`。不将新 SSO cookie 用于旧 `/api/entries` 写入。
- 新增以两个真实模拟 HomeFlow 身份与本地 SQLite 的回归，覆盖两人年度数据完全相同、年边界、计数与分类支付方式、未知交易类型 fail-closed、读请求无审计/正式 `entries` 无写动作；另有家庭 UI 静态门槛测试。
- 实际提交顺序：`e6de15c1647e2bcfdb8ff08b231d54ed9b602ccc`、`3d0fab90474346b81c96a93eb81037e7ac3b7873`、`58e33ca6c8a851136cfbe6a6a2d5be7bc145f957`、`07a4c3b49252a9aebbb7b0794a7e251997951127`、`02d6c693c3c842f9d0d1933c63cf70433d097f2a`、`b36c8387eb4d4000f1dd36b27f300cff86c1011e`（模块说明）、`ef7d713f963d19aaa38ccffa9c7b79f1c1b340d0`（未知类型不能漏算）、`8fffdd369f09a828aa5f9398012c67f6279ae55f`（类型异常回归）。
- [早期 Validate #43439421706](https://github.com/PTamako/kakebo_jp/actions/runs/43439421706) **success**；针对最新未知交易类型保护的 [Validate #43439846672](https://github.com/PTamako/kakebo_jp/actions/runs/43439846672) **success**、[Mobile WebKit #43439846696](https://github.com/PTamako/kakebo_jp/actions/runs/43439846696) **success**（均经 GitHub Actions 最终结果核对）。家計簿模块说明已追加 CI 结论（文档提交 `5b781795a4a15a11a52dd5b10a33ec923f073979`）。
- **尚未完成**：C 阶段完整的原统计/所有资产余额明细、SBI/固定费/卡账单账户映射到真实 user_id 及个人权限、成员所有正常记账流程与审批后生效。此年度分组只是共享统计的一个可回归模块，不代表完整 C 阶段验收通过。详情见 [家計簿 C/D 说明](https://github.com/PTamako/kakebo_jp/blob/feature/homeflow-sso-isolated-foundation-20261113/docs/family-finance-stage-c-d.md)。

### 本轮交接的安全约束与下一个模块

- HomeFlow 仍是唯一身份/家庭档案昵称和审批源；两人财务**同一家庭账本**，个人信用卡等配置按所有者分离；文书私人附件/Google OAuth 不因 owner 或共享而被越权。各 App 写动作仍必须持久记录真实 actor ID。
- 因用户 A 仍未完成，HomeFlow 0053/0054/0055、家計簿 0022～0026、知学 0180/0181、文书助手 0020～0022 **禁止在生产执行**；所有新功能开关保持 OFF，所有功能 Draft 继续未合并。
- 接下来应优先：1）查询本节最新 CI 最终结论；2）家計簿已有后台年度 API 与主统计 UI 的完整新身份整合，而非仅孤立卡片；3）文书整份共享永久删除的独立 R2 孤儿清理与私有 OAuth 授权边界；4）知学更大范围 user_id 独立学习表/缓存；5）HomeFlow 审批类型扩展、签名执行、状态回传、失败重试及推送。每个独立模块保留现有 Draft，并持续在本文件记录准确 CI、未上线与失败项。


### 9.5.1 本轮补强：共享 R2 删除途中的共享撤销并发

- 原文书助手 Draft #97 继续，**没有新 PR、没有合并/生产迁移/部署**。`worker/lifecycle.js` 在 `a124498da64b822a2ac238148e256634845ddd45` 修复物理 R2.delete 后因为原主人中途取消共享，导致附件元数据仍引用已经删除的 R2 字节的竞争风险。授权必须在进入 `deletion_pending` 和声明精确 R2 对象时有效；声明且删除开始后，后续元数据清理必须完成已授权动作，不能因另一设备撤销共享而遗留破损引用。后续新请求仍立即失权。
- `tests/worker.test.js` 在 `d7fdc4e4feb994d2f33c71d3dfdf4e34ad690fcc` 添加“R2.delete 中途撤销共享”的真实 D1/模拟 R2 测试，验证原始 owner 墓碑、真实共享成员 actor 审计、数据对象/附件引用一致性、撤销后私有读取继续 404。最新 [Pre-merge CI #43440624817](https://github.com/PTamako/jp-document-assistant/actions/runs/43440624817) **success**，文书助手说明补录 `be6cecf1554191390ba78e60cc7511990b6c3f8b`。
- 家計簿 #309 文档增量 `5b781795a4a15a11a52dd5b10a33ec923f073979` 的 [Validate #43440319598](https://github.com/PTamako/kakebo_jp/actions/runs/43440319598) **success** / [Mobile WebKit #43440319715](https://github.com/PTamako/kakebo_jp/actions/runs/43440319715) **success**，先前未知类型回归验证也成功。家計簿年度统计仍只是共享统计的一部分。
- **生产安全未变**：A=用户负责待完成，HomeFlow/main 这次仅增加交接 Markdown（依已合并 #314 的路径忽略不触发 Deploy）；所有功能 Draft 均未合并，四个正式 D1 和现有三个私有 R2 都没有被本轮代码/文档操作修改。


## 9.6 2026-11-13 知学每日任务真正按 HomeFlow user_id 隔离（阶段 E 增量）

> **先读取 GitHub 实际最新状态**：知学原 [Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 仍 open/draft，branch `feature/homeflow-identity-isolated-20261113`，本阶段代码/说明 HEAD **`89f34802896e23b12070e081ea9bdee88291c804`**（未来继续时以实时 PR HEAD 为准）。A **仍是待用户完成**；本轮**没有**备份生产数据、执行 0180/0181/0182 正式迁移、启用 SSO/每日任务新开关、修改生产 Worker/R2、合并任何功能 PR 或重建 Preview。#314 已经合并，此处不重复处理。

### 本轮已在原知学 Draft 实际提交的新功能（非仅设计）

- **新 0182 migration** `migrations/0182_homeflow_user_daily_tasks.sql`：把新个人任务放入 `homeflow_daily_task_progress`，主键 `(homeflow_user_id,study_date,task_id)`、CAS `version`、真实 `updated_by_user_id`、针对用户/日期复合索引、`homeflow_daily_task_events` 不可变审计、数据库层 actor=owner 约束。**旧 `daily_task_completions` 绝不修改**，旧用户归属只映射当前已凭旧知学有效登录证明绑定过的 HomeFlow owner；member 个人任务初始为空。
- **专用后端** `worker/homeflow-daily-tasks.ts`、`worker/index.ts`：GET/POST `/api/homeflow-study/daily-tasks`、GET `/status`、POST `/legacy/adopt`；所有授权从独立 HttpOnly Cookie + HomeFlow 后端 source-session introspection 获取真实 actor，不接受客户端自报 user_id/role。普通用户的单日期 GET 索引分页默认为 20、最多 50；POST 要求同源 JSON/用户真实版本，CAS 防旧设备覆盖/重复请求不记新审计；服务端以真实操作人写 append-only 事件。状态 GET 不读 D1，所有新功能须显式 `HOMEFLOW_STUDY_DAILY_PROGRESS_ENABLED=true` 且旧 SSO 安全门槛通过，**默认 OFF**。新 Cookie 仍不开放旧 `/api/daily-tasks` 或旧用户学习 API。
- **旧主人无损导入**：owner 明确确认并 POST `/legacy/adopt` 后才允许按 `study_date,task_id` 游标每批至多 20 条 `INSERT OR IGNORE`，不覆盖 owner 已经改过的 scoped 完成状态。成员无权领取历史；任何本批损坏日期、ID、completed 状态或时间戳，整批 409、无写入也不前进游标；原始旧表始终只读。
- **iPhone PWA 独立新界面**：`src/StudyHomeFlowDailyTasks.vue` 挂载至 `StudyHomeFlowAccess.vue` 中**仅当 HomeFlow 当前身份验证成功且每日任务开关实际开启**，按 `:key="identity.user_id"` 登录/切号卸载，展示当天 SG/日语/英语四项基础任务、已完成数、勾选保存/冲突刷新；owner 可明确确认后分页导入旧任务；member 没有旧任务导入按钮。**不读取或写入旧的 `zhixue:tasks` 等个人 localStorage 缓存**，进度来自当前用户专属新 D1 API。旧主 App 完整学习页面和其他个人学习缓存尚未按 user_id 改造，不可因此把 member 放入旧单人区域。
- **自动回归** `scripts/homeflow-sso-isolated.test.mjs`：真实 SQLite D1 测试 owner/member 同 ID/同日期相互独立、owner 旧记录不自动向 member 泄漏、无效来源/user_id 输入、分页导入 26 条、重入零新审计、损坏页必须整体拒绝、数据库 actor 触发器、停用/撤销源会话、乐观并发旧版本不会覆盖；`scripts/homeflow-pwa-ui.test.mjs`：静态检查身份门槛、组件按账号重建、Safari/PWA 切号不依赖 legacy 缓存和新旧接口边界。

提交与 CI 检查点（完整可在上述 Draft PR 查看）：
- 0182 schema `6fa428fe0bbad317f1ccd608e761df7c086c417c`；独立 Worker `5099ce60f4a4257a0b9f1427137d35388f561824`；原 index 路由 `eacfaade12d573fd9f6c337403b23ae6a423c7e7`；CAS 修复 `52bb92d19792cfcc3ac64eae3ad5402058c8d715`；SQLite/双人回归 `e950bc9d52b67f252c1bf97a9519404887e1604e`、`bef879e3d4ac1ef80358b80db23d7f2a421f9cc7`；轻量开关/status `127612613a4ea2dc05b1313bead51f12c2a63e6a`、`306230e3a4ec5e496eb838f43fceda33c603cd28`；PWA `81ae94ff7eaa217663d8fe43e083de9344ffd314`、`1183a3bd10e48d56056aec9df8ee23169722c391`；界面安全回归 `86e6f26b7a2942953bb2fe2512c96dffdff1fe4d`；原分支模块说明 `4ea6267685fb103f80d28d77a27a7dfd97e22720`；错误提示修复 `89f34802896e23b12070e081ea9bdee88291c804`。
- [最新知学 Validate #43443670594](https://github.com/PTamako/it-study-platform/actions/runs/43443670594) **本文件初次记录时 in_progress**；不能声明成功，后续须复查最终结果并把错误/修复/完成状态追加到本节。

### 实际剩余与禁止事项

- **仅每日任务这一个 E 模块新增了 user_id 隔离；不是四 App 联调验收**。知学其他个人表（学习/考试题目作答、错题、模拟考试、全部语言卡进度、听力/语法/每日词、收藏/句子）和旧 localStorage/IndexedDB 登录切换仍需逐类隔离、owner 旧历史安全迁移和双人真机验收。当前原旧登录与 SSO 还可能在同一设备并存，不能向 member 开放未隔离旧页面。
- A 由用户自行完成；HomeFlow 新身份生产迁移/开关、家計簿/文书/知学新 migration 与功能 PR 仍不得自动部署，绝不重建 Preview。继续沿用原有 Draft PR，每个新模块务必跟进 CI、详细记录历史无损及用户权限。


### 9.6.1 此轮真实 CI 失败修复（非业务逻辑故障）

- [原知学 #179 Validate #43443670594](https://github.com/PTamako/it-study-platform/actions/runs/43443670594) **实际结果 failure**，不能写为成功。通过 GitHub Actions job 日志准确确认 399 测试中 **383 pass / 16 fail**；失败均是旧的 Worker `data:text/javascript;base64` / 临时 `.mts` 测试装载器未替换新增 `import {homeflowDailyTasks} from './homeflow-daily-tasks'`，导致 `ERR_UNSUPPORTED_RESOLVE_REQUEST` / `ERR_MODULE_NOT_FOUND`。新增的真实双账号 SQLite tests **3/3 通过**、PWA 隔离静态测试通过，无证据表明真实业务读写失败。
- `scripts/inline-chinese-dictionary.mjs` 是上述 16 个旧 Worker 测试共用的安全测试装载辅助。已在功能分支提交 **`5bd62dd8bfb54e24ad92aba5d0e6c037677c66c2`**，只为旧测试在 data URL / 临时模块中把新 HomeFlow daily import 显式替换成 **503 默认关闭** 的模拟函数，完全不修改真实 Worker 后端 API、不影响旧认证逻辑、不赋予旧测试 SSO 身份。新的每日任务真正安全逻辑继续由专门的真实 SQLite 双账号回归覆盖。
- 新 [Validate #43444534566](https://github.com/PTamako/it-study-platform/actions/runs/43444534566) **本节写入时 in_progress**，必须实际检查最终结论；通过前不可将 #179 本轮标记为 CI 成功。以上仅为 Draft 代码，A=用户负责待完成、不执行正式迁移、不合并或部署。


### 9.6.2 最新完整 CI 恢复成功（2026-11-13）

- 旧测试装载器修复提交 **`5bd62dd8bfb54e24ad92aba5d0e6c037677c66c2`** 后，已实际查询 [知学 #179 Validate #43444534566](https://github.com/PTamako/it-study-platform/actions/runs/43444534566)，**completed/success**。job 内 **Run automated regression tests、Type-check and build frontend、Validate complete D1 migration chain locally** 全部 `success`。此结论覆盖 §9.6.1 的旧失败状态，不可把之前 16 条 mock 失败继续当成最新状态。
- 最新原 Draft #179 **仍未合并**；通过 CI 后仅在同一功能分支追加模块说明 [`4e0aa78cd3238ccd1055e268f86e5205f162a2ba`](https://github.com/PTamako/it-study-platform/commit/4e0aa78cd3238ccd1055e268f86e5205f162a2ba)，不改变已验收的运行时代码。前次 UI 错误提示修复与主功能均包含在通过的 Workflow HEAD 中。
- **A 不变：待用户本人完成正式四 D1/三 R2 的加密备份、校验、隔离恢复**。知学 `0180/0181/0182` 只是 SQL 文件、未在生产 D1 执行；`HOMEFLOW_STUDY_SSO_ENABLED` 与 `HOMEFLOW_STUDY_DAILY_PROGRESS_ENABLED` 在正式生产仍不得启用；不得合并功能 Draft 或创建 Preview。后续优先做语言卡与考试/错题完整 user_id 隔离、端侧缓存分区、双人真机验收。


## 9.7 2026-11-13 知学语言卡掌握与复习记录按 HomeFlow 用户隔离（E 阶段增量）

> A **待用户本人完成**：本轮没有触碰生产 D1/R2、没有备份/恢复、没有迁移、没有启用 Cloudflare 功能开关、没有新建 Preview、没有合并/部署四 App 功能 PR；继续现有 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 分支 `feature/homeflow-identity-isolated-20261113`。#314 文档-only GitHub Actions 保护已合并，勿重做。

### 本轮新开发的独立、可测试语言学习模块

- **[0183_homeflow_language_progress.sql](https://github.com/PTamako/it-study-platform/blob/feature/homeflow-identity-isolated-20261113/migrations/0183_homeflow_language_progress.sql)**（commit `e6b86c6d0f162a33024d02db47f62b8ab8562135`）新建 `homeflow_language_mastery` 和 `homeflow_language_reviews`，复合主键均为 `(homeflow_user_id,card_id)`，包含掌握布尔/评论次数/连续记住次数/下次复习时间/again-hard-remembered 反馈、CAS 版本号和真实修改人；新增对原用户和资源分离的插入/更新触发器、不可变审计 `homeflow_language_events`、按用户到期查询索引。**旧 `language_card_progress` / `language_card_reviews` 表绝不改写，也不把旧 owner 的学习记录拷给 member**。
- `worker/homeflow-language.ts`（`2b725b0ca0827e52bd985c60579677e1cd546858`）及 `worker/index.ts`（`7fdddb35568260d34a0d94dd0cf52229cc37240c`）新增**完全独立**的 `/api/homeflow-study/language/{status,cards,mastery,review,legacy/adopt}`：默认 `HOMEFLOW_STUDY_LANGUAGE_ENABLED=OFF`；依赖 `HOMEFLOW_STUDY_SSO_ENABLED`、正式 HTTPS Origin、独立 Session 加密、Source-session HomeFlow introspect，从服务端获得**真实** user_id；每次读写仅用该 ID 作为 SQL 分区，不接受昵称/浏览器提供的 owner_user_id。语言卡页每次最多 30 条，仅读与教学卡的必要公开字段及**自己的**掌握/复习进度，不通过新的 HomeFlow Cookie 解锁原本单用户 `/api/language-progress`、`/api/language-review`。
- **网络重试与冲突保护**：掌握状态采用当前版本 CAS；复习动作需由客户端提交一次性 request_id，服务端 `request_hash` 在同一 actor 下唯一，并存 `payload_hash` 防止请求 ID 重用时篡改内容。已提交动作重试不会新增复习次数/审计；有冲突或源会话已撤销必须拒绝。复习周期沿用旧 again=10 分钟、hard=6 小时、remembered=1/3/7/14 天分级递增节奏；hard 保留兼容旧 `last_result='again'` 的规则。
- **只有原管理员可领取旧历史**：`POST /api/homeflow-study/language/legacy/adopt` 必须显式 `confirm:true`，`kind=mastery|reviews`，按 `card_id` 游标每批≤20行，先校验所有旧行数据，再 `INSERT OR IGNORE` 到 HomeFlow owner 的独立表。脏行返回 409、全页无进展/无新审计，旧两表原样保留；重导不覆盖 owner 在新表新改的状态；member 403，不可从旧 session 假装成另一用户。
- **新 iPhone PWA** `src/StudyHomeFlowLanguage.vue`（`4e2d9bff29e96848e45e3e1acb48629d178598cd`、`08f331b70766f9138515be6855ac4c46ff3fe859`），挂在 `StudyHomeFlowAccess.vue` 且以 `:key="'language:'+identity.user_id"` 隔离账户，支持中日/英语课程卡分页、掌握/取消掌握、三级复习、下次复习、上次网络中断同 request_id 恢复提交、管理员两类旧历史明确确认分批领取；member 不见领取按钮；**不读写任何旧 `localStorage` 学习缓存**。现有完整旧平台仍不可给新 member 用，本组件只是明确隔离的独立功能区。集成 commit `71c0387da16e206b094b8f0e1af07e02c67fe82b`。
- 自动测试： `scripts/homeflow-sso-isolated.test.mjs` 继续使用真实 SQLite 双 HomeFlow 账号模拟，新增两人同一课程卡不共享掌握与复习、历史仅 owner 显式导入、损坏旧行全页拒绝、版本冲突、唯一 request_id 防重复计次、不同用户可复用同一请求 ID、分页/默认关闭/撤销会话/Origin/演员身份防伪/数据库审计触发器。新增 `scripts/homeflow-pwa-ui.test.mjs` 检查独立路由、账户 key、PWA 不读取旧缓存、复习重试。旧 Worker data URL 测试装载辅助 `scripts/inline-chinese-dictionary.mjs` 仅给旧测试提供 503 默认禁用替身（commit `d8f7b8dc66078f5adfe60132bce9bc38b525d127`），**不削弱真实生产 Worker 身份校验**。
- 截至本段首次记录，最新 [知学 Validate #43447994442](https://github.com/PTamako/it-study-platform/actions/runs/43447994442) **in_progress**。必须核对最终 GitHub Actions、含本地 D1 migration 链/TypeScript/Vue build/回归；不要虚报 CI 已成功。若失败，先修原 Draft 后附加最新结果/未完成问题。

### 安全状态与剩余项

- 新 **0183 仅为未执行 SQL 文件**；禁止在 A 恢复验证通过前执行 0180/0181/0182/0183 或启用任何新身份/课程开关/合并会自动部署的 PR。HomeFlow main 仅追加交接 Markdown，原 #314 部署 `paths-ignore` 保护继续有效。
- E 仍未完成：考试题目作答/错题/模拟考/各类语法/听力/日常生词独立同步、完整旧 App localStorage/IndexedDB 账号分区与未完成同步队列隔离、HomeFlow 统一身份跨 App 完整权限、双人 iPhone Safari/PWA 真机验收。新 `StudyHomeFlowLanguage` 属于隔离模块，不代表全面双人开放。


### 9.7.1 本轮最终 Validate 成功与上线禁令

- 原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 分支代码与测试（含文档提交 `b53a7d95aeaf624ebcf3f785df9cb5c6db530d0e`）已经过实际 [GitHub Actions Validate #43449031354](https://github.com/PTamako/it-study-platform/actions/runs/43449031354) 最终核验：**completed / success**。此流程的 **Run automated regression tests / Type-check and build frontend / Validate complete D1 migration chain locally** 均成功。
- 首轮 481 pass/1 fail 的旧 PWA 提示文案断言（#43447994442）已在 `6bac88b4ce8d77111062673e273e68df6e027fff` 修复，不修改任何身份权限、生产数据或业务逻辑。新增的语言卡双账号/审计/旧数据安全采用/去重/页面隔离测试在第一轮就已经全部通过。
- 本次**只完成独立语言卡掌握与复习模块**：语言卡不解锁旧考试/错题/模拟考，也未实现完整端侧缓存分区或双人手机真机联调。**A 仍待用户本人完成**；知学 0180～0183 全部仅为未执行 SQL 文件，生产新开关 OFF，Draft 未合并/未部署，绝不能用“CI 绿”代替用户加密备份和隔离恢复验证。
- 下轮推荐：知学考试练习/错题/模拟考试逐用户真实 D1 隔离、再对端侧缓存和未完成提交队列分区；仍每个模块修改原 Draft、测试通过并更新本交接文件。其他四应用中的 HomeFlow 审批、家計簿全部个人金融资源、文书跨 App 联动均未因此标记完成。


## 9.8 2026-11-13 知学考试练习＋错题＋模拟交卷独立账号模块（阶段 E）

> 生产安全 **A=待用户本人完成**，开发者本轮未碰生产 D1/R2、未尝试 A 备份、未执行任何迁移、未创建 Preview、未启用新功能开关、未合并或部署任何功能 Draft。继续原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 原分支 `feature/homeflow-identity-isolated-20261113`；HomeFlow `main` 仅更新本交接 Markdown，利用已验证 #314 docs-only `paths-ignore` 避免 Cloudflare 自动部署。

### 已提交的实际新增代码

- 新 `migrations/0184_homeflow_exam_progress.sql`：按 `homeflow_user_id` 独立创建练习答题 `homeflow_study_attempts`、错题复习 `homeflow_question_review_state`、个人考试成绩 `homeflow_exam_history` 及不可变 actor 审计 `homeflow_exam_events`。**旧 `study_attempts`、`question_review_state`、`exam_history` 不改写、不删除**；现有题库 `questions` 仍可共享，个人正确率和错题永远不可混账。
- `worker/homeflow-exams.ts` 新的 `/api/homeflow-study/exams/{status,questions,attempts,wrong,history,legacy/adopt}`：只认真实 HomeFlow 独立 HttpOnly Session + 每次源会话核验后的 `user_id`，默认新 `HOMEFLOW_STUDY_EXAMS_ENABLED=OFF`。交卷前绝不下发正确答案；提交由 D1 服务器判分，答案/错题进度/真实 actor 审计在一个原子 D1 batch，稳定 `attempt_id` 同答案幂等不同答案拒绝；家庭双方同题/同答题编号相互独立。管理员旧历史三类 `attempts|reviews|history` 须确认后分批 20 条校验/无损导入、脏行全批拒绝、旧记录不被改写，member 无权采用旧 owner 历史。旧模拟交卷所产生的长尝试 ID 最高 240 字符仍可无损迁移。
- 新 `migrations/0185_homeflow_mock_exam_submissions.sql`：按 `(homeflow_user_id,id)` 保存只属于实际交卷人的不可变试卷 payload/判分回执，旧 `mock_exam_submissions` 不动。 
- `worker/homeflow-mock.ts` 新 `/api/homeflow-study/exams/mock/{status,questions,submit}`，在上述考试开关之上**还需** `HOMEFLOW_STUDY_MOCK_ENABLED=true`；默认双重关闭。复用 `mock_question_pool` 的 D1 索引随机有界组卷，严格要求 SG 48A+12B（60题）、FE A60、FE B 算法16+信息安全4（20题）；不满足数量/分布即 409 而非凑假题，预交卷无正确答案/解析。交卷时必须全部有唯一题号，由服务端按 `questions.answer_json` 判分并对分类复核，以一次 5 条 D1.batch 原子写入本人回执、每题答题、对应错题/复习 state、个人考试成绩和审计；超时重复交卷同编号直接取回执，不能重复计数，另一个家庭成员独立编号空间。
- 新 PWA `StudyHomeFlowExams.vue` 和 `StudyHomeFlowMock.vue`：在 `StudyHomeFlowAccess.vue` 已认证身份区域 keyed `identity.user_id` 挂载，练习、错题、考试成绩分类，旧主人明确确认后导入；模拟考 SG/FE 按每页5题作答、答案保存本次页面内存、提交前确认，判分后展示原标准答案/解析，不读取旧用户的 `localStorage`/IndexedDB。网络提交失败保留本页面相同交卷 ID 用于重试。**尚无断网持久续考**，刷新会丢未交卷临时选择；明确向用户展示。
- 真实 SQLite/模拟双账号回归 `scripts/homeflow-sso-isolated.test.mjs`：本人/另一人同题练习/错题互不泄漏、尝试/成绩幂等、错题复习连续三次自动掌握、owner 历史领取及损坏记录全页拒绝、不可变审计、SG/FE A/B 真实 48+12/60/16+4 组卷与题库分布、同 ID 夫妻各自交卷、模拟卷回答数/身份/Origin/非法题型校验、原 D1 多表交易和重复交卷。另 `scripts/homeflow-pwa-ui.test.mjs` 新增 PWA 独立路由/账号 keyed/无旧缓存门禁，`scripts/inline-chinese-dictionary.mjs` 仅将新模块 import 在旧数据 URL 模拟测试环境中替换为 503 stub，**真实安全接口无绕过**。
- 这轮主要 commit：0184 `09bbcf86d42f5ebb78c72f92b7445ae82662145b`、Exams API `afcb9d69fe7975283f0c98a297d7d75341ed8334`、0185 `711dc8ab47b1286271904717b7b87ad401102678`、Mock API `85ef790a6884eec0249fb7a2b1aeaa9fa875e60f`、个人练习 UI `ba2d005987dc39a8f97864026a8cd1976960a8c9`、模拟 UI `cd1ce216027e73526c3588e6caf4609d5fbfe0d2`、多表回归 `251701bae9d4f37d1d35600991dee37cb703dc09` / `b9f079eb1fa463b4b5e41432ef92e661aa68ea65`、长 ID 修复与测试 `0fe297a2594b5176af1cd0bcc3ea8bb4adc960b6` / `840783f6a2b757b77a69de66c605d3f58d403ffc`、文档 `303ffdb8011845ebceab18731b1ca780b1ecb350`。完整模块说明见 [知学原 Draft 模块文档](https://github.com/PTamako/it-study-platform/blob/feature/homeflow-identity-isolated-20261113/docs/homeflow-identity-phase-b.md)。
- **CI：本段写入时最新知学 CI 尚未核实最终成功；禁止虚报通过。** 以 [知学 PR #179 Checks](https://github.com/PTamako/it-study-platform/pull/179/checks) 的最新 job 结论为准；出现失败先修在原 Draft。此次功能未在双人真实 iPhone 上进行 Safari/PWA 验收。

### 必须接续、不应提前放行的内容

- **仍未完成**：旧模拟交卷原 receipt 的单独领取/重复交卷恢复；从完整 PWA 旧缓存及待提交队列转为 user_id 强隔离；个人每日语法/听力/单词等其它学习表迁移和权限、家庭跨应用审批及真实多设备验证；整个四 App 统一账号上线前的 A 加密备份+恢复验证。
- 知学生产不得执行 `0180～0185` 或开启 `HOMEFLOW_STUDY_SSO_ENABLED`、`HOMEFLOW_STUDY_EXAMS_ENABLED`、`HOMEFLOW_STUDY_MOCK_ENABLED`、`HOMEFLOW_STUDY_LANGUAGE_ENABLED` 等新开关。已有旧个人版应保持可用，不可因为 Draft 通过 CI 就自动部署。


### 9.8.1 实际最终 CI 恢复成功（2026-11-13）

- 第一轮完整 [知学 Validate #43453976022](https://github.com/PTamako/it-study-platform/actions/runs/43453976022) **failure**：491 项自动测试 **490 pass / 1 fail**。失败仅是为真实 SG/FE 模拟考新增 140 道测试题后，旧双账号练习测试仍错误地预期默认分页只返回 2 条；实际后端按上限正常返回 15 条。其余新个人考试/错题/成绩、SG/FE A/B 模拟组卷、60/20 题原子交卷、同 ID 幂等和旧数据安全领取测试当时全部通过。
- `scripts/homeflow-sso-isolated.test.mjs` 提交 [`4df0f09e85facf319fa1cd5bb83c1c4a5cd7587f`](https://github.com/PTamako/it-study-platform/commit/4df0f09e85facf319fa1cd5bb83c1c4a5cd7587f) 改为验证默认分页上限 15 条与原始 SG 示例仍存在，不削弱其他模拟考试/跨账号权限断言。严格 Vue TypeScript props 用量修复 `009b14f57fa168bd06217ee58d2edb4276462e3b`、`0ca546090315c0a5bfc715267677de0987643552`、保留 owner 历史导入运行时角色校验 `4dc2333d04fd04c773f168ce7725ceb17366f6ee`。**未更改任何生产环境或原已有考试数据**。
- 已**实际读取**最终 [知学原 Draft #179 Validate #43455258591](https://github.com/PTamako/it-study-platform/actions/runs/43455258591)：`completed/success`。其中 **Run automated regression tests / Type-check and build frontend / Validate complete D1 migration chain locally** 三步全部 `success`；通过的代码 HEAD **`4dc2333d04fd04c773f168ce7725ceb17366f6ee`**。此处本地完整迁移链验证**不等于生产 D1 迁移**。
- 最终 PR 仍 `open` / `draft=true` / `merged=false`，没有部署，也没有新建 Preview。**A 阶段仍是用户本人待完成**；后续在用户已完成生产加密备份/哈希验证/隔离恢复之前，`0180～0185` 一律不得在生产执行，四个 App 任何新身份功能开关禁止开启/自动合并部署。
- 下一工作焦点：按真实 HomeFlow user_id 分区剩余每日语法/听力/词卡与端侧缓存/排队请求；原 owner 旧模拟交卷 `mock_exam_submissions` 逐条 receipt 迁移（目前已能领取旧练习/复习/考试摘要，但**没有**迁移原始旧模拟回执），以及双人 iPhone Safari/PWA 模拟考和离线断线恢复全流程验收；HomeFlow 审批、家計簿个人资源、文书助手跨应用联动继续在各自原有 Draft 里完成。


## 9.9 2026-11-14 原管理员模拟交卷完整回执无损迁移（知学 E 阶段）

> 继续原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 的 `feature/homeflow-identity-isolated-20261113`；**A=用户本人待完成**。本阶段一切 SQL/Worker/UI/测试均只提交功能 Draft，**不导出/改写生产数据库、不启用新身份开关、不部署、不重建 Preview、不合并 PR**。HomeFlow `main` 仅追加本 Markdown，遵守已合并 #314 的 docs-only 无生产部署策略。

### 真实实现与数据库边界

- 新增 `migrations/0186_homeflow_mock_receipt_adoption.sql`：不可变 `homeflow_mock_legacy_adoptions` 审计，记录真实 HomeFlow actor user_id、旧提交 ID、原始 payload SHA-256、原始 result SHA-256、时间，FK 精确引用本人新的 `homeflow_mock_exam_submissions`；数据库禁止更新删除。**不修改**既有不可变 `homeflow_exam_events` CHECK 约束、**不修改**旧 `mock_exam_submissions`、旧 `study_attempts`、旧成绩。
- 新 `worker/homeflow-mock-receipts.ts`：私有 `GET /api/homeflow-study/exams/mock/receipts?limit=10&after=...` 与 `GET /api/homeflow-study/exams/mock/receipt?id=...`，只按源会话实时核验后真实 `actor.user_id` 查询本人新回执（列表不返回整套答案，详情仅登录本人可见）。`POST /api/homeflow-study/exams/mock/legacy/adopt` **仅**经旧知学有效证明首次绑定的 HomeFlow owner、同源 JSON 请求、`confirm:true`。按原回执 ID 游标每批最多 **5 份**：严格验证旧试卷格式 SG60/FE A60/FE B20、完整日期、提交题目/答案唯一性、判分回执题目顺序/分数是否与原答案匹配、JSON 正确性；有任一损坏即整页 409、无写入、游标不前进。先检查本人的同 ID 目标，如不完全一致直接 409，不静默覆盖；存在完全一致时跳过。新增记录由一次 D1.batch 内的原始 `payload_json`/原始 `result_json` **逐字节复制** + 每行不可变审计组成，数据库唯一约束和 batch 防并发重入导致重复或半页成功。历史原件从不删除、也不再判分或重复写答题/复习/成绩。
- `worker/index.ts` 注册独立路由，原模拟考试的受保护旧单用户 API 不变；三项新路由均仅在已经存在的 `HOMEFLOW_STUDY_SSO_ENABLED`、`HOMEFLOW_STUDY_EXAMS_ENABLED`、`HOMEFLOW_STUDY_MOCK_ENABLED` 全部开启且严格正式源会话检查成功后才提供。全部开关**默认关闭，生产禁用**。
- `worker/homeflow-mock.ts` 调整旧导入回执在新账号 `POST /submit` 同内容重试时的**仅响应封套** `scope:'user'` 兼容；D1 存储的原始 `result_json` 完全不更改，重试不会重新判分或增加旧状态。
- iPhone PWA 新 `src/StudyHomeFlowMockReceipts.vue` 在 `StudyHomeFlowMock.vue` 下以 HomeFlow 当前 `identity.user_id` keyed 挂载。默认折叠、不做无谓 D1 读取；点击后分页查看**自己的**交卷分数、按需展开正确答案与原解析；owner 需要确认才分批领取原历史，member 不显示导入按钮。新界面从不读/写旧 `localStorage`/IndexedDB，换账号时销毁旧组件/回执详情；真正后端按 actor 验证，不依赖隐藏按钮作为权限控制。
- `scripts/homeflow-sso-isolated.test.mjs` 扩充真实 SQLite 双用户回归：6 份原试卷分 5+1 分页，源原文 JSON 字节不变，重复导入只跳过不重复审计，真正 source session/owner 验证，同一 ID 不同目标内容必须 409，不可变导入审计，成员无法看原管理员详情，损坏单条旧结果令全页拒绝，原本人同编号交卷回放不重判分。`scripts/homeflow-pwa-ui.test.mjs` 检查 PWA 新独立路由/账户 keyed/默认折叠/无旧缓存；旧 Worker 测试 loader `scripts/inline-chinese-dictionary.mjs` 只加 disabled 503 stub 不改正式授权。
- 主要代码提交：`4f5e9a95556086e73ff2ef507d2a350a8edd570b` (0186)、`8c16925ab312fa12e43f95a19673588f4fa0fba4` (后端)、`3a964fd90023f2f667986693e69b9e3c2767a1b4` (路由)、`6ab7a8f466e8a7c65810581f45816874ed237d6c` (兼容回放)、`3d73e4522edb10a7615cee6ef749bc4b2a3eb8b1` (SQLite fixture)、`b462df77dae3e0c5fc477b2c69798bbc13ec5eb7` (旧测试 loader)、`db37d0a134ab5e44736313f063e463d835314128` (双账号审计回归)、`d0682ae4728dc18bb6bc9ce65e8512c1ae3f73d3` (PWA)、`5448380f5b983d205bdc9d199cca79f043514d17` (集成)、`428cac671e2f4cc2dc7ed1c52bb224905989a110` (PWA 安全断言)。
- **本节首次记录时最新 [知学 Validate #43458408489](https://github.com/PTamako/it-study-platform/actions/runs/43458408489) 仍在执行**，不得虚报全部 CI 已通过；必须等真实结果核对再补最终记录。此阶段仅是代码与自动化测试，**并非真机/生产验收**。

### 后继剩余

个人每日语法/听力/词卡历史与端侧缓存、未提交数据的 user_id 隔离；完整断网续考的隐私安全实现；SG/FE 多设备双人真实 iPhone PWA 验收；HomeFlow 审批、家計簿共享账本+私人账户和文书助手跨 App 联动均仍有未完成。**A 生产备份恢复仍由用户完成，知学 0180～0186 都不可执行生产迁移**。


### 9.9.1 实际最终 CI 成功与生产禁令

- 已实际查询 [知学 #179 最新 Validate #43458408489](https://github.com/PTamako/it-study-platform/actions/runs/43458408489)，最终 **completed / success**；job 内四项检查 **Run automated regression tests**、**Type-check and build frontend**、**Validate complete D1 migration chain locally**、**Validate Worker bundle without deploying** 均 `success`。这是包含本次 0186、旧回执导入 Worker、PWA、双账号 SQLite 测试的代码 HEAD `428cac671e2f4cc2dc7ed1c52bb224905989a110`。此验证只在 CI 隔离环境进行，**绝非生产迁移或上线**。
- 同步核对原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) **open / draft=true / merged=false**，保持在 `feature/homeflow-identity-isolated-20261113`；HomeFlow/main 的本交接更新仅有 Validate，依 #314 的部署路径忽略，不得触发生产。
- A=用户本人待完成，绝不在未获明确验收前执行生产 `0180～0186`、打开 SSO/考试开关、合并功能 PR 或创建 Preview。旧模拟考试交卷回执迁移经自动化验证，但仍**未完成双人真实 iPhone/PWA 的验收**；未来用户完成 A 后需单独批准生产放行。
- 下一开发不必重做已经通过的旧回执迁移；优先推进个人 `grammar/listening/daily-word` 历史与权限及端侧缓存/离线队列隔离，再做四应用端到端权限/审批和真机验证。


## 10. 2026-11-14 用户本人完成 A 阶段加密备份及本地恢复验收（最新真实状态）

> **验收范围与来源**：用户在本人 Mac 上按脚本与 Keka 完成备份/本地恢复，向当前会话逐次反馈命令 `PASS`；已连接 Cloudflare 账户的只读 API 另行验证当前四 D1 关键计数、三 R2 源端对象及内容哈希。GitHub 不存放 SQL、R2 原图、完整对象 Key、密码、Token、备份文件下载地址或可恢复的明文数据库。**本节更新此前全部「A 待用户完成／无已保存备份」历史状态。**

### 10.1 已通过：D1 实际持久备份与隔离恢复

- 四个生产 D1 SQL 已经下载保存到本地，逐项 SHA-256 核验通过；用户将同一批已校验 SQL 纳入最终加密包，脚本报告四库 SHA-256 PASS。
- 用户从此前 Google Drive 下载并解密的加密包中，在 Mac 使用 `sqlite3 -batch -bail` **真实恢复为四个新的本地 SQLite 数据库**；四库 `PRAGMA integrity_check=ok`、`pragma_foreign_key_check=0`；不涉及任何生产 D1 写入。

| D1 | 本地 SQLite 表数 | 本地关键表计数 | 2026-11-14 Cloudflare 当前源端再次只读查询 | 结果 |
|---|---:|---|---|---|
| `homeflow` | 54 | `users=2` | `users=2` | PASS |
| `kakebo` | 24 | `entries=299`：`expense=263`、`income=16`、`transfer=20` | `entries=299` | PASS；用户确认账务金额/金融账户汇总正常 |
| `it-study-platform` | 27 | `language_cards=16170` | `language_cards=16170` | PASS；题库总数不是私人学习记录数 |
| `jp-document-assistant` | 34 | `documents=0` | `documents=0` | PASS（本次快照）；见 10.4 的历史差异 |

- 备份的恢复测试是**本地 SQLite**，不是针对 Cloudflare D1 服务端导入 API、隔离 Worker 或数据库 Time Travel 的实际回滚演练。此限制不得省略。

### 10.2 已通过：R2 完整对象路径、内容哈希与元数据

- 初版 Mac R2 文件导出曾有 `.DS_Store` / `._*` AppleDouble 元数据混入，且部分文件内容/原始 Object Key 不匹配。**已弃用初版作为权威恢复依据，原始旧备份未删。**
- 用户用只读修复脚本重新从 Cloudflare 下载真实对象，保留完整**原始 Object Key**及 SHA-256、`Content-Type`、ETag、最后修改时间、Storage Class、自定义元数据；六个文件下载大小与 SHA-256 全通过。云端重新 GET 对象并独立计算内容 SHA-256，家計簿三个对象云端 `custom_metadata.sha256` 与原件内容均一致。

| Bucket | 云端/备份对象数量 | 字节总数 |
|---|---:|---:|
| `homeflow-family-media` | 3 | 772872 |
| `kakeibo-receipts` | 3 | 440351 |
| `jp-document-assistant-private` | 0 | 0 |
| **合计** | **6** | **1213223** |

- 云端与 Mac 比对的规范：按字典序排序六条 `bucket<TAB>key<TAB>size<TAB>file_sha256`，通过 LF 拼接、无结尾换行，对 UTF-8 字节计算 SHA-256。**两端完整指纹一致**：`9588df8710a9690b36ee307b0106070ad8d78c35995aeb36967f1a30409e2cbf`。对象二进制与 Key 已核验；**尚未实际向隔离 R2 Bucket 写入恢复，因此元数据能否被恢复工具原样重建未完成演练**。

### 10.3 已通过：最终版 Keka 加密与私人 Google Drive 验证

- **最终权威备份基名**：`A-stage-verified-cqf3T3`，最终 `.7z` 加密包；用户报告使用 Keka 7Z/AES-256 与文件名加密。解密密钥由用户本人保管在 Apple「密码」App，不存于 GitHub/Drive 同目录/聊天。
- 用户在 Mac 解压最终加密包，以 `rsync -rnic --delete`（忽略 `.DS_Store`、`._*`）对比最终明文 staging 目录，得到 **`PASS: 最终加密包解压内容完全一致`**。
- 用户上传最终版至既有私人 Google Drive 目录，并下载回 Mac，使用 `cmp -s` 逐字节比较本地原始 `.7z` 与下载版，得到 **`PASS: 最终 Google Drive 加密备份完全一致`**。旧版包没有被覆盖或删除。
- 备份文件及其解密密钥仅在用户设备/私人空间保管；本次 GitHub 更新**未独立取得 Google Drive 文件字节或重跑 Mac 上的恢复**，不可把用户反馈伪写成云端后台自动测试。

### 10.4 历史基线差异与生产迁移的剩余安全门槛

1. **文书助手数量差异已由用户确认并结案（2026-11-14）**：2026-11-13 早期只读基线 `documents=2`，2026-11-14 生产 D1 与 SQLite 恢复均 `documents=0`；用户明确确认两份文书是其本人主动删除。故该数量差异属预期操作，不作为数据丢失事件或备份验收阻断项；本次快照只备份目前现存的 0 份文书，不承诺恢复已删除的两份。家計簿 `entries` 较早基线 296→本次 299（expense +3、income/transfer 不变），本次生产与本地一致，用户确认金额/财务账户正常。
2. **未做 Cloudflare D1 隔离恢复/回滚演练**，也未做 R2 对象连元数据的隔离写入恢复；不能声称生产回滚已验证，不允许用本地 sqlite3 成功代替 D1 迁移兼容性验证。
3. **未证明四个 D1 与 R2 是同一事务时间点的一致快照**。正式迁移前应冻结相关写入或采用维护窗口，重新采集新鲜快照与全表/业务关键关联基线；验证实际执行顺序、回退脚本、角色权限、功能开关、CI 与双人 PWA 测试，获得用户明确生产上线批准后方可执行。
4. 阶段 B～E 原有功能 Draft、待执行迁移和默认 OFF 新开关保持不变。**A 的本地验收成功不是合并、迁移或部署授权**；不得重建 Preview，不得直接覆盖生产库或删除历史备份。

**阶段 A 最新归档结论：四 D1 + 三 R2 的可恢复加密备份与 Mac 本地隔离恢复验证 PASS；历史文书数 2→0 已由用户确认主动删除、差异结案。生产 D1/R2 回滚演练及 B～F 上线门槛仍待完成。**


## 11. 2026-11-14 知学 E 阶段接续：每日语法个人隔离（开发中，CI 待最终验收）

> 读取本文件之后先交叉核对：启动时 HomeFlow main=`fe1c87ff6b2f983b00c2b0d46c89db789c3d14d6`，写入前因其他会话刚追加第 10 节，已变为 `7380e8d527d7384560527065f0de1280616791d7`。**本节保留第 10 节的用户 Mac 加密备份/本地恢复 PASS 和剩余安全限制，不覆盖、不重新运行备份。**按用户本次开发消息要求，本轮仍不视 A 获得正式生产迁移/合并/部署放行；A 相关上线门槛须用户另行明确解除。所有四 App 功能 PR 仍保持 Draft、未合并；不创建 Preview、不执行正式 D1、不改生产 R2、不打开 SSO/审批开关。纯 Markdown 通过 HomeFlow main 已合并 #314 的 `docs/**` `paths-ignore` 安全提交，绝不修改工作流配置。
 
### 开发分支、真实代码提交、CI 范围

- 继续原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179)：`PTamako/it-study-platform`，分支 `feature/homeflow-identity-isolated-20261113`。开始前 PR HEAD `428cac671e2f4cc2dc7ed1c52bb224905989a110`、[Validate 43458408489](https://github.com/PTamako/it-study-platform/actions/runs/43458408489) `completed/success`，已实现的 0180～0186 旧回执/考试/语言/任务模块均保留，未重复实现。
- 旧个人语法真实表 `daily_grammar_answers` 来自 `0133_daily_grammar_answers.sql`，不带 `user_id`，旧 `/api/grammar-progress` 与旧 `DailyGrammarLesson.vue`/IndexedDB 键也不带身份。本轮 **不修改旧表/旧 API/旧 PWA 缓存**，避免干扰现有正式单人使用者。
- 新未执行 `migrations/0187_homeflow_grammar_answers.sql`：`homeflow_grammar_answers` 复合主键 `(homeflow_user_id,study_date,language,question_id)`，`updated_by_user_id` 强制为当前真实 owner、答案 first-write-wins；`homeflow_grammar_events` 持久追踪真正 actor、写入/旧历史领取数量，审计不可更新删除。唯一主键自带日期复合索引，避免冗余 D1 索引；跨 actor、同键不同答案（含并发 `INSERT OR IGNORE`）、更新删除均在 SQLite 触发器层拒绝。
- `worker/homeflow-grammar.ts` + `worker/index.ts` 新增 `GET/POST /api/homeflow-study/grammar`、`GET /api/homeflow-study/grammar/status`、`POST /api/homeflow-study/grammar/legacy/adopt`：仅在正式 SSO 合同+额外 `HOMEFLOW_STUDY_GRAMMAR_ENABLED=true` 同时满足时使用，默认关闭。每次调用严格使用 HomeFlow HttpOnly 个人 Cookie + 服务端 source-session introspection 的 actor ID，**不相信浏览器请求的任何用户 ID**；新增 `expected_user_id` 只是强制旧设备/离线队列在账号切换后失败关闭的校验。写入同源 JSON 校验、题号、日历日期与答案范围校验，冲突拒绝，不覆盖旧答案。
- 原管理员本人旧语法：只允许旧知学会话证明绑定过的 HomeFlow owner 显式 `confirm:true`，按 `(study_date,language,question_id)` 每页最多 20 条无损导入；损坏整批 409 不写入，原表原文不变、重复领取不重复审计、同键不同答案拒绝，成员不能领取或读取管理员历史。生产未执行导入。
- 新 `src/StudyHomeFlowGrammar.vue` 经 `StudyHomeFlowAccess.vue` 成功验证真实身份、按 `:key="'grammar:'+identity.user_id"` 挂载：日/英语语法每日三题、本人进度、管理员历史分批确认；**新区域只在线读写本人 API，无旧 localStorage/IndexedDB/脱机队列**，断网失败后由当前用户手动重试。旧首页/旧语法本地缓存尚未改造成按账号空间，不能将成员开放旧 App 所有个人学习页面。
- `scripts/homeflow-sso-isolated.test.mjs` 增真实 SQLite 0187 schema 与两个模拟真实 HomeFlow source-session 账号：夫妻同题不同答案、成员空空间、旧管理员导入、重复导入、损坏旧历史全批失败、20+6 条分页、账号伪报/切换拒绝、Origin/日期、失效源会话、trigger actor/审计不可变、并发冲突；`scripts/homeflow-pwa-ui.test.mjs` 校验账号 keyed 与旧缓存禁止；旧 data-URL Worker 兼容测试 loader 只加 503 stub。**这些是已提交的测试代码，写交接时 GitHub 最新完整 CI 仍需等最终结论，不能虚报为通过。**
- 实际本轮功能/测试 Commit：`33f91daa2e3ac3f8b077b658198a45998aa33b9b` (0187)、`4c5d85c47c8aba0b384e0c27f9df9a65c1341877` (API)、`e0e396c380dd8e07130a4077874d7fea95f7d610` (路由)、`02236c1963bac6d31639b592594f9494837c98da` (SQLite 测试)、`b6a04340763de559ae5df2c7183c7ad4f30da52f` (个人语法 UI)、`1eea0dd9363e3a1f151b80beedc134417603dbe3` (挂载)、`f2980878a2561cad3dfdb4b9d42d8aaafe8cc55f` (UI 测试)、`7525bfb894d0a7b80dfb3a7cf65746997e18a2ff` (冲突触发器)、`9a367a7f4e82ca187b9a529a7c8fb6e25c4fea05` (并发回归)、`3b239bf42c356cef95e2cb1b1c68a33f7f58b532` (类型)、`9c09f180b2232356d4ece82b07f3cac1a65cff18` (索引)、`7ba7312895df2ce351301dc0141e375478e93427` (UI 验证)、`0e266dbada3714ead87750fa2c02a1e0b4f05ada` (旧 Worker 测试)、`dce17f2c0e1f497c43fe49802c0fbadacd94f81e` (知学模块说明)。
- 最新提交 SHA `dce17f2c0e1f497c43fe49802c0fbadacd94f81e` 对应 [知学 Validate #43463935020](https://github.com/PTamako/it-study-platform/actions/runs/43463935020)，**记录时 `in_progress`，`conclusion=null`**。前面多轮 CI 在并发新提交后被正常 cancel，取消不等于 success。后续先查询此 Run 最终结论，读取实际失败步骤修正；只有 `completed/success` 才可记录自动化测试验收通过。iPhone 两人同机/两设备真机 **待真机验证**。
 
### 下一位开发者不能遗漏的未完成事项

1. **先等并验证最新语法 CI 最终结论**，出现 failure 阅读真实 job 日志并修复，绝不将 `in_progress` 写为成功；需要时单独补本文最终结果。
2. 原 `0150_daily_listening_answers`、`0152_daily_word_reviews`、对应旧 Worker 单人读写和客户端缓存/离线重试仍无 `homeflow_user_id`；继续用相同最小私有 API + 审计 + 显式 owner 历史领取 + 实际 SQLite 两人测试，不要让新成员借旧登录接口读管理员个人记录。
3. 全站主 `src/App.vue` 仍使用 `zhixue:daily-pending-v1`、`zhixue:mock-pending-v1`、`zhixue:practice-pending-v1`、`zhixue:scenario-pending-v1`、`zhixue:daily-word-pending-v1` 等不带用户的持久重试队列，`src/offline-grammar-store.ts` 用共享 IndexedDB `zhixue-offline-learning`，旧听力语法本机键共享。**完整 iPhone Safari/PWA 切换账号离线队列隔离未完成**；不可将旧队列归给新用户、不可给成员解锁旧单人端点。
4. HomeFlow #305/#306、家計簿 #309、文书助手 #97 的 B～E 仍未整体完成（审批结果真实跨 App 执行、个人金融资源设置全量迁移、文书权限/跨 App 联动等）。功能 PR 一律 Draft；生产回滚/历史差异和用户明确上线授权未完成，严禁生产变更。#314 已合并，不重做。


### 11.1 知学语法模块完整 CI 最终核验（补录，2026-11-14）

- 已重新实查 [知学 Validate #43463935020](https://github.com/PTamako/it-study-platform/actions/runs/43463935020)，基于原 Draft #179 的准确 HEAD **`dce17f2c0e1f497c43fe49802c0fbadacd94f81e`**，最终 **`completed / success`**。四个具名关键步骤均为 **`completed / success`**：`Run automated regression tests`、`Type-check and build frontend`、`Validate complete D1 migration chain locally`、`Validate Worker bundle without deploying`。期间其他中间 SHA 的取消系同 PR 新提交的 CI 并发取消，并非最终测试失败。
- 因为新 PWA 语法界面不使用旧离线缓存，**仅新个人语法模块**自动回归与本地迁移链验收通过；这不是整个知学 E 阶段完工。旧语法/听力/单词及主 App 端侧共享缓存/未提交重试队列依然需要按 `homeflow_user_id` 真正隔离。真实 iPhone Safari/PWA 双用户/两设备验收仍标记 **待真机验证**。
- 本轮没有执行任何 **生产** D1 `0180～0187` SQL、没有开启新 SSO/语法功能开关、没有合并 #179、没有部署 Cloudflare Worker/Pages，也没有重建 Preview。用户完成 A 备份验证的第 10 节并不代替后续的生产迁移、回滚和上线明确放行。HomeFlow 主分支本交接通过 docs-only 路径更新，不触发生产 Deploy。下一模块：`0150_daily_listening_answers` 的双人隔离和对应新独立 PWA 与历史无损领取，再处理 `0152_daily_word_reviews` 与端侧队列。


## 12. 2026-11-14 知学每日听力按 HomeFlow 用户隔离（开发中，CI 未最终结论）

- 原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179)，分支 `feature/homeflow-identity-isolated-20261113` 继续开发；旧 0180～0187 模块完全保留，语法模块完整 [CI #43463935020](https://github.com/PTamako/it-study-platform/actions/runs/43463935020) 已 `completed/success`。本轮没有合并、生产 SQL、开关、Cloudflare 部署、新建 Preview、生产数据更改。
- 尚未隔离的旧表 `0150_daily_listening_answers.sql` 的 `daily_listening_answers` 无 user_id；旧 `/api/listening-progress`、`src/DailyListeningPractice.vue`、`zhixue:daily-listening-v1:date:lang`/旧共用 IndexedDB 仍服务原有单用户功能，不向 HomeFlow SSO 账号开放。原录音仍旧本机临时保存、不上传，新 PWA 面板仅设备 TTS，无录音回听，旧模块未删。
- 新 **0188 尚未执行的 SQL** `migrations/0188_homeflow_listening_answers.sql` 新增 `homeflow_listening_answers`（复合 `homeflow_user_id,study_date,language,scene_id` 主键；真实 `updated_by_user_id`）和 `homeflow_listening_events`（不可变真实操作人审计）。DB triggers 拒绝伪造操作者、更新/删除历史答案与审计、同编号不同内容的并发 `INSERT OR IGNORE`；复用 PK 索引以减少 D1 写入。原 legacy 表完全不更改。
- `worker/homeflow-listening.ts` + `worker/index.ts` 新增独立 `GET/POST /api/homeflow-study/listening`、`GET /status`、`POST /legacy/adopt`；严格必须 HomeFlow SSO 正式源会话 introspection 后取得真实 actor，另需默认 OFF `HOMEFLOW_STUDY_LISTENING_ENABLED=true`。单日只允许当日六天轮换的日常/职场两段，日期/语言/题号/选项/同源 JSON 严格校验；写入 `expected_user_id` 只能与服务器实际 actor 相等，防账户切换后的延迟请求误写，绝不相信客户端 ID 做授权。
- 只有原管理员经过旧密码会话证明绑定 + 显式 `confirm:true` 才能以 `study_date,language,scene_id` 稳定游标每页 20 条领取旧历史；旧表只读不删除，单页包含坏日期/错题号整批拒绝，不跳过、不覆盖别人的数据；成员不得领取/读取。重复导入幂等不写重复审计。
- `src/StudyHomeFlowListening.vue` 仅在 `StudyHomeFlowAccess.vue` 已有身份、`:key="'listening:'+identity.user_id"` 的账号隔离组件内显示日/英两段听力、Web Speech 播放、本人答题、中文原文复习和管理员显式领取。新面板不读任何旧 localStorage、sessionStorage、IndexedDB、无离线重放队列、切号销毁内存状态并取消播放，网络失败不把旧账号请求交给新 Cookie。
- `scripts/homeflow-sso-isolated.test.mjs` 使用真实 SQLite + 两个 HomeFlow 模拟服务端 introspection 用户，覆盖同题两人不同答案、非法轮换场景/Origin/日期/伪 user ID、开关/会话撤销、原 owner 历史唯一领取、旧原文不更改、20+7 条分批、损坏整批 409、幂等、数据库 actor 审计不可变与并发冲突；`scripts/homeflow-pwa-ui.test.mjs` 增无旧存储/账号 keyed 检查，`scripts/inline-chinese-dictionary.mjs` 仅对旧 Worker 单用户测试加禁用 stub，不改生产。
- 真实 Commit：`0b0e4fabc888bd9e8c237f294bf7040f1e28ac43` (0188)、`aa4beb9a71283ca3a4ca57ebf6e272d8db3f2052` (新 Worker)、`ccb167078a30a3ec1d24afce5d78414805c70686` (路由)、`d0220285eca3904603739ce924bb472a6d950003` (SQLite 双人测试)、`5b879049459afae0013b72fc29666d592504094a` (PWA)、`b27befd711ceb80ae32d0b0b98f612a9f8f530d1` (统一身份入口)、`2b8f6905fbd9780478378007b3296e63a1a6df82` (旧 Worker 测试 loader)、`f0f4e2557bef62bcab18cbf83a6b3a29522c62aa` (PWA 检查)、`cf238213fe3fd69427a15f500d68bd88d036b065` (知学模块技术文档)。
- **本节首次记载时**最新 [知学 Validate #43466100589](https://github.com/PTamako/it-study-platform/actions/runs/43466100589) 的 HEAD 是 `cf238213fe3fd69427a15f500d68bd88d036b065`，状态 `in_progress`，绝不能先写成功。必须实查回归、Vue build、本地迁移链及 Worker dry-run 的最终结论，失败要阅读日志并修复，然后补录真实 SHA/最终 CI。
- 仍未完成：`0152_daily_word_reviews` 的个人数据和词汇选择/复习、主 App 原共享 localStorage/IndexedDB/待重试请求全站隔离、真实 iPhone Safari/PWA 双人切号/双设备/断网恢复 **待真机验证**、HomeFlow #305/#306、家計簿 #309、文书助手 #97 跨应用 B～E 审批/权限。第 10 节已记录的用户备份验证不能视为本轮获得生产迁移/合并授权；功能全部 Draft、生产禁令不变。


### 12.1 知学每日听力模块完整 CI 最终成功（2026-11-14）

- 已实际核对 [知学 #179 Validate #43466100589](https://github.com/PTamako/it-study-platform/actions/runs/43466100589)，代码 HEAD 精确为 **`cf238213fe3fd69427a15f500d68bd88d036b065`**，Run 最终 **`completed/success`**。具体步骤 `Run automated regression tests`、`Type-check and build frontend`、`Validate complete D1 migration chain locally`、`Validate Worker bundle without deploying` **全部 `completed/success`**，包含新增 0188、双账号 SQLite 和 PWA 无缓存隔离测试。该 CI 严格只在 GitHub Actions 隔离环境运行本地迁移与 Worker dry-run，**没有部署生产**。
- 同步再查原 `PTamako/it-study-platform` PR **#179** 仍 `open / draft=true / merged=null`、HEAD 与上述 CI 一致；生产 `0180～0188` 未执行，`HOMEFLOW_STUDY_SSO_ENABLED`、`HOMEFLOW_STUDY_GRAMMAR_ENABLED`、`HOMEFLOW_STUDY_LISTENING_ENABLED` 的新功能仍未获生产上线批准。
- **当前可确认为代码与自动化测试完成的独立 E 阶段模块**：个人生词本、任务、语言卡、SG/FE 考试与原 receipt 领取（0180～0186），个人语法（0187）和个人听力（0188）；**整个知学/四应用仍未完成**。旧 `0152_daily_word_reviews`、共享 localStorage/IndexedDB/待重试队列仍未按真实 HomeFlow 用户隔离，真实 iPhone 同机双账号、双设备断网及冲突测试明确 **待真机验证**。HomeFlow 审批、家計簿金融账户、文书助手共享与联动的所有原 PR 仍按 Draft 管理。
- 用户本人 Mac 的 A 阶段备份验收已另记第 10 节，但本回合严格遵循用户“未另行明确生产放行”的约束，不利用通过的 CI 或本地备份记录执行生产 D1/R2、合并、部署、新建 Preview 或开启开关。下一独立模块优先 `0152_daily_word_reviews` 用户隔离 + 真实原账历史领取，之后是端侧所有缓存/离线队列和完整跨应用 B～E。


## 13. 2026-11-14 知学第三个个人学习模块：每日单词复习（0189，Draft，待 CI）

> 同一原 [知学 PR #179](https://github.com/PTamako/it-study-platform/pull/179) / `feature/homeflow-identity-isolated-20261113` 接续；旧 0180～0188 的功能不重做，语法/听力的最终 CI 分别 [#43463935020](https://github.com/PTamako/it-study-platform/actions/runs/43463935020) 与 [#43466100589](https://github.com/PTamako/it-study-platform/actions/runs/43466100589)，各自 `completed/success`。此次只写功能 Draft 的新 SQL/Worker/Vue/测试、HomeFlow main 本 Markdown；**无生产 D1/R2 改动、无新开关启用、无合并/Cloudflare 部署/Preview**。

- 原 `0152_daily_word_reviews.sql` 的 `daily_word_reviews(word_key,streak,next_date,last_date,updated_at)` 仅单用户、缺 `user_id`；旧 `/api/daily-word-reviews` 以及 `src/App.vue` 的 `zhixue:daily-word-review-v1`、`zhixue:daily-word-pending-v1` 仍为旧单人本机/云同步，不得给 HomeFlow 成员开放。原数据不改、不删、不自动分配成员。
- 新 **未生产执行** `migrations/0189_homeflow_daily_word_reviews.sql` 新 `homeflow_daily_word_reviews` 复合主键 `(homeflow_user_id,word_key)`、本人 `streak/next_date/last_date/version` 乐观并发、真实更新者；`homeflow_daily_word_events` 保存真实 actor/单词/记住状态/来源迁移条数，审计不可变，触发器防跨人修改、无版本递增的更新、删状态/审计与同键不同内容的并发静默丢失，PK 作为 D1 查询复合索引。
- `worker/homeflow-daily-words.ts` 加本人独立 `GET /api/homeflow-study/daily-words`（指定最多 10 个已知单词或按 `word_key` 每页100条）、`POST /api/homeflow-study/daily-words`（服务端根据东京当天真实用户旧版本自行计算复习次数/下次日期，忘记隔天复习、记住按 1/3/7/14/30 天；CAS 防同一账号双设备覆盖；同日相同结果幂等重试，相反结果 409）、`GET /status` 和 owner-only `POST /legacy/adopt`。所有都先经 HomeFlow HttpOnly Cookie + 服务端 source-session introspection，额外 `HOMEFLOW_STUDY_DAILY_WORDS_ENABLED=true` 默认 OFF。browser `expected_user_id` **只作为切换账号/延迟写入保护**，真实 actor 权限只能由后端会话决定。
- 旧 owner 个人复习的已存在**当前状态**（非完整历史事件）需明确确认才能每页 20 条稳定游标领取。每页逐条验证日期/间隔/次数/词条格式，坏数据整批 409 无改动；同键不同状态 409，不覆盖、重复页不重计审计；原表和其 `updated_at` 完整保留，不虚构旧复习历史。member 既不能领取，也不能查询 owner 的数据。
- 新 `src/StudyHomeFlowDailyWords.vue` 只经已验证的 `StudyHomeFlowAccess.vue` 身份并以 `:key="'daily-words:'+identity.user_id"` 构建本人五词练习。调用已有 `static-learner-dictionary` 公共静态词典揭示词义，不增加私有长效存储；所有个人请求只走新 HomeFlow user-scope API，带 `expected_version`/本人 actor 栅栏，无 legacy localStorage/IndexedDB/离线待提交重播队列，切号立即丢弃本组件内存。旧单人 App 依旧保留并被独立 SSO 门槛隔开。
- 新 SQLite 真实双账号及本机 UI 回归位于 `scripts/homeflow-sso-isolated.test.mjs` / `scripts/homeflow-pwa-ui.test.mjs`：双人同词不同 streak、owner 旧状态唯一领取、同日重试/相反结果 409、旧账号迟到请求拒绝、版本检查、Origin/时间/非法游标、源会话失效、数据库不可变和脏旧历史 20+7 分批。旧 Worker data-URL test loader 仅增 503 stub。
- 真实本轮功能代码 Commit：`b29ac0079ff442b338808292526a0c9ec8ef3710` (0189)、`4dacb1c13581484112a910574b1f7d5243205c61` (server)、`935520eacea13dd54b923229b3a52f0f0d940fa1` (route)、`887f429b66aeb84276f782dff58c5fa3f5052791` (SQLite)、`0fecdba7f44a3772128e8b8b1de2960dc95cc140` (test fix)、`8649b2e85d7b51d20ab03ca3c638bc0ff315a09c` (PWA)、`3ff3f3baf1255a0cfa4ea790ab768c20739151a9` (词典 ID)、`cf896fda815fcae437ae390a5c70b67b34095380` (非法游标测试)、`8a8c99f4e30faa647fcacd67d7c4b6379db2ecc9` (用户挂载)、`93a1a9f050ab1a85b514579bbd19205cff8d8344` (旧 Worker stub)、`aeae3a7115f5ae705ca069f210149f6aa2b13404` (UI 安全回归)、`87f417f3247be5058034ffaf7bc691cf39073af8` (模块文档)。
- **新增模块本节首次写入时**完整 Validate [#43468872266](https://github.com/PTamako/it-study-platform/actions/runs/43468872266) 对应 HEAD `87f417f3247be5058034ffaf7bc691cf39073af8`，仍 `pending`，**不得虚报 CI 成功**；下一步必须查最终 regression/Vue build/D1 local migration/Worker dry-run，失败读取日志修复并复验。双账号 Safari 真机、离线恢复和双设备冲突 **待真机验证**。
- **真正未完成**：旧整站 `src/App.vue` 的无账号 localStorage/IndexedDB 与跨会话待重试请求尚未全量按人隔离，私人收藏和其余旧复习路径需排查，真实两机权限/跨设备离线一致性需验收；其他 HomeFlow #305/#306、家計簿 #309、文书助手 #97 的审批/共享/跨应用 B～E 仍未完。用户本机 A 阶段备份恢复第 10 节单独保留，**当前用户未授权生产迁移、上线或合并**，即使 CI pass 也必须全部保持 Draft。


### 13.1 每日单词模块真实最终 CI 成功（2026-11-14）

- 已核实 [知学 #179 Validate #43468872266](https://github.com/PTamako/it-study-platform/actions/runs/43468872266) 对应代码 HEAD **`87f417f3247be5058034ffaf7bc691cf39073af8`**，Run 最终 **`completed/success`**；job 内 **Run automated regression tests**、**Type-check and build frontend**、**Validate complete D1 migration chain locally**、**Validate Worker bundle without deploying** 四项均 **`completed/success`**。包含新 `0189`、实际 SQLite 双用户/并发审计/旧状态领取、词汇 PWA 安全测试。这是 GitHub Actions **隔离本地验证与 dry-run**，不是生产数据库迁移、Cloudflare 部署、iPhone 真机验收。
- [知学原 #179](https://github.com/PTamako/it-study-platform/pull/179) 实际核对仍 `open/draft=true/merged=null`，当前 HEAD 与上述成功 CI 精确一致。先前该分支多次中间 Run 的 `cancelled` 是新 Commit 的 PR CI concurrency 取消，不应误称失败/成功。
- **本轮独立完成并通过自动化的 E 阶段新增三个学习模块**：个人每日语法（`0187`）、个人每日听力（`0188`）、个人每日单词复习（`0189`）。既有 `0180～0186` 仍保留。所有新增 D1 SQL **仅文件、未生产执行**；三个模块默认额外关闭的功能开关、全局 SSO 均 **未经生产授权不能开启**。未合并、没有重建 Preview 或触发 Cloudflare 生产部署。
- **不能标记整个 E 或四应用项目完成**：旧主 `src/App.vue` 的 `zhixue:daily-pending-v1`、`zhixue:mock-pending-v1`、`zhixue:practice-pending-v1`、`zhixue:scenario-pending-v1`、`zhixue:daily-word-pending-v1`、旧语法听力 IndexedDB、私有词典收藏等仍共享端侧键。后续应优先做所有账号切换/退出/重授权的本机私有缓存空间及失败重试身份绑定，严格不能将旧管理员本机队列自动归属新成员。真实 iPhone Safari/PWA 双账号同机、两机断网恢复与同步冲突、原历史迁移总量/内容/归属、家庭跨 App 权限全链路及生产 D1/R2 恢复/回滚演练仍 **待真机/待用户上线放行**。
- HomeFlow #305/#306、家計簿 #309、文书助手 #97 的其余 B～E 仍未因知学 E 学习模块成功而宣称已完成。唯一交接文件的 §10 保留用户 Mac 本地 A 备份恢复验收结论，但用户本次开发指令未授予任何生产放行；**不执行生产迁移、不启用新身份、不合并可自动部署的功能 PR、不新建 Preview、不触发生产 Cloudflare 部署**。


## 14. 2026-11-14 HomeFlow #306：家庭审批执行失败的安全重试入口（已提交、CI 成功、未上线）

- 本轮已交叉检查四应用最新 Draft：HomeFlow **#305**（统一身份）、**#306**（家庭审批）、家計簿 **#309**（私人金融账户与家庭共享账本）、文书助手 **#97**（账号/权限）均 `open/draft=true`，未合并、不升级为 Ready；设计书 v1.1 已读取。HomeFlow 原 #306 的 `worker/approval-execution.js` 已实现实际后端 owner 授权的 `approved/failed_retryable → executing → applied`，使用同一审批 `request_id` 与家計簿私有 HMAC Service Binding 的幂等日志；不重复实现既有 0054/0055/执行器。
- 发现具体缺陷：原 `src/components/ApprovalCenter.vue` 的筛选可显示 `failed_retryable`，但前端仅对 `approved` 显示“执行入账”，因此 owner 遇家計簿响应丢失/目标不明确且后端合法返回 `failed_retryable` 时，无法在 PWA 使用**原审批 ID** 安全重试。旧的后端 `approvalExecutionRoute` 本来允许这两个状态，且有实际 SQLite/HMAC 测试证明失去目标响应后二次请求同一审批只入账一次。
- 原功能分支 `PTamako/homeflow`：`feature/family-approval-state-machine-20261113`（原 [Draft #306](https://github.com/PTamako/homeflow/pull/306)，base 仍是原 #305 开发分支）。实际代码 Commit **`2da637abad31c6c5a3411c5cd09ae48d37b3b42c`**：新增 UI `canExecute(item)`，仅真实当前 owner 且后端提供 `execution_enabled` 时，允许 `approved` 首次执行和 `failed_retryable` 安全重试；对于后者显示“安全重试”和独立二次确认提示“使用同一审批 ID 与家計簿的幂等记录核对结果，绝不新建审批或重复入账”。成员/待审批/拒绝/已生效/禁用 flag 仍无执行入口。所有按钮仍复用原 **`POST /api/approvals/{request_id}/execute`**，不直接写家計簿账本，不创建新审批，不轮询，不改变 DB schema/后端权限。
- 增 `tests/approval-center-ui.test.mjs` 检查 owner+执行开关+两种状态、失败重试 UI/确认、沿用原 ID、切换账号后不提交、禁止从 PWA 直写家庭财务。测试初次提交 **`14161c584fa1b4abeb4c77645574bc7f3f34e35b`** 后，[Validate #43470993395](https://github.com/PTamako/homeflow/actions/runs/43470993395) **failure**：799 测试中 798 pass，1 条测试中文文字断言与实际 UI 提示“同一审批 ID”不符；真实读取 Actions job 日志，确定不是后台执行器缺陷。修正断言 Commit **`842834a3ed2b3bedaf6e6b5d1c28460c22abc982`**。
- **最终完整 [HomeFlow Validate #43471186457](https://github.com/PTamako/homeflow/actions/runs/43471186457) 已核实 `completed/success`**，精确 HEAD 为 **`842834a3ed2b3bedaf6e6b5d1c28460c22abc982`**，job `Run tests and typechecked build` 成功。原 #306 再核对仍 `open/draft=true`，base 不变。旧后端已通过的“目标响应丢失→原审批 ID 重试→一笔账”数据库回归随全仓一起通过。真实 iPhone PWA UI 和跨服务正式执行仍 **待真机/隔离双服务端到端验收**。
- **安全边界未改变**：没有执行生产 `0053/0054/0055` 或家計簿 `0022～0026` SQL，没有更改/删除任何生产 D1/R2 数据，没有打开 `APPROVALS_ENABLED`/`APPROVAL_EXECUTION_ENABLED` 或其他 SSO 开关，没有合并功能 PR、修改部署工作流、新建 Preview Worker/D1/R2 或触发 Cloudflare 生产部署。本节通过已经验证的 HomeFlow **main 文档专用安全路径**更新，绝不将 Docs CI 通过或用户之前做的 A 阶段备份验证视为生产发布授权。生产放行仍需用户另外明确说明。
- **未完成**：家庭审批完整通知与跨应用状态反馈、执行结果长尾对账、全量私人金融账户稳定 ID 与完整统计/信用卡/SBI/储值卡旧资源映射、文书助手共享及跨账号联动、知学旧 `src/App.vue` localStorage/IndexedDB/离线队列切号隔离、双人 Safari 真机及断网恢复测试、跨四应用生产迁移和回滚验收。后续可检查家計簿 #309 的 `/api/internal/approved-actions/execute` 及文书助手 #97 权限边界，保持原 Draft 分支且每独立模块提交、CI、更新本文件。


## 14. 2026-11-14 文书助手 E/D 权限补强：成员审批前禁止跨 App 写入（Draft，CI 待最终结论）

> 最新 A 阶段准确结论按用户 **2026-11-14 明确确认**：四生产 D1 加密 SQL 备份+SHA-256、Mac 本地 SQLite 恢复 `integrity_check=ok` / 外键异常 0、R2 3 Bucket 共 6 对象 1,213,223 字节完整 Key/内容/元数据校验、Keka 7Z AES-256 解密比对、私人 Google Drive 回下载 `cmp` 全部 PASS。备份名 `A-stage-verified-cqf3T3.7z`，密钥仅由用户保管。本轮**不重复备份**。文书历史 2→0 由用户确认两份是其本人主动删除，**差异结案**。未演练 Cloudflare D1/R2 隔离恢复/生产回滚；尚**未获得生产 SQL、开关、自动部署或合并功能 PR 的授权**。

- 原 `PTamako/jp-document-assistant` [Draft PR #97](https://github.com/PTamako/jp-document-assistant/pull/97)、`feature/homeflow-identity-link-safety-20261113`；本轮从既有真实代码继续，不新建重复 PR。起点 HEAD `be6cecf1554191390ba78e60cc7511990b6c3f8b`、CI [#43440829210](https://github.com/PTamako/jp-document-assistant/actions/runs/43440829210) `completed/success`。原 0020～0022 PKCE/SSO 迁移和原文书共享附件功能保留，**均未上线**。
- 安全缺口 1：`worker/bridge.js` 原 `commitCandidate` 仅用 `document.owner_id===session.user_id` 作为资格，可导致家計簿/HomeFlow/知学桥接已配置时，member 向其他 App 直接写入而**没有 HomeFlow 审批**。本次后端强制 `p.role!=='owner'` 在任何目标读取、联动日志写入、远端请求发生前返回 409 `APPROVAL_REQUIRED`，明确 `approval_submitted=false` 语义，绝不假装创建 pending/approved/applied；`candidatePreview` 同时返回 `approval_required=true`、`approval_submitted=false`、`applied=false`、`available=false`，不去询问目标私人账户选项。该模块是**阶段 D 的 fail-closed 安全门槛**，不是已完成成员审批提交/执行。
- 安全缺口 2：共享文书旧 `GET /api/documents/:id/candidates` 读取了源 owner 的 `integration_links.remote_id` 与联动 payload/状态；成员即使只能阅读共享文书也不应继承来源人的私人金融/学习目标关联。现在 `worker/index.js` 在真正后端 `visibleDocument` 验证后，对共享协作者直接返回 `{items:[],shared_document:true,integration_access:false}`，不读取原 owner 的跨 App 私人候选；原 owner 正常查看候选及历史、共享双方正常读/改共享文书功能维持不变。
- `web/src/App.vue` 确认弹窗展示简短明确的「需要 HomeFlow 管理员审批，当前尚未提交申请，也没有同步到目标应用」，且成员无法点击直接同步按钮；不能把 UI 禁用当成后端授权。
- `tests/worker.test.js` 新增真实内存 SQLite 双用户回归：共享协作者可查看文书但看不到 owner 私人联动候选和 remote ID；原 owner 保留私人历史且共享成员不能猜 candidate ID 预览/查状态/提交；成员自己文书的跨 App 提交即使三个 bridge 均已配置映射/Service Binding，也强制 409、目标调用次数 0、`integration_links` 不增加、`audit_events` 不伪写，重复请求同样不能入账。
- 已保存的实际 Commit：`b24daec30c8f424538348de1e43b5870fa5998d0`（跨 App member 后端拦截）、`4e67480327680a75abf88d948164fa9bc37f13e0`（共享源 owner 私人候选隔离）、`bf2a0945470c7df2fb413facde3e090095d9b4fe`（PWA）、`acd9b1f19c729e63b0a41c7374180c5390a1cc19`（真实双账号测试）、`a3e4801ed74abd747ece115b23a1852e8cf6e846`（明确按 finance 候选测试）。
- 最新 PR CI [#43472214204](https://github.com/PTamako/jp-document-assistant/actions/runs/43472214204) 对应上述 `a3e4801...`，**本节首次写入时尚未最终核验**；必须按 GitHub 最终 status/conclusion 核验，失败读取真实日志修复。之前代码层 run 成功不能代替包含新测试的最新 CI 通过。
- **剩余未完成**：成员文书候选经 HomeFlow 签名创建申请、批准后在实际目标独立账号权限下执行、状态 `pending→approved→executing→applied` 幂等闭环、失败重试与回执核对、源 member/target actor 归属防越权、跨应用真实双机 PWA；HomeFlow #305/#306、家計簿 #309、知学 #179 的 B～E 也没有整体完成。不得因新增门槛完成就标记审批引擎实现完毕。本轮所有功能 Draft、开关 OFF、没有生产 D1/R2 操作、部署、合并或 Preview。


### 14.1 文书助手成员审批安全门槛 CI 最终成功（2026-11-14）

- 已实际查询 [文书助手 Draft #97 CI #43472214204](https://github.com/PTamako/jp-document-assistant/actions/runs/43472214204)，精确代码 HEAD **`a3e4801ed74abd747ece115b23a1852e8cf6e846`**，工作流最终 **`completed/success`**，唯一 `test` job `completed/success`。包含新增真实 SQLite 两用户私有候选/同步权限、零远端调用和 PWA 代码的全仓预合并检查。原 PR 再核对 `open/draft=true/merged=false`；成功不等于生产部署或 iPhone 真机验收。
- 同一轮只读确认 HomeFlow Draft #306 的新 owner 执行/安全重试 UI HEAD **`842834a3ed2b3bedaf6e6b5d1c28460c22abc982`**， [Validate #43471186457](https://github.com/PTamako/homeflow/actions/runs/43471186457) **`completed/success`**；此项系另一条开发的已有模块，本次不重复修改。家計簿 Draft #309 的旧双账号权限、同名账户/共享统计回归也已存在，不重复实现。
- **可标记已完成的仅是本次 E/D 权限门槛代码与自动化测试**：非 owner 不能经旧文书桥接绕过审批去正式写其他 App；共享协作者不能读取别人私人联动状态。**不可标记真正审批申请/执行闭环、全部文书共享、四 App B～E 或 F 完成**。后续开发签名申请、HomeFlow 执行授权、目标凭证校验、幂等回执和双 iPhone PWA 时必须单独提交并经 CI 验证。
- A 阶段由用户确认本地备份与恢复完成；§3/§10/§14 的准确口径已修正，旧历史段落只保留作审计，不可再以「A 待用户完成」作为当前状态。生产 D1/R2 隔离恢复/回滚演练仍未完成，用户尚未授予生产发布权限。本轮只通过 HomeFlow main 已保护的 `docs/**` 路径更新交接，无迁移、合并功能 PR、Cloudflare 部署、开关或 Preview 资源操作。


## 15. 2026-11-14 B～E 继续开发：审批 UI、家計簿切号保护、知学模拟交卷保护

> 继续使用原四应用设计书 v1.1、原有 Draft PR，不重复先前的身份服务、财务执行器、独立学习数据表。阶段 A：**用户已完成可恢复的加密四 D1/R2 备份、Mac 本地 SQLite 隔离恢复/完整性验证（§10），不再标记待用户完成**；Cloudflare 隔离恢复/正式回滚演练及本轮生产上线授权**仍未发生**。此节只记录 GitHub Draft 代码、自动测试、无生产写操作。

### 15.1 HomeFlow #306 / D：仅对真正已实现的执行器显示“执行入账”；异步审批列表隔离

- 在原 `feature/family-approval-state-machine-20261113` / [Draft #306](https://github.com/PTamako/homeflow/pull/306) 继续开发。发现原审批中心 `canExecute` 仅按 owner + execution_enabled + approved/failed_retryable 判定，导致 `document.sync.*` / 待办或未来其他操作已批准后错误出现“执行入账”。真正的 `worker/approval-execution.js` 只支持 `source_app=target_app=kakebo`、`operation=finance.entry.create`、`resource_type=finance_entry`。
- 新 `isSupportedExecution(item)` 与后台权限严格对齐；文书/任务等无执行器的工单只显示 **“已批准 · 待目标处理”** / **“目标应用未发生更改”**，不能点执行，更不能把批准伪装为已生效。已支持的家計簿受控操作仍保留安全重试原审批 ID。代码 Commit `19e7d8e520d9f5dcd0f13c1472278cee8ab67ef4`；UI/后端契约回归 `087a6a53714090d348d71027e2d01932016fe2a1`。
- 另外修复审批中心分页/状态筛选与账号切换同时发生时，旧网络请求可能把旧家庭审批内容写回或新筛选一直保持 loading 的问题。对 `discover/load` 增加 `requestGeneration`、账号/筛选/页码查询键、仅当代响应才能更新列表及 loading 状态；无需持续轮询或额外 D1 高频读。代码 Commit `03fbae4e808d6131d46e7000ab9089877e66ee1f`；测试 `f0b526e30c371189535da2051ae71a367af1cb42`。
- **精确最新 [HomeFlow Validate #43475287613](https://github.com/PTamako/homeflow/actions/runs/43475287613)** 对应 `f0b526e...`，已核实 `completed/success`。此前 UI 权限测试 [#43474816384](https://github.com/PTamako/homeflow/actions/runs/43474816384) 亦 `completed/success`。原 #305/#306 保持 Draft；没有启用真实财务入账或增加可执行操作类型。

### 15.2 家計簿 #309 / B～C：切号/退出时清除旧成员私有财务界面，阻止迟到保存响应污染新身份

- 在原 `feature/homeflow-sso-isolated-foundation-20261113` / [Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 继续，维持家庭账本和统计全家共享、个人设置各归其人、管理员可管理全体的既定权限。不改任何正式账本 entry/资产统计公式，不执行 D1 迁移。
- `src/FamilyFinanceAccess.vue` 的原 foreground 在 `busy=true` 时完全跳过复验，可能让旧账号私人余额/账户及编辑输入在 PWA 返回前台时继续显示。现在**不论上一个网络操作是否 busy**，前台恢复和 onUnmount 均立刻 `resetIdentity()`，隐藏 `person/accounts/totals/annual`，销毁上一个账号的编辑中状态、拟新建账户名称/类型，再从签名的 HomeFlow source session 重新验证。退出时先隐藏旧状态、使旧请求响应失效，再请求实际后台退出；失败不会谎报退出成功。
- 新建与修改私有金融账户前固定 `revision=epoch` 和真实已认证 `person.user_id`，远程完成后只有 epoch/user 同时未变化才能刷新/修改当前表单或显示当前错误；迟到响应不能清除新人的编辑内容。保持原有角色+owner 权限检查、乐观 `version`、后端鉴权。
- 实际 Commit `e4395c7794646c2890bf12db202d5785ad85ecff`、`d9389c1442045d2e05e9aa9cb5f2d982cee69507`、`e415445b133281a6dfdf24dff10c817183413a8e`（UI 静态安全回归调整）。**[家計簿 Validate #43476076111](https://github.com/PTamako/kakebo_jp/actions/runs/43476076111)** 精确 HEAD `e415445...`，已确认 `completed/success`。前一中间 Commit 的旧测试因原 foreground 断言不适配而失败，已更新回归并成功复验；不得把中间失败当作当前最终状态。
- 仍未完成个人信用卡/储值/SBI/固定费、余额全链路同名资源与账务审批执行；此改动仅修复账号切换安全。

### 15.3 知学 #179 / B～E：SSO 迟到身份响应 + SG/FE 模拟交卷原身份栅栏

- 在原 `feature/homeflow-identity-isolated-20261113` / [Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 继续。SSO UI `StudyHomeFlowAccess.vue` 的 `/status`、`/me` 若在退出/组件卸载后迟到，原先可能重新挂载上一位用户的私人学习组件。新增 `identityGeneration`：只接受当前 generation 的 status/me 响应，成功退出与 unmount 使旧读取失效，取消后绝不因为旧结果再次加载私人面板；仍只持久存 5 分钟的单次恢复 proof，不存 Token/个人学习缓存。代码 `ca97977c8012b479e2636469a14de6e7818c9c10`，测试 `52206086f0d42bb7fb5e05cb49de8374ce2e24a7`。
- 找到新 `worker/homeflow-mock.ts` 的模拟交卷仅依赖提交时 Cookie 身份，未校验请求原始所属 user；在 iPhone PWA 换号、离线重试或异步请求换会话后，旧 SG/FE 完整答卷可能提交到另一人。现强制 POST 含 `expected_user_id`，Worker 与**服务端重新 introspect 的真实 actor.user_id** 不一致立即 403 `ACTOR_CHANGED`，拒绝任何成绩、错题和事件写入；它不是从客户端取 actor 身份。`src/StudyHomeFlowMock.vue` 随提交记录当前 `props.userId`，重试前检查、切号后不接受上一 component 的迟到回执。复合主键 `(homeflow_user_id,submission_id)` 及同账号幂等回执保持原样，原模拟考 receipt 内容与旧数据完全不改。
- 代码 Commit `4006629e5fcedf1cd9861b46280991c782a7125c`、`912a3846cffa5edde02106d67b2454f4c11142b5`；真实 SQLite 双人测试 `1d12a36c249ed8b38594ead657c391685b2691e7` 核对使用另一账号旧 payload 返回 403、拒绝后数据库回执数仍为 0、原账号重试仅一份、不同用户可用相同 UUID 各自形成独立回执；PWA 安全回归 `f32692886e4d3cca7f69c565d48457315705df94`。知学新功能仍完全独立于旧共享 localStorage/IndexedDB，模拟考完整离线持久化尚未开发。
- [知学 Validate #43475655647](https://github.com/PTamako/it-study-platform/actions/runs/43475655647) 对应精确代码 HEAD `f3269288...`；**记录时状态：in_progress/pending**，仅最终 `completed/success` 才可标记新改动自动化验收完成。旧中间 CI 因随后提交 Commit 而取消不等同代码失败。

### 15.4 当前里程碑与后续安全开发边界

- 这是**三个独立可回归的安全/交互模块**，并非四应用 B～E 已全部完成；文书助手原 [Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) 上一次提交的共享候选隐私隔离/成员审批阻断仍有效，本轮未修改它。
- **尚未实现**：文书助手 member 真正安全签名提交审批并由目标执行；HomeFlow→文书/任务/知学执行器；家計簿全量信用卡/储值卡/投资/固定费同名账户映射与入账；知学旧整站共享本机缓存和 offline pending 队列双账号隔离，双 iPhone PWA OAuth/登出/断网/重试真机验收；完整 Cloudflare 隔离恢复/回滚与生产发布前新鲜备份。
- 所有原 PR 仍 `Draft`，所有新增功能开关 `OFF`，迁移 SQL **未执行**，没有合并会自动部署的 PR、没有生产 Worker/Pages/D1/R2 写入或部署、没有创建 Preview。A 本地验证 PASS 不代表用户允许执行 F。


### 15.5 最终 CI 核验与 Draft 保留（2026-11-14）

- **本轮新开发知学 #179 的最终 CI 已实际确认成功**：[Validate #43475655647](https://github.com/PTamako/it-study-platform/actions/runs/43475655647)，精确 HEAD `f32692886e4d3cca7f69c565d48457315705df94`，GitHub run `completed/success`。上一节 §15.3 记录的 `in_progress` 只是提交交接时的中间状态，现以本段最终核验为准；两人模拟交卷 actor 防串号、PWA SSO 延迟结果失效、全仓测试均经此 CI 验收。真实 iPhone PWA/生产环境仍未验收。
- **HomeFlow #306 最终 CI**：[Validate #43475287613](https://github.com/PTamako/homeflow/actions/runs/43475287613)，精确 HEAD `f0b526e30c371189535da2051ae71a367af1cb42`，`completed/success`；**家計簿 #309 最终 CI**：[Validate #43476076111](https://github.com/PTamako/kakebo_jp/actions/runs/43476076111)，精确 HEAD `e415445b133281a6dfdf24dff10c817183413a8e`，`completed/success`。文书助手 #97 未在本轮修改，继承此前已验证的 [#43472214204](https://github.com/PTamako/jp-document-assistant/actions/runs/43472214204) `completed/success`。
- 本文 §15 首次文档-only 提交为 HomeFlow main `d4c0cc1a16c2d335f587330f61da9fe6ed283982`；[该提交 Validate #43476442379](https://github.com/PTamako/homeflow/actions/runs/43476442379) **`completed/success`**，没有借文档变更合并/部署功能 PR。
- 已再核对三个当前开发 PR：HomeFlow [#306](https://github.com/PTamako/homeflow/pull/306)、家計簿 [#309](https://github.com/PTamako/kakebo_jp/pull/309)、知学 [#179](https://github.com/PTamako/it-study-platform/pull/179)；以及未改动的文书助手 [#97](https://github.com/PTamako/jp-document-assistant/pull/97)：**均为 `open/draft=true/merged=false`**。HomeFlow #305 属既有身份基础依赖，本轮不合并。文书助手真实 member HomeFlow 提交审批+目标独立执行器、家計簿全部资产类别/固定费同名 ID/历史金额校验、知学旧主界面的本地缓存/队列全隔离与真实 iPhone 多人验收仍未完成；不能标记整个 B～E 完成。
- 阶段 A 用户在 Mac 的加密备份+本地 SQLite 恢复验收已通过，**并非 A 待用户完成**；Cloudflare 独立恢复演练/生产回滚及正式上线尚未经单独授权。本次没有运行生产 SQL 或动生产 D1/R2、没有打开 SSO/审批新开关、没有合并可部署功能 PR、没有创建 Preview、没有执行 Cloudflare 部署。交接文档此轮再补记同样属于 `docs/**` 范围，等待本次最新 docs CI 独立验证。


## 16. 2026-11-14 阶段 D/E：文书助手成员真实签名创建 HomeFlow 审批（Draft，未执行到目标）

### 恢复状态和范围

- 本轮开始时已实际核对四应用原 PR：HomeFlow #305、#306，家計簿 #309，知学 #179，文书助手 #97；原有代码/身份协议/签名的家計簿现金入账执行器/知学 0180～0189 均保留，不重新实现。继续开发**文书助手 member 审批的可信申请链**，依赖原 HomeFlow #306，保持全部原 PR Draft。
- 阶段 A 用户本人完成四个生产 D1 SQL 加密备份、Mac SQLite 本地隔离恢复、6 个 R2 Key/原内容 SHA-256/元数据校验、私人 Drive 最终包回下载 cmp，**已 PASS**（见 §10）；不要重新标记 A 待用户完成。Cloudflare D1/R2 隔离恢复/完整生产回滚和发布授权仍**未进行**。本轮仅变更 GitHub Draft 源代码、迁移 SQL 文件、自动测试、说明书和 HomeFlow main 的唯一交接文件；**生产 D1/R2 数据与 Worker/Pages 部署、开关、Preview 全部未动**。

### 16.1 HomeFlow #306：文书源后端专用签名申请接口

- 原 Draft [#306](https://github.com/PTamako/homeflow/pull/306) 新增 `worker/document-approval-submission.js`：独立 **`POST /api/internal/approvals/document-submit`**，在 `worker/index.js` 的浏览器 Session 之前拦截。仅 `APP_ENV=production` + `APPROVALS_ENABLED=true` + `DOCUMENT_APPROVAL_SUBMISSION_ENABLED=true` + 配置**独立于家計簿**的 `DOCUMENT_APPROVAL_SUBMISSION_SECRET`（64 hex / 32-byte raw）才开放；当前全为 Draft/未启用。专用 `X-Approval-Client=jp-document-assistant`，用 `jp-document-assistant\n{stamp}\n{raw_json}` HMAC-SHA256，±5 分钟，有固定 JSON 大小和严格请求字段白名单；Cookie/Origin/Bearer、错签名、过期、未知 client 拒绝，不接受原文/金额/账户、任意 SQL 或 URL。
- 后端从目标白名单派生操作：`kakebo→document.sync.finance`、`homeflow→document.sync.homeflow`、`it-study-platform→document.sync.study`，固定 `source_app='jp-document-assistant'`、`resource_type='document_sync_candidate'`、`idempotency_key='jpda:sync:'+candidate_id`，由**真实 HomeFlow `household_members`** 复验 member 账号活跃状态和 household。复用 0054 原 immutable request/append-only actor 审计，成功后再次逐字段对照原 D1 审批行，丢包/重试返回同一 request ID，不可改 payload digest 或目标以重用旧 key。
- **独立 HomeFlow 真实内存 SQLite+签名回归**：`tests/document-approval-submission.test.mjs` 覆盖 3 类目标、同 ID 同 digest 幂等一次入库与一次 actor audit、换 target/digest 冲突、错户/禁用/owner/伪造签名/多余敏感字段拒绝。代码 Commit `674524e5b034ae1d0945d857025adb273a4166f2`、`5ddb0f5e89bd1c9af7341da4edebc0b68b7e514d`、`4d987e7fcd078cc579f9a71989c5c6300ca4508d`；**[HomeFlow Validate #43477988014](https://github.com/PTamako/homeflow/actions/runs/43477988014) `completed/success`**，精确 HEAD `4d987e7...`。已追加协议文件说明 Commit `aa969076b9f4e01e2543fa47738bbafb20b5710e`，该文档提交的 CI 状态仍需单独核对。
- **绝不能把这段提交当成目标已执行**：HomeFlow 原审批中心针对 `document.sync.*` 禁止“执行入账”按钮，此时只有原家計簿受限 `finance.entry.create` 具备真正目标执行器。文书 3 种目标的安全执行器、回执确认、失败对账和真正联动仍未实现。

### 16.2 文书助手 #97：私有冻结候选 + 签名提交 + PWA 申请 + 丢包原快照安全恢复

- 原 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)、`feature/homeflow-identity-link-safety-20261113`；新 **未生产执行** `migrations/0023_document_member_sync_intents.sql` 只新增私有 `document_member_sync_intents` 表，`candidate_id` 唯一、一候选一冻结申请，存原文书/候选版本、真实 local 和 HomeFlow actor、目标、已核验最小业务 payload 与 SHA-256，SQL trigger 禁止改写关键字段/恶意删除或撤回已确认提交。**不复制原文/R2 到 HomeFlow**，旧 `documents/action_candidates/integration_links` 不重写；有候选审批的硬删除暂被安全拦截，后续需设计取消和归档处理。
- `worker/document-member-approval.js` 新的 CSRF 保护 `POST /api/candidates/:id/request-approval` 和本人 `GET /api/candidates/:id/approval`；必须原 `requireSession` 真正 HomeFlow session introspection 成功、`p.auth_source='homeflow'`、`p.role='member'`，候选真实 `owner_id=p.user_id`、文书 active、同 household、此前没有目标联动尝试。与管理员直接同步共用 `validatedPayload` 业务字段校验，但**不会调用家計簿/HomeFlow/知学目标写入**。未有完整权限/审计执行器时，管理员原 `commitCandidate` 保留，普通 member 直接调用旧 `commit` 仍 409 `APPROVAL_REQUIRED`。
- 成员点击确认后先本地保存 immutable payload、hash、原始 owner/版本，再经现有 `HOMEFLOW_BRIDGE_SERVICE` Service Binding + **独立 `DOCUMENT_APPROVAL_SUBMISSION_SECRET` 解码后的 32 bytes HMAC** 签给 HomeFlow，只发送 `household_id/requester_user_id/resource_id/payload_sha256/target_app`。后端完整校验 HomeFlow 回执的一致身份、原 candidate、digest、目标、真实状态及 `applied=false/target_changed=false`，再 CAS `prepared→submitted` 与一次实际 member audit；不把 pending 当 applied。早期测试定位签名库差异：旧文书助手 `hmacHex()` 使用 UTF-8 Secret，而 HomeFlow 审批使用 hex 解码后 32 raw bytes；**修复用正确原始 bytes 进行 HMAC**，相关单测已成功。
- 网络失败/远程响应不确定时本地保留 `prepared` 和唯一 hash，不假称已发送、不写目标；`resume_existing:true` 仅成员本人显式重发**原始冻结快照**，核对 document version、candidate timestamp、原 actor/household、存储 SHA-256，绝不重新使用变化后的 UI 字段暗造第二份工单。HomeFlow 以稳定 ID+digest 返回原审批，拒绝不同内容。PWA `web/src/App.vue` 增“提交 HomeFlow 审批”、“已提交待审批”、“重试原申请”三种明确状态，后台未配置则按钮禁用；原 owner 直接同步仍单独逻辑，成员金融分类/账户只作待审批草稿，尚未目标校验，也没有“同步成功”虚假提示；切换 App 账户清理本机审批状态并丢弃过期请求结果。
- 文书助手真实 HomeFlow SSO 双人 SQLite/私有 Service Binding mock 回归在 `tests/homeflow-sso.test.js`：在 owner 领取旧文书、member 新空白账号后，member 准备私人 vocabulary 候选、独立 HMAC 验证、只向 HomeFlow 送 5 个无 PII 字段、一个 approval id、不生成 `integration_links`、审计一次、不同快照 409、prepared 网络丢包后原封 hash 重试、SQL 触发器不可改；旧密码/owner 不得提交。PWA 安全回归 `tests/document-member-approval-ui.test.js`，旧 UI 静态测试改为基于真正 computed Guard（`tests/2026-11-13-audit.test.js` / `tests/release-preflight.test.js`）。完整文档 `docs/document-member-approval-stage-d.md` 已写入。
- 关键新增代码 Commit：`5f7afdf6c1d088def8b89a1bd6519ff6bd725d46` (0023)、`0d2835f9658d6265fe4f0159f223f77eb5195d40` (payload 校验复用)、`24f1780df23d846dedd178c1b7ef2e814ec98e25` (member backend)、`446ab2eb38cf182120ca31b6f9f384bfd138ea9b` (API)、`8f92d37a69b54da5b25062b247c2df5857fba76f` (preview)、`5990fdf466cd62310ecc8b2f4c8cfe20a6acf87f` (PWA)、`dfd2c5bb4e3678f809e7374c1d813fed42927448` (HMAC raw bytes 修复)、`4f015cba5b72e7b59a53e819a18924fba18b8e94` / `713cdcc25bfa710ed27355688c68bd70a1e48111` / `cc8789e4fa3c2921ac304da92d53f843788fdbdf` (冻结回执恢复)、`1f33bc2ba22802ca58a3adfa95ffbc5f6565bac9` / `4daf233607f4256d6c8358b0fe9ad4e80416bb74` (测试)、`014fa9593a5438a282de8c7e309eee7a30dd33dd` (协议说明)。
- **最终确认 [文书助手 Pre-merge CI #43480714408](https://github.com/PTamako/jp-document-assistant/actions/runs/43480714408) `completed/success`**，精确 HEAD `014fa9593a5438a282de8c7e309eee7a30dd33dd`；[CI #43480520151](https://github.com/PTamako/jp-document-assistant/actions/runs/43480520151) 对应此前最后测试 Commit `4daf233...` 同样 `completed/success`。早期开发中的失败 CI 已按真实 job logs 查出两项：①成员签名按 UTF-8 hex 导致失配，已修复改 raw hex bytes；②原 UI 静态断言依赖旧 inline 表达式，已改成同等真实 computed 安全校验。不能把中间失败当最终状态。

### 16.3 未完成与禁止动作

1. **尚未打通**：owner 审核同意后的文书专用执行器、与三个目标 App 的受信账户/角色签名验证与权限约束、可持续对账及补偿、HomeFlow 审批状态对文书实时反馈/通知、来源文书永久删除与取消后的完整清理、两台 iPhone PWA/同机双账户实际操作/断网真机验收。旧 HomeFlow 文档审批类型批准后**只能标记 approved，不能宣称 applied**。
2. 家計簿 #309 的信用卡/储值卡/定投/SBI/固定费及余额全量迁移和历史完整一致性、知学 #179 的旧 `src/App.vue` 共享本地缓存/离线重试队列按用户隔离，以及整体 B～E 冷启动/改昵称/撤销/切号仍待开发。文书助手的成员财务账户选择目前只能填审批草稿，不等于目标账户已经验签并允许扣记。
3. 本轮原 HomeFlow #306、文书助手 #97 **都保持 open/Draft/未合并**，新 0023/0053～0055 SQL 文件未应用生产；三个应用专属 Secret/flags 没有实际配置/开启，没有合并/部署生产、新建 Preview 或操作原 D1/R2。阶段 F 独立批准/Cloudflare 恢复演练仍未开始，A 本地备份 PASS 不自动解锁 F。


## 17. 2026-11-14 B～E 增量：文书审批可信状态回读（不执行目标应用）

> 本轮继续使用原 §16 两个 Draft 功能 PR，不重复实现已通过的签名提交/私有冻结快照；**A 用户 4 个 D1 + 6 个 R2 的加密备份及本地 SQLite 恢复校验已 PASS**，不是“待用户完成”。但是 Cloudflare 隔离恢复/回滚与生产迁移授权仍未提供，仍没有任何生产写、部署、新开关或 Preview 创建。

### 17.1 HomeFlow #306 / D：新增文书来源 read-only 状态后端

- 原 [HomeFlow Draft #306](https://github.com/PTamako/homeflow/pull/306)，branch `feature/family-approval-state-machine-20261113`；新 `worker/document-approval-status.js`，经 `worker/index.js` 在浏览器 Session 之前路由为 **`POST /api/internal/approvals/document-status`**。
- 与提交申请的 HMAC purpose 强隔离：专用 32-byte raw key（环境 `DOCUMENT_APPROVAL_SUBMISSION_SECRET` 的 64 位十六进制形式）签 `jp-document-assistant:status\n{timestamp}\n{raw_json}`；原 `jp-document-assistant\n...` 提交签名不能用于查询。拒绝 Cookie/Origin/Bearer、非法客户端、过期毫秒时间戳、签名不符、多余字段。
- 严格只允许 6 个键：`approval_id/household_id/requester_user_id/resource_id/payload_sha256/target_app`；后端检查 HomeFlow D1 中现存活跃 `member`，并以真实 immutable approval row 逐项绑定 household/actor/source/target/operation/candidate ID/digest/version/幂等键，避免别人的审批 ID、跨户、改摘要或目标被查询；只读，无 D1 audit 热写，无目标 Worker 写/执行、无密码/PII 输出。
- 真实 `pending/approved/rejected/cancelled/expired/failed_final/conflict` 状态返回前明确 `applied:false,target_changed:false`。已批准 **不是已同步**。遇到本阶段不受支持的 `executing/applied/failed_retryable` 状态，返回 503，不冒充已完成；原 `0055` 数据库 execution lease trigger 本身禁止无真实 claim 直接转 `executing`。
- `tests/document-approval-submission.test.mjs` 追加独立 HMAC 状态测试、真实两成员 SQLite pending→owner approve/reject、跨户、禁用用户、签名错/复用提交签名、字段摘要篡改、只读无新写及 D1 lease 禁令。相关代码 Commit `f9583afc14e53a3399fa13eca021f57083124a8a`、`39a413b96809623d91124346b32b1cb458949223`、`df0e86ac8acdf8a233fd64e14bbd86c2f292e481`、`665f7bdb42c2655ec0116c704d3b0a862a98e0f7`、`eba048344a25b5b18bedb07ea40f549c0090311d`（修复测试对 lease trigger 的误假设），协议文档 `bbcb7da52d1c7fdc83ce788fff9b34fb16b80169`。**精确当前 HEAD [HomeFlow Validate #43484026954](https://github.com/PTamako/homeflow/actions/runs/43484026954) `completed/success`**。
- 注意：状态路径沿用原 `APP_ENV=production` + `APPROVALS_ENABLED=true` + `DOCUMENT_APPROVAL_SUBMISSION_ENABLED=true` + Secret；这些旗标仍未在生产开启。未添加触发器、定时器或新的 Cloudflare 资源。

### 17.2 文书助手 #97 / D/E：成员本人按需读取真实审批状态并防伪回执

- 原 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)，branch `feature/homeflow-identity-link-safety-20261113`；更新 `worker/document-member-approval.js` 的本人 `GET /api/candidates/:id/approval`：严格用原 HomeFlow SSO 每次在线 introspection，验证本人 `local_user_id/homeflow_user_id/household_id`、文书/候选 `owner_id`、当前 target/kind 以及本地 `approval_id`。尚未提交的不调用 HomeFlow；`prepared` 只返回“上次提交未确认”。
- 当且仅当原申请 `submitted` 时通过已有 `HOMEFLOW_BRIDGE_SERVICE` Service Binding 签名 POST 六个字段的只读请求，不发送文书原文、金额、词句或目标凭据。对 HomeFlow 响应重新校验全部身份、hash、target、ID、`status` 白名单、`version>=1` 且 `applied/target_changed` 必须仍为 false；离线、伪造状态、非 200 或目标改写返回 **503 `APPROVAL_STATUS_UNAVAILABLE/UNCONFIRMED`**，不会使用本地缓存伪装为成功，也不写 `integration_links`。
- PWA `web/src/App.vue` 增“**查询 HomeFlow 审批状态**”用户明确点击的一次性读取，无轮询/Cron。区分 Pending/Approved/Rejected/Cancelled/Expired/Conflict，approved 用“**管理员已批准，但目前尚无此操作的安全执行器，目标应用没有同步**”；晚到响应必须仍是同一 `accountEpoch`、candidate 和 document 才可更新，不跨账号展示。未获可信状态时明确“尚未确认”。
- `tests/homeflow-sso.test.js` 在原 owner/member 双人 SQLite 和 mock signed Service Binding 基础上增加目的域隔离 HMAC、pending→approved→rejected、篡改摘要/上游断网 503、无 `integration_links` 写入与不计额外 D1 audit；`tests/document-member-approval-ui.test.js` 新增显式手动状态检查、账号 epoch 保护、审批不等于执行等静态守卫。关键 Commit `8658982ed2e2d212781d089ae2ed5ef221823091`、`870d2ffa22d91e8bcde835a29efa98e4d365bb20`、`8a7a9bc25bd03c0c978c9435c5c8f1c5a4bf2a52`、`1a92565772f70221680282a00d9147ee1928f972`、`2a47ea7627b2349fbe79e0ad82530ce9c4ba0075`、文档 `8f589a8b4ac0632513f15799d814be579da7aa47`。
- **文书助手最新经验证全部代码 [Pre-merge CI #43483869065](https://github.com/PTamako/jp-document-assistant/actions/runs/43483869065) `completed/success`**，精确代码 HEAD `2a47ea7627b2349fbe79e0ad82530ce9c4ba0075`；后续 doc-only Commit `8f589a8...` 的 [最新 CI #43484105439](https://github.com/PTamako/jp-document-assistant/actions/runs/43484105439) 于本段交接写入时 **尚待最终状态复核**，不得夸称它已通过。早期中间失败测试（旧 mock 不支持 status、静态断言仍查旧提示文字）已更新后完整代码 CI 成功。
- 整体仍是 Draft 单独模块，**不是 HomeFlow 批准→财务/任务/知学真正执行**；真实目标账户和用户映射、受签名目标执行器、幂等应用确认、失败/撤销补偿、真机断网/切号/Google OAuth 验收以及 Stage C 资产全链路账户 ID、知学 legacy 本机缓存隔离仍未完成。阶段 F 与生产授权始终分离。

### 17.3 部署保护与下一步

- HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 **全部继续 Draft、不得自动合并/部署**。正式 D1 `0053–0055/0023` 等只以 SQL 文件形式存在，未执行；HomeFlow/文书专用新 Secret 未配置/启用，生产 Worker/Pages/D1/R2 和 Preview 均未操作。
- 下一安全模块可以选择：① 文书 HomeFlow 审批关闭/取消后本人 UI 状态对齐 + 不可变快照终止策略；② 目标端各自可签名的审批执行适配器与不可复用回执；③ 家計簿完整金融账户稳定 ID/全资产统计；④ 知学旧离线队列双账号安全隔离。每一项都必须独立测试、保持 Draft、逐次更新本交接文件。

## 18. 2026-11-14 B/E 继续开发：知学考试/语言写入 actor 栅栏与旧缓存访问隔离

> 继续原四应用设计 v1.1、唯一交接文件和原有 Draft PR；不从头重做已通过的 SSO、HomeFlow 审批申请或家計簿资产账本代码。本轮集中修复 **知学 PR #179** 的账号切换防串号与旧单用户缓存访问控制。用户已经完成 **A 阶段四个生产 D1 与三个 R2 Bucket/六对象的加密备份、Mac SQLite 本地恢复、哈希及 Drive 包一致性 PASS**，无需再次备份。Cloudflare 隔离恢复/正式回滚和生产迁移/上线仍**未批准**。

### 18.1 E：知学六类写入强制绑定请求原始 HomeFlow 用户

- `PTamako/it-study-platform` 原 [Draft #179](https://github.com/PTamako/it-study-platform/pull/179)、branch `feature/homeflow-identity-isolated-20261113`。上一轮已完成的独立 daily task/grammar/listening/daily words、历史 adopt、SG/FE 模拟交卷原身份校验全部保留。
- 审计确认 `worker/homeflow-exams.ts` 与 `worker/homeflow-language.ts` **六个 POST 原先只依提交时的有效 HttpOnly HomeFlow cookie 归属 actor**；在 iOS PWA 多窗口切号、慢网络/重试时，旧答题或旧来源 adopt 可能在新的 Cookie 下被错误记入新账号。现在 `attempts/history/legacy/adopt` 与 `mastery/review/legacy/adopt` 都必须带 `expected_user_id`，否则或与服务端即时 `verifiedStudyActor` 得出的 `actor.user_id` 不一致就**403 `ACTOR_CHANGED`，在任何 D1 写入/审计/导入之前拒绝**。actor 依旧严格从服务端 HomeFlow 会话取得，绝不信任客户端值作为真正 actor。仅增加请求归属栅栏；原 SQLite 主键、乐观版本、UUID 幂等和旧历史只复制不删除保持原样。
- 对应新 PWA `src/StudyHomeFlowExams.vue`、`src/StudyHomeFlowLanguage.vue` 的每次答题、成绩、语言掌握、复习重试及 owner-only 导入均带当时的 `props.userId`；若组件当前用户已更换，禁止原请求重发，丢弃旧 generation/epoch 的延迟回执。还修复了语言卡 `setMastery` 失败后 `load()` 自增 epoch 导致 `busy=true` 永不释放的卡住问题。
- 真实 SQLite 双人回归 `scripts/homeflow-sso-isolated.test.mjs` 补六条**原账号不符/缺少声明用户**的 403，并核对全部私有考试、语言状态与 audit 行数不变；现有真实成功写、重复 UUID 幂等、owner 单独 adopt 与所有旧数据完整性测试仍保留。PWA `scripts/homeflow-pwa-ui.test.mjs` 加原身份一致性与迟到回执丢弃的静态守卫。

### 18.2 B/E：旧主人的 localStorage 原样保存，已登录 HomeFlow 时不再自动展示/认领

- 原 `src/App.vue` 旧单密码知学缓存如 `zhixue:tasks:*`、`exam-records`、`mock/practice/scenario/daily-word-pending` 全是**无身份归属的旧存储**。绝不能把本机/昵称/现在 HomeFlow 用户误当原记录主人；也不能为了切号直接清空用户旧学习数据。
- 本轮新增轻量 **`zhixue:legacy-cache-quarantine-v1` 非机密访问标记**。App 首次打开/返回前台时通过 `/api/homeflow-sso/me` 的真实服务器身份判定是否存在 HomeFlow 当前用户；一旦验证成功，**立即隐藏旧主人的全部单密码学习视图**、清空旧密码输入、递增旧 hydration generation、保留 localStorage 原字节；关闭或退出 HomeFlow 后，即使旧 cookie 尚有效，仍需要**明确用旧密码登录成功**才可打开旧历史学习空间，不能自动把旧记录展示给新成员。对网络检查不确定/200 无合法 actor 的情况保留 fail-closed access lock。旧密码登录完成后才清除此非机密标记；与新账号无关。
- `src/StudyHomeFlowAccess.vue` 通过 `identity-changed` 向 App 报告真实验证后的 actor。在 iPhone PWA 从后台返回前台时先隐藏原个人面板，再重新发在线 SSO check；延迟的旧 `/status/me` 响应不能挂回上一人。没有把旧队列提交到 `/api/homeflow-study/*`，没有把旧缓存自动清理或认领为新成员学习数据。
- **重要限制：本轮是旧缓存访问隔离，不是旧 `src/App.vue` 每个 localStorage key、旧离线待同步队列、旧 UI 组件和正在执行的旧异步请求的完整重分区**。旧 PWA 本机缓存只在显式旧密码空间使用；完成全部 key-by-key owner-proof/IDB 隔离、两台 iPhone 真机多用户/换号/断网验收之前不得宣称整个 E 完成。文档 `docs/homeflow-stage-e-legacy-cache-quarantine.md` 已在 Draft 分支创建。

### 18.3 精确提交、CI、生产安全边界

- 新知学主要 Commit（先后顺序）：`55a7c52cf64a229f1d7929805231c75d8aed412b`（exam 后端）、`53fe3c5f2fbd6e8d7660f7959684743960f14a72`（language 后端）、`83d1e043ae2dae41e9531684388ec2c6fbd07a01` / `691db9714d87b32cee9208287cbc98ce2545d4d8`（双 PWA）、`c24326cb291fd89c8bc7aa93988cc45cc01efd63` / `1c1cfb92a2b034e9dfae5a93186490e4e3efb262`（fixture + 六条 SQLite 拒绝测试）、`dc3fbf8cf499b182bd95ed44c3ff8e0ef8424681` / `c5527b3634fd807dbf8915e3877529eeafa841ea`（busy lock + PWA 回归）、`f1f550702fb8d913f2d6d5be1e4472ddd47395b2` / `31fb20d5ff506ec75b9455d46366f463d5cfcd5f` / `8afdae66bc77a6fb9b0da4929d1105e5780ee0d9`（HF 切号通知、legacy 访问隔离、测试）、`14d40fb63bbddc4546aea9d6a80b191fa3873a93`（文档）、`6d2a6a80dd19d17da1f45cf790dadd5bc6a8c2c7` / `8b13764b29553c2c329d5ae43bf2f67db395cc8d`（不确定身份 fail-closed + 测试）。
- **注意 CI 状态：本节首次记录时，最新完整 [知学 Validate](https://github.com/PTamako/it-study-platform/actions?query=branch%3Afeature%2Fhomeflow-identity-isolated-20261113) 尚未对精确最终 HEAD `8b13764b...` 返回 `completed/success`；前面多次 CI 因新 Commit 取消，属于中间态，不能据此宣称通过。必须等最新 CI 真实结果后在本交接文件追加最终核验记录。** 此前基线 [知学 #43475655647](https://github.com/PTamako/it-study-platform/actions/runs/43475655647) completed/success，但该基线不涵盖本轮。
- HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 继续维持 **open/Draft/未合并**，不执行生产迁移、不启用身份或审批新开关、不部署 Workers/Pages、不动四个生产 D1 或 R2 对象、不创建 Preview。原 A PASS 不代表允许执行 F。后续优先继续独立目标执行器/家計簿金融稳定 ID/旧 App 完整队列隔离和真机 E2E；每模块独立绿 CI 再交接。


## 19. 2026-11-14 B～E 增量：家計簿账户创建与修改原 actor 栅栏

> 继续现有家計簿 Draft #309，与 §18 知学账号切换防串号模块并行。两个模块分别修改独立仓库的现有原 PR，没有改生产数据/部署；没有跨仓 cherry-pick 或合并。**A 阶段用户加密备份 + Mac SQLite 本地恢复/哈希、Google Drive 验证全部 PASS，非待用户完成；Cloudflare 隔离恢复演练及 F 上线授权仍未进行。**

### 19.1 家計簿 #309 / C：金融账户设置切号后不能把旧操作写给新 HomeFlow actor

- 原分支 `feature/homeflow-sso-isolated-foundation-20261113` / [Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)；`functions/api/family-finance/[[path]].js` 的 `POST /accounts` / `PATCH /accounts/:id` 现在都检查 **`data.expected_user_id===user.user_id`**，真实 `user` 仍是每请求重新 introspect 的 HomeFlow 身份。这是**原始操作防串号栅栏**，不是用客户端字符串覆盖服务器已验证 actor。错误/缺少原 actor 在 D1 设置/审计写入前 403 `ACTOR_CHANGED`，任何 owner/member 的原授权范围保持原样。
- `src/FamilyFinanceAccess.vue` 的新建、修改账户 payload 增加最初已验证的 `person.user_id`；原 `epoch` 拒绝旧请求回执、`version` CAS、owner 管两人、member 仅本人、legacy 账户不能通过新 API 修改的安全门槛没有被删除。
- `tests/homeflow-sso-isolated.test.mjs` 双人 Cookie+实际 SQLite：旧成员 POST 在另一 Cookie 身份下被拒、没有原 user id 时拒绝、account create/update 失败前后表和审计行数不变；合法成员可增改账户，家庭 `entries` 所有旧明细字节保持不变。旧 test helper 仅对账户新建/编辑以其真实发放 Cookie 的 actor 自动填入最初 user ID，显式错误 ID 仍覆盖并测试拒绝。`tests/family-finance-ui.test.mjs` 追加前端/后端双向字段断言。
- 代码 Commit `1ee723f340c8f9d6e6835f95169f85b538978cd2`、`394a153db39eaebdd126419ebd22268dfc672048`、`6acddcc98878da8734370c7c2c04d44815239b63`、`e18323576a3b8f67fcdc9599563f215e31daab9e`、`6b66a66536ac238d620968f37324f59e7cbaf0cb`；后续追加文档-only `576af15e305e19fd95e22f65815a177ab3a79c98`（仅 Draft 内）。最新**精确代码 HEAD 的 [家計簿 Validate #43491760323](https://github.com/PTamako/kakebo_jp/actions/runs/43491760323) 已 `completed/success`**。Mobile WebKit Smoke 为独立流程，在最终检查前不要冒充已通过。
- **仍未实现完整 C**：旧信用卡/储值/SBI/定投/固定费/账单的稳定个人 ID 的全量无损迁移、全部旧写路由的权限与账户映射替换、家庭完整统计及真实双人 iPhone/恢复验证。此模块只针对新的个人账户设置创建/编辑安全，未更改正式家計簿记账交易、余额公式或生产 D1 数据。

### 19.2 与 §18 知学 Stage B/E 的关系

- 知学 `worker/homeflow-exams.ts` 和 `worker/homeflow-language.ts` 的六个 POST 原用户栅栏与家計簿账户设置相同设计：客户端声明原操作 actor，服务器永远以重新验证的 HomeFlow Cookie 决定真正 actor；错误在写入前拒绝。知学的 `zhixue:legacy-cache-quarantine-v1` 只防旧本机资料被新成员**自动显示/认领**，不删除旧资料；旧 App.vue 全量缓存/IDB/离线 pending 用户命名空间仍待实现。
- 本节提交时知学新代码完整 CI [Validate #43491407028](https://github.com/PTamako/it-study-platform/actions/runs/43491407028) 尚未最终完成；先前 [#43490495841](https://github.com/PTamako/it-study-platform/actions/runs/43490495841) 失败**仅因新 PWA 测试正则字面量斜线未转义 `SyntaxError`**，已经在代码 Commit `0e985b297aa8cbed6f6cecf864a212f3e2370107` 修正，后续只能在最新 run `completed/success` 后声称本轮成功。§18 文档-only [HomeFlow Validate #43490663447](https://github.com/PTamako/homeflow/actions/runs/43490663447) **已 `completed/success`**。
- **所有** HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 仍为 Draft，全部新身份/审批功能 flags OFF，全部开发 SQL 文件未在正式 D1 运行，未合并会生产部署的 PR，未在生产 Cloudflare Workers/Pages/D1/R2 做写操作，未创建任何 Preview。真实 iPhone PWA、Cloudflare 独立恢复/回滚、生产 F 上线审批分别待做。


## 20. 2026-11-14 B～E 继续：知学 #179 七项 CI 修复和旧缓存持久化隔离

> 用户要求首先修复知学 #179 最新 CI 的七项失败，再继续 B～E，所有既有 PR 保持 Draft，不动生产环境。本轮只使用 GitHub 已有 Draft 和 HomeFlow main 文档交接；没有合并任何功能 PR、启用 Feature Flag、执行生产 SQL、部署 Pages/Workers、读写生产 D1/R2 或创建 Preview。**阶段 A 用户 4 个 D1 + 3 个 R2 Bucket（6 个对象）的加密备份与 Mac SQLite 本地恢复、SHA-256 和 Drive 回下载验证已 PASS**；Cloudflare 隔离恢复和正式回滚测试仍未做，不能据此授权生产迁移。

### 20.1 知学 #179 七项真实 CI 失败原因与最终修复

- 原 [Validate #43492418101](https://github.com/PTamako/it-study-platform/actions/runs/43492418101)，精确 HEAD `accf7c0fc596d21a08fbfcf372e987b4281273e4`，`completed/failure`；仔细核对 job logs，真正 **7 项失败只有 2 类测试框架问题**：
  - `scripts/daily-task-runtime.test.mjs` 六项失败共因：旧 VM 隔离沙箱只截取了 App.vue 的每日任务函数片段，没有模拟新增加的 `legacyWritesAllowed()`；运行时报 `ReferenceError: legacyWritesAllowed is not defined`。被影响的跨天点击、云端迟到响应、离线失败保留、连续点击重试及换号后旧请求回执测试都因此无法执行。真实应用本身声明了该函数；不能为使测试通过而删掉隔离安全逻辑。
  - `scripts/homeflow-pwa-ui.test.mjs` 一项静态断言错误：正则要求 `function rolloverDailyTasks(){`，但实际 Vue 源码合法格式有空格 `function rolloverDailyTasks() {`。
- 修复：`scripts/daily-task-runtime.test.mjs` 的真实 VM 模拟同时提供 `authenticated`、`legacyRequiresPassword` 和 `homeflowIdentityUser`，`context.legacyWritesAllowed()` 与 App 实际授权判定一致；额外跑真实函数断言 **HomeFlow member/未重新通过旧密码均不可能写入旧任务缓存**，旧 owner 明确重新输入密码后跨天行为正常。PWA 静态正则接受源码空白，但不放宽认证要求。代码 Commit `a3928d0f0a8cdd6ccf0dd04fdd7e147b1a38aa3c` / `e61220acef43b858053768af1df477343bd07ea4`。
- **已经真实确认** [Validate #43529836222](https://github.com/PTamako/it-study-platform/actions/runs/43529836222) 对精确 HEAD `e61220acef43b858053768af1df477343bd07ea4` 返回 `completed/success`：原 7 项 CI 失败全修复。这是该 HEAD 的绿灯，后续新增代码要用其**新的 HEAD** 再验证。

### 20.2 E 继续：旧单人学习缓存“持久化写入”访问栅栏

- 原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179)、branch `feature/homeflow-identity-isolated-20261113`，新增功能仍默认 OFF。原 `src/App.vue` 的 localStorage 曾包含不带 HomeFlow user ID 的单人缓存，不能把原 owner 本地记录自动认领为现在登录的 member，也不能在新账号加载后覆盖旧 owner 的离线草稿。
- 在已经建立的 `zhixue:legacy-cache-quarantine-v1` 入口隔离基础上，本轮对以下原旧 owner 写入加 `legacyWritesAllowed() = authenticated && !legacyRequiresPassword && !homeflowIdentityUser` 栅栏：
  1. `persistDailyPending` 每日任务待同步队列；
  2. `persistActiveMockExam` 模拟考试本机答卷草稿；
  3. `persistDailyWordState` 每日单词复习进度和待同步队列；
  4. 旧问题解析、情景会话中文解释、本机语言选择、掌握进度和语言复习 Vue watcher；
  5. 旧最近字典、本机保存的字典词条、生词本 Vue watcher；
  6. 每日单词选词记录和语言场景分配的原本直接 localStorage 写入。
- 不改原来的 localStorage key 和数据字节、不清空任何旧缓存、不写入 HomeFlow 新账号下的 D1。此更改是**阻止错误持久化/覆盖**，不是从机身存储里做完整的历史个人数据迁移。
- 对应代码 Commit `819516cd839be94a159074186e7ff43ba0fa28cf`、`59ec265d332ce89bbb256ca810a2f6c781152e84`；新增 `scripts/homeflow-legacy-cache-runtime.test.mjs` 实际从 Vue 源码抽取上述 mock/每日单词保存函数，用 Node VM 分别在禁用/旧主人解锁/切号后验证存储零写入、合法写入、旧快照字节不变，Commit `69c492dc8f782e1d7b6ea90d28e06b8204e9864b`；`scripts/homeflow-pwa-ui.test.mjs` 新增关键 watcher 和 pending 保存路径核查，Commit `d4e9faeb876a0b58c998de6869cc99f8c5d1db49`。
- 原知学 Draft 内文档 `docs/homeflow-stage-e-legacy-cache-quarantine.md` 更新说明，Commit `a828ae048cd380cff3ceaa661e60c58339040624`。**截至编写本段，新的完整 [Validate #43531154525](https://github.com/PTamako/it-study-platform/actions/runs/43531154525) 精确 HEAD `a828ae048cd380cff3ceaa661e60c58339040624` 尚在执行**；必须查到 `completed/success` 才能声称本轮附加缓存安全模块全绿，若失败必须逐条按日志修正，不能引用前面的绿灯冒充最新成功。

### 20.3 当前 B～E 未完成事项和不可触碰的生产门槛

- **B**：正式跨 PWA 初次登录、统一昵称改动/撤权/退出与两人切号的真实 Safari/iPhone 和多设备端到端验收仍未完成，既有草案代码仅供测试。
- **C**：家計簿虽然已开发个人金融 stable ID sidecar、家庭明细和统计、部分资产快照、有限现金记账审批执行器，旧信用卡账单、储值余额、SBI 定投/追加买付/积分、固定费等**全部金融资源稳定 ID 与业务编辑路径**的无损完整迁移、所有余额与账本一致性仍未完。
- **D**：HomeFlow finance 受限现金执行器和文书 signed submit/status 已存在，不应重复开发；但文书到账本/家庭任务/个人知学的受认证真实目标执行器、approval `approved→executing→applied` 幂等结果回报、Push、失败补偿和目标账户映射均未贯通，绝不能把审批完成当作已同步生效。
- **E**：知学已有多种个人 online-only D1 学习模块和旧缓存入口/写入防串号栅栏，旧本地 IndexedDB、所有 in-flight 异步回执、每条旧离线重试队列的完全 owner-proof、原 owner 全量旧记录领回、文书词句导入分别归属两人的 E2E 都未完；文书私人/共享写权限及审批后目标同步也未完整验收。
- HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 均应保持**open/Draft/未合并**；新迁移 SQL 仅开发文件、不在 Cloudflare 生产运行，功能开关 OFF，不能重建已弃用 Preview。A 本地恢复 PASS **不等于**用户批准 F 生产上线。


### 20.4 追加：E 新运行时测试语法修复（本节更新时最新 CI 运行中）

- [新增缓存验收 CI #43531154525](https://github.com/PTamako/it-study-platform/actions/runs/43531154525) 精确 HEAD `a828ae048cd380cff3ceaa661e60c58339040624` 已 `completed/failure`。实际日志发现仅 **新增** `scripts/homeflow-legacy-cache-runtime.test.mjs` 有 Node SyntaxError：测试消息中的英文 `former owner's` 用单引号包裹导致意外提前结束；**不是身份门槛、旧缓存保存或业务 SQL 测试失败**。其他现有回归在测试时正常。
- 已在原知学 Draft #179 的同一分支精确修复为双引号，Commit `f5c6f3ef997185bf363eba47856262e7ccde0388`；重新执行 [最新 Validate #43531773002](https://github.com/PTamako/it-study-platform/actions/runs/43531773002)。本节写入时它还未完成，**不得宣称 f5c6f3e 已全绿**。必须按该最终 HEAD/最新 CI 核验后再补通过记录。


## 21. 2026-11-14 接手核查：知学 CI 快速反馈

- 用户确认 A 阶段四个 D1 与三个 R2 Bucket 的加密备份、Mac 本地恢复与 Drive 校验已 PASS；Cloudflare 隔离恢复、生产迁移前新鲜快照、回滚准备与上线授权仍未完成。不得重做已完成的本地备份或据此上线。
- 知学 [Validate #43531773002](https://github.com/PTamako/it-study-platform/actions/runs/43531773002) 对 HEAD `f5c6f3ef997185bf363eba47856262e7ccde0388` 已 completed/success；§20.4 的七项历史失败及后续测试语法问题无需重复修复。
- 知学原 Draft #179 分支提交 `39ffac408eecefdc4f2a4bdbd0186cfa566bcde1`：在原完整 validate 任务并行增加快速身份/旧缓存/迟到请求回归与 Vue 类型检查，原有完整步骤未删除。该新 HEAD CI 尚待核验；本提交只改善早期反馈，**未完成生成缓存、完整任务并行、合并保护设置或优化前后时长实测**。完整验收必须保持必要条件，不可用快速任务代替。
- 最新五个原 PR 均 open/Draft：HomeFlow #305 `b8b877388639b1a2b3ac19dbca58ea8072b8a037`、#306 `bbcb7da52d1c7fdc83ce788fff9b34fb16b80169`、家計簿 #309 `576af15e305e19fd95e22f65815a177ab3a79c98`、文书 #97 `8f589a8b4ac0632513f15799d814be579da7aa47`；上述 HEAD 的 PR 工作流均成功。知学最新 HEAD 与状态以上段为准。
- HomeFlow #306 基于 #305 的早期提交，两分支对比显示 #306 比 #305 落后 7 个提交，另有自身 65 个提交。修改或最终合并审批功能前须安全整合最新 #305 并对整合后精确 HEAD 验证，不能误以为当前审批 CI 已覆盖最新身份撤销代码。
- 无生产迁移、生产资源变更、启用开关或部署，未创建 Preview。继续 B～E 依照 §20.3 的未完清单；真机 PWA、完整账务迁移与审批后真实目标执行仍未完成。

### 21.1 追加：快速反馈实测与审批分支依赖整合

- 知学 #179 新 HEAD `39ffac408eecefdc4f2a4bdbd0186cfa566bcde1` 的 [CI #43533113361](https://github.com/PTamako/it-study-platform/actions/runs/43533113361) 中快速身份/类型检查已 success，job 15 秒；完整 validate 截至本记录仍在运行。旧 HEAD 完整 CI #43531773002 的任务实际 6 分 51 秒、整个 run 6 分 54 秒。二者覆盖范围不同，不能称完整 CI 已从 6 分钟缩短到 15 秒。旧完整任务瓶颈是 Tatoeba 生成 249 秒、D1 本地迁移 111 秒。新完整时长及其最终状态需复查。
- 连接读取 `main` branch protection 返回 GitHub 403 `Resource not accessible by integration`；规则集列表为空，但这不能证明 branch protection 不存在。当前无法核实或配置完整验收为必需状态检查，仍需有仓库管理权限的连接核验。不得只凭快速任务绿灯合并。
- 本地隔离合并 #305 的最新 `b8b877388639b1a2b3ac19dbca58ea8072b8a037` 到 #306 原 HEAD，Git 无文本冲突；本地合并结果树 `f4b9c23ecd290dafb8d544f7be88acb933a8e5b9`，`npm run check` 807 测试通过、Vue 构建通过（本地 Node 24）；额外 OAuth、审批和文书审批 36 项通过。使用带预期 HEAD 的更新提交双亲 merge commit `79efaddd4fe741f5f09cb5b68bc24bd2a707334d` 到原 #306 Draft 分支；这不是合并 PR 或生产部署。必须核验该精确 HEAD 的 GitHub Node 22 CI 最终结果。
- `main` 本次交接仅修改 docs；已核对 HomeFlow deploy.yml 使用 docs-only paths-ignore。未对生产 D1/R2、Workers 或 Pages 做任何操作。仍需完成 §20.3 核心功能与真实跨应用测试。

- **GitHub CI 最终结果更新**：HomeFlow #306 整合 HEAD `79efaddd4fe741f5f09cb5b68bc24bd2a707334d` 的 [Validate #43533342466](https://github.com/PTamako/homeflow/actions/runs/43533342466) 已 completed/success，覆盖 GitHub Node 22 的测试、构建、迁移检查与 Worker dry-run；PR 仍为 Draft，未上线。

- **知学最终 CI 更新**：[Validate #43533113361](https://github.com/PTamako/it-study-platform/actions/runs/43533113361) 精确 HEAD `39ffac408eecefdc4f2a4bdbd0186cfa566bcde1` 的两个任务均 completed/success；快速任务 15 秒，完整任务 6 分 52 秒。旧完整任务 6 分 51 秒，新完整任务没有实质提速，改善的是身份/类型错误反馈时间。新完整任务中例句生成 248 秒、本地 D1 迁移 109 秒，完整总耗时优化与缓存仍需实施及复验。分支保护权限问题仍未解决。


## 22. 2026-11-14 知学 #179 完整 CI 生成文件缓存（真实代码已提交；当前 HEAD 待 CI 验收）

- 工作范围：仍使用知学原 [Draft #179](https://github.com/PTamako/it-study-platform/pull/179)，branch `feature/homeflow-identity-isolated-20261113`；只调整 PR 验证流程和新增只读本地验证脚本，不改 HomeFlow 身份/知学个人学习业务 API、数据或历史归属；保留原完整 validate，不新建 Preview、不部署生产。
- 新增 `scripts/verify-language-generated-artifacts.mjs`：校验 0081/0082/0084/0087/0115 五个生成迁移存在且大小合理，并核对日英 10,000 句与两份词典资产 manifest、SHA-256 文件名指纹及数量；Commit `5d28472a886274837595817c273f70e4dec0140d`。
- 原 `.github/workflows/validate-pr.yml`：为 Tatoeba 生成的公共 SQL、静态语言/词典文件添加以生成器、辅助算法、词典输入和 0079 种子为 key 的缓存。**首次未命中时仍正常调用完整 Python 生成器**；命中时仅跳过重复生成，始终运行资产指纹校验、语言质量审核、npm 完整测试、Vue 构建、完整本地 D1 迁移、JSON 检查和 Worker `--dry-run`。源数据更换要显式更新 `public-language-fixtures-v1` epoch，避免不受控的新版本混用；Commit `f0159098d19e3dfec175975e1d68bd9cbe6e660f`。
- 实际 GitHub 提交：以上两个 SHA；PR #179 经实时核查仍 `open / Draft`，本次代码 HEAD `f0159098d19e3dfec175975e1d68bd9cbe6e660f`。相应 [Validate #43535202780](https://github.com/PTamako/it-study-platform/actions/runs/43535202780) 在首次查询时为 `pending`，**不得标记为通过、缓存加速成功或上线**。原完整 CI 基线 #43533113361 已成功，但不覆盖这两次新增提交。
- 待办：① 取得 #43535202780 对精确 HEAD 的最终结果，失败则按 job logs 修复；② 首次 cache miss 的完整测试绿灯后，后续同 key cache hit 再实测耗时、检查缓存恢复结果与完整本地 D1 验证；③ B～E 的真实剩余功能依 §20.3 持续开发，特别是旧离线队列防串号、家計簿完整金融归属、文书审批后真实目标执行与 iPhone 双人 E2E；④ 生产 D1/Workers/Pages/R2 仍未授权变更。


## 23. 2026-11-14 文书助手 #97 审批原始候选版本不可复用（已提交、最新 CI 验证中）

- 在原 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) 上继续 Stage D/E，branch `feature/homeflow-identity-link-safety-20261113`，未新建 PR。原申请在文书助手存储原文书版本、候选更新时间和不可变私有快照，HomeFlow 只持摘要。
- 修复 `worker/document-member-approval.js`：成员单次读取 HomeFlow 审批状态前，必须验证当前文书 `version`、候选 `updated_at` 与冻结的 `document_member_sync_intents` 完全一致，同时按 SHA-256 校验私有 `payload_json` 完整性；任一不一致返回 409 `APPROVAL_SOURCE_CHANGED` / `APPROVAL_SNAPSHOT_INVALID`，不去 HomeFlow 查询、不会将旧批准误解为新内容已获许可。成员再次请求提交同一冻结审批时也校验旧文书/候选版本，不允许源已改却使用旧回执重复提交。代码 Commit `4fb5944c6c348488345b57d260acc6f8711919f6`。
- `tests/homeflow-sso.test.js` 增真实 SQLite + Worker 的原候选 `updated_at` 改动回归：旧批准状态读取和重复提交分别 409，既不向 HomeFlow 发受信后端调用，也不改变 `integration_links`；测试 Commit `75e41988d62bbfbbd3f7eea1e4d8f88157d1657f`。原 approved≠applied、拒绝/断网/损坏签名、幂等及双用户验证仍保留。
- **准确状态**：PR #97 在核查时仍 `open / Draft`，HEAD `75e41988d62bbfbbd3f7eea1e4d8f88157d1657f`，[Pre-merge CI #43535741281](https://github.com/PTamako/jp-document-assistant/actions/runs/43535741281) 为 `in_progress`，不能宣称本修复全绿；需取得精确 HEAD 的最终 CI 并记录，若失败按原 job logs 修复。
- **未完成**：旧审批终止/重申请业务 UI 仍需专门交互（当前只安全拒绝），文书→家計簿/HomeFlow/知学的可信目标执行器、双人真机 Google 授权与身份/缓存隔离完整验收仍待实施；所有生产迁移/开关/资源完全未变，未合并 Draft、不部署生产、不建立 Preview。A 本地备份恢复 PASS，不能替代生产 F 上线批准。


## 24. 2026-11-14 §22/§23 最终 CI 复核：双模块通过（未部署）

- **知学 Draft #179**：新生成语言文件缓存及完整性验收，精确分支 HEAD `f0159098d19e3dfec175975e1d68bd9cbe6e660f` 的 [Validate #43535202780](https://github.com/PTamako/it-study-platform/actions/runs/43535202780) 已核查 `completed / success`。此次验证为新的 cache key 首次运行，**只证明完整 CI 及缓存生成检查通过**；后续 cache-hit 命中率和实测加速尚未证明，不能宣称完整构建已加速至某个时长。新增测试、Workflow SHA 见 §22。
- **文书助手 Draft #97**：初版 HEAD `75e41988d62bbfbbd3f7eea1e4d8f88157d1657f` 的 [Pre-merge CI #43535741281](https://github.com/PTamako/jp-document-assistant/actions/runs/43535741281) 实际 `completed / failure`，352 项测试中 351 pass / 1 fail。原因是旧提交回执检查在文书来源版本冲突判定之前比较新算出的 digest，提前报 `APPROVAL_INTENT_CONFLICT`；测试要求更明确的 `APPROVAL_SOURCE_CHANGED`。未放宽安全限制，仅将原 actor/household 验证 → 已冻结源版本检查 → digest 比较按语义正确排序。修复代码 Commit `b5f59d55f041ae36893ab9170d2ecd4309c7029b`。
- 文书助手修复后精确 HEAD `b5f59d55f041ae36893ab9170d2ecd4309c7029b` 的 [Pre-merge CI #43536007108](https://github.com/PTamako/jp-document-assistant/actions/runs/43536007108) 已核查 `completed / success`。此前绿色基线不冒充本次结果。文书候选变更前后旧审批 status/重复提交均 fail-closed，真实目标执行器仍未开发。
- 两 PR 均保持 `open / Draft`，未合并、未设置生产功能开关、未运行 D1 正式迁移、未部署生产 Cloudflare 或创建 Preview。仍需 Stage C 稳定金融账户全量归属及 Stage D 可信执行器、Stage E 旧离线队列完整隔离、双人真实 iOS PWA 验收。下一轮任何新 HEAD 必须重新等待其自己的 CI，不可继续使用本节的绿色结果。


## 25. 2026-11-14 知学 #179 E：旧三类离线答题队列账号切换保护（代码已提交，CI 需按最新 HEAD 核验）

- 项目仍在原 [知学 Draft PR #179](https://github.com/PTamako/it-study-platform/pull/179)、`feature/homeflow-identity-isolated-20261113`，不影响 main 生产应用。模块聚焦旧单密码空间三类原始队列：`mock-pending-v1` 模拟交卷、`scenario-pending-v1` 实战答题、`practice-pending-v1` 逐题练习。
- `src/App.vue` 增 `legacyOperationGeneration` 和 `legacyWorkCurrent(generation)`：原操作发起时记录代次，若 HomeFlow 身份上线、账号退出、认证状态不确定或重新旧密码登录后代次不一致，异步响应不能再清空原 localStorage 队列、改写记录/结果或显示原账户反馈；未验证旧密码的入口不能创建、提交或自动重放旧 queue。切换时停止旧模拟考试倒计时，旧快照原字节保留。代码 Commit `aa3c23f4189057e08daa1918ac973e9c93c57718`。
- 新 `scripts/homeflow-legacy-queue-epoch.test.mjs` 从真实 Vue 同步函数源码提取并用延迟响应测试三类队列，Commit `c758d7badb5ccf4eae5c456c260b65ff88d99858`；快速 CI 列表追加该测试 Commit `355e5f6f7639affd8f32b3ecbc7bcef10b2affdd`。旧 `scripts/dictionary-acceptance.test.mjs` 中仍期待 `!authenticated.value` 的过期正则在两次完整 CI（#43536840952/#43536981443）使其中 1 项失败，已改成断言更严格 `!legacyWorkCurrent(generation)`，Commit `a0956c2cde2baae8a7b407e0654072ad9eafc97c`。文档单独 Commit `fca160eec397f612edc405b4df49b029257b55e8`。
- 已知 CI：旧 HEAD `aa3c23f...` 的 [Validate #43536840952](https://github.com/PTamako/it-study-platform/actions/runs/43536840952) `completed/failure`（fast identity/type success、完整测试旧正则失败），`c758d7b...` 的 [Validate #43536981443](https://github.com/PTamako/it-study-platform/actions/runs/43536981443) 同一旧断言 `completed/failure`；**上述失败不可谎报已通过**。修复后的最新文档 HEAD 以及对应 Actions 必须重新查，未见 completed/success 前保持待验收。
- 尚未完成：旧考试历史迁移、全部每日任务/单词/字典异步请求的原身份栅栏、每个 localStorage/IndexedDB 的完整独立分区、真机 PWA 同设备双人切号/断网测试、家計簿金融归属/文书真实目标审批执行。此轮只提交原 Draft 功能代码及文档；绝未合并 Draft、操作生产 D1/R2、启用生产登录开关或创建 Preview。A 本地加密备份与恢复 PASS，但不代表 F 生产上线授权。


## 26. 2026-11-14 知学 #179 Stage E 后续：离线队列全绿、考试历史批量写入中途切号保护（第二模块仍待精确 CI）

- §25 旧 mock/scenario/practice 三队列增量的原 PR #179 `fca160eec397f612edc405b4df49b029257b55e8`，[Validate #43537234469](https://github.com/PTamako/it-study-platform/actions/runs/43537234469) **已核查 `completed/success`**；旧 1 项正则断言失败已于该 HEAD 修复，完整回归不是仅快速任务通过。无新 Preview、生产数据或正式功能开关变更。
- 继续同一原知学 Draft #179 开发 **旧考试成绩历史同步/清空的账号代次保护**。原 `syncExamHistory()` 会 GET 旧云端，再逐笔 POST 缺失考试记录，网络断连/切号前发出的晚到响应可能触发后续多笔上传、错误地刷新新身份界面；新增每次发送前后 `legacyWorkCurrent(generation)` 和独立 `examHistorySyncGeneration` 状态，不让旧响应在切号后继续上传、合并历史或释放新身份的同步锁。保存手动成绩、打开二次确认弹窗删除与旧 DELETE 回执也检查原操作代次。原数据仍保存在旧 localStorage；不会自动迁移给 HomeFlow member。代码 Commit `afb106af5b3147cfefb7f62a4983eab17ec4481f`。
- `scripts/homeflow-legacy-exam-history-epoch.test.mjs` 实际使用 Vue 原方法测试：① 两笔历史待传，第一笔 POST 卡住后切号，必须阻止第二笔；② DELETE 已发但回执迟到，切号后不能清空原本地成绩；③ 三个入口静态检查。测试 Commit `cb9f3c5e1cf99908a302e9bdbf6e8df0f4a83b01`；添加快速验证 Commit `99aa07f8c2ca717309e037bf2bca834334213fdd`；原 Draft 内文档 Commit `3ca4a88539d0c8160d8b238d4b27d377c790e383`。
- **准确 CI 状态**：最新 HEAD `3ca4a88539d0c8160d8b238d4b27d377c790e383` 的 [Validate #43537614688](https://github.com/PTamako/it-study-platform/actions/runs/43537614688) 首次检查 `pending`，不能提前宣称全绿。前一个 `99aa07f8...` 的 #43537562759 快速任务 success、完整任务因后续提交 cancelled，不属于精确最新 HEAD 的最终验收。必须重新获取 #43537614688 的 fast+full 最终状态，失败则修复并记录。
- 尚未完成：其他旧异步任务/每日词/词典/离线 IndexedDB 与来源验证的每条迁移、四 App 完整 B～E 联调、家計簿旧金融 ID 全资源迁移、文书→目标服务签名实际执行，以及真实双人 iPhone PWA 登出/换号/断网验收。此两项均只修改知学 Draft，**未合并、未部署、未执行生产 D1、未创建 Preview**；A 备份 Mac 恢复 PASS 不是 F 上线授权。


## 27. 2026-11-14 知学 #179 §26 追加最终 CI：历史考试切号模块已通过

- 知学原 [Draft PR #179](https://github.com/PTamako/it-study-platform/pull/179) 的**精确最终 HEAD** `3ca4a88539d0c8160d8b238d4b27d377c790e383`，经 [Validate #43537614688](https://github.com/PTamako/it-study-platform/actions/runs/43537614688) 确认 `completed/success`。这是 §26 所述考试历史批量上传、迟到 DELETE 回执保护和新增快/全两路回归的真实绿色 CI；其余旧 HEAD #43537541510、#43537562759 在新提交后 cancelled，不可误报失败或成功。
- 与 §25 §26 连续的两项 Stage E 增量现都在原 Draft #179 通过 GitHub Node 22 完整验证：① 三类本地离线 mock/scenario/practice 请求账号代次阻断；② 旧单人考试历史批量导入/删除的同一代次保护。两者没有改变 HomeFlow 专属在线学习接口的 actor 绑定逻辑，不删除任何旧缓存。
- **生产状态仍未改变**：无生产 SQL、D1/R2/Worker/Pages 操作，无功能 flag 上线，无 Preview，无功能 PR 合并。剩余工作仍是其他全部 legacy 本地缓存/在线响应隔离、身份完整迁移与真实 iPhone 双人验收；本节绿色 CI 不代表 Stage B～E 全部完成。


## 28. 2026-11-14 家計簿 #309 Stage C/D：成员发起加密家庭收支申请 UI（原 Draft，CI 待精确 HEAD）

- 在原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 的 `feature/homeflow-sso-isolated-foundation-20261113` 继续，不新建 PR。原 `FamilyFinanceProposals.vue` 只能查看、提交/取消已存在草稿，会员尚无 UI 创建入口；新增移动优先创建表单，选择当前已验证 member 本人名下的 `member_created`、未归档稳定金融账户，输入普通 `income/expense`、整数日元金额、日期、商家/收入来源、分类、可选备注；提交前显式确认“**只保存草稿，不影响正式共享账本或余额；还需提交 HomeFlow 审批**”。代码 Commit `547d0837414e750b25f74bb874255d6a39aa114c`。
- 表单沿用现有 `POST /api/family-finance/proposals` 的服务端真实 HomeFlow member、账户归属和 AES-GCM 密文、14 天和不可变 SHA-256 等检查；仅前端调用原有安全 API，没有新建任何可直接写正式 `entries` 的路由。每次提交为当前草稿生成稳定随机 idempotency key 并在不确定网络回执时冻结字段与 key 原样重试；账号切换及组件卸载失效旧回执、清理临时表单，不写任何浏览器 LocalStorage。只有返回 `prepared_not_submitted` 且 `ledger_changed:false` 才显示“已保存待审批草稿”，绝不显示已入账。
- `tests/family-finance-ui.test.mjs` 新增仅本人账户、幂等字段冻结、源码中无直接账本 POST、原 user/组件 epoch 保护的 UI 断言，Commit `a12bd8cbdc884f8de399c8e0f8f4e2a15b1cab49`；原 PR 内文档 Commit `764c93cebc8fc83946b23a8fa3758adb0f2d3cc2`。
- 本段第一次查看代码 HEAD `a12bd8c...` 的 [Validate #43538214480](https://github.com/PTamako/kakebo_jp/actions/runs/43538214480) 和 [Mobile WebKit #43538214502](https://github.com/PTamako/kakebo_jp/actions/runs/43538214502) 均为 `pending`。文档后新的精确 HEAD `764c93cebc8fc83946b23a8fa3758adb0f2d3cc2` 必须重新获取它自己的 CI 最终结果，不能引用旧 run 绿灯。若失败，按真实步骤和日志修复。
- **未完成**：普通成员申请经 HomeFlow owner 审批后才能真实入账的全类型受信执行器、卡/储值/SBI/固定费稳定 ID 的完全无损迁移、账本与余额一致性、真正双人 iPhone PWA、通知和断网闭环。草稿 UI 不代表 Stage C/D 完成或生产可用。**原 #309 仍 Draft，全部新迁移未在正式 D1 执行、flags OFF、无生产资源修改或 Preview**。A 本地备份恢复 PASS，不等于 F 部署已授权。


## 29. 2026-11-14 家計簿 #309：防止前台刷新破坏待提交财务申请的重试状态（仍 Draft）

- 基于 §28 的 PWA 加密草稿创建入口，审核源代码发现组件原 `load(at=0)` 会先 `++revision`，再检查 `busy`。iPhone 从后台恢复时触发的无效 GET 即使因正在 POST 被拒，也可能把有效提交的 `revision` 改掉，导致原异步 `finally` 无法释放 `busy='create'`，申请按钮永久锁住，且冻结 idempotency 草稿不能继续重试。
- 已修正 `src/FamilyFinanceProposals.vue`：先检查 `busy/组件活性/页码` 再递增 revision；提交中不允许用收起动作意外取消当前 UI 代次；仍保留一笔未确认申请的原随机幂等键、请求全部字段及真实 member 身份的隔离。安全补丁 Commit `d87ae0b63a6ff0c439587f97068ff6d6aa3cafb9`。
- 新 `tests/family-finance-proposals-epoch.test.mjs` 用 Node VM **实际执行** Vue 原 `load/toggle` 方法，模拟 `busy='create'` 时 Safari 前台刷新/折叠尝试，断言 revision 不变、无额外 D1 GET、仍可正常最终刷新；补禁止旧缓存和本人账户原归属守卫。测试 Commit `1606a514fa29fccd3b7aea5719728b0ec5949983`，原 Draft #309 仍 open / Draft。
- 已有上一精确 **代码** HEAD `d87ae0b...` 的 [Validate #43538371592](https://github.com/PTamako/kakebo_jp/actions/runs/43538371592) 为 `completed/success`（并非覆盖后续测试文件）。当前带实际运行测试的 HEAD `1606a514fa29fccd3b7aea5719728b0ec5949983`，[Validate #43538427829](https://github.com/PTamako/kakebo_jp/actions/runs/43538427829) 和 [Mobile WebKit #43538427785](https://github.com/PTamako/kakebo_jp/actions/runs/43538427785) 在首次核查均 `in_progress`。**需按该 HEAD 真实最终结果更新，不得夸称已全绿**。
- 仍未完成 Stage C 全部旧金融 stable ID 迁移、D 全类型审批后目标真实受信执行器、HomeFlow applied 回报/推送、iOS 双人真机验收；不合并功能 Draft、不运行正式迁移、不启用新 flag、不部署生产或创建 Preview。A 本地备份恢复 PASS 仍不等于允许 F 上线。


## 30. 2026-11-14 家計簿 #309 §29 CI 实测补记：完整 Validate 通过，WebKit 仍需真实结果

- 当前家計簿原 [Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) HEAD `1606a514fa29fccd3b7aea5719728b0ec5949983`；其 [Validate #43538427829](https://github.com/PTamako/kakebo_jp/actions/runs/43538427829) 已真实核查 `completed/success`，覆盖成员新建 AES-GCM 草稿表单、个人账户隔离、同一幂等键原样重试及前台 `load/toggle` VM 运行时检查。之前精确代码 HEAD `d87ae0b...` 的 Validate #43538371592 亦 `completed/success`，但不能代替最新增加的 VM 测试。
- 同 HEAD [Mobile WebKit Smoke #43538427785](https://github.com/PTamako/kakebo_jp/actions/runs/43538427785) 最后检查依然为 `in_progress`，job 当前在 `npx playwright install --with-deps webkit`；**尚不能宣称 WebKit 通过或失败**。待 run 完成需核对 URL 的真实 conclusion；如失败优先从 job steps/logs 修复。真机双人 iPhone/PWA 手动验收不是 WebKit CI 的替代品。
- HomeFlow 主仓库本交接仅追加 docs/** 文本，生产 Deploy 工作流已设置 docs-only paths-ignore；本轮没有合并任何四应用功能 PR、部署正式 Cloudflare、改生产 D1/R2/Secret 或创建 Preview。所有阶段 F 上线门槛继续阻断。


## 31. 2026-11-14 家計簿 #309：家庭财务草稿全操作原始 actor 防切号（提交完成，最新 CI 待验）

- 先补 §30 的事实核查：家計簿 [Mobile WebKit #43538427785](https://github.com/PTamako/kakebo_jp/actions/runs/43538427785)，精确代码 HEAD `1606a514fa29fccd3b7aea5719728b0ec5949983`，已在 2026-11-14 查询为 `completed/success`；同 HEAD Validate #43538427829 `completed/success`。这是 CI WebKit 浏览器 smoke，不代表真实双人 iPhone PWA 通过。
- 本轮继续原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)、`feature/homeflow-sso-isolated-foundation-20261113`。此前 `POST/PATCH /accounts` 已使用客户端原 HomeFlow `expected_user_id` 与服务端新鲜 introspect 身份比较；财务草稿的 `POST /proposals`、`POST /proposals/{id}/submit`、`POST /proposals/{id}/cancel`、`POST /proposals/{id}/approval-proof` 曾缺同一保护。
- 新增每条请求的 **`expected_user_id === user.user_id`** 强制校验，服务端 `user` 仍只能来自实时源 Session introspection，`expected_user_id` 仅为防止原 PWA 切号后发送旧操作的额外断言；任何缺失、伪造或错号都返回 `403 ACTOR_CHANGED`，**在账户查询、D1 草稿/事件写入或签名 HomeFlow 审批调用前**拒绝。不放宽同源 Origin/JSON 校验、既有角色、本人账户所有权、AES-GCM、SHA-256/幂等键和管理员审批。
- 真实代码提交：`ae7944b1bd018cc3ec777081a0d07fbdade19cd0`（`pending.js` prepare/cancel）；`2ef7b409f25fa183226f3c7d7f52a19a30ebc5f9`（`approval-submit.js`）；`00cc1e429533723a0fa79e297faa83eaf231d029`（`approval-proof.js`）；`3279f25ff08de21053101fe0a11010e2447031e6`（`FamilyFinanceProposals.vue` 在创建和提交/取消时携带原 member ID）。
- 测试提交：`74268baf9acdbb54355acdff2f606ce60c9f52cf`（现有真实 D1 helper 将原 actor 随所有 proposal POST 发送，同时允许指定错误 ID 测试）；`10ef5afd1113e7494ad9cfa11868d1162c6d012d`（双角色真实 SQLite 回归，缺失/错误 actor 的 prepare、submit、cancel、approval-proof 必须 403，旧账本/审计/草稿在错号请求后不变，合法成员仍可撤回）；`6bb1f27c8e8e0429feef64fb4650273130d0845e`（前端与四后端路径演员绑定源码断言）。
- **准确 CI**：精确代码 HEAD `6bb1f27c8e8e0429feef64fb4650273130d0845e` 的 [Validate #43539357105](https://github.com/PTamako/kakebo_jp/actions/runs/43539357105) 首次查询为 `pending`、[Mobile WebKit #43539357089](https://github.com/PTamako/kakebo_jp/actions/runs/43539357089) 为 `in_progress`；**不得提前宣称新 HEAD 通过**。该分支的中间提交触发的被取消 CI 不代表最终通过/失败。需复查精确 HEAD，失败时按实际日志修复。
- 仍未完成 B～E：家計簿旧金融全部资源 stable ID 和编辑/统计业务贯通、获批后受信执行器对非现金资产/信用卡/SBI 的正确入账、完整 HomeFlow approved→applied 的回报/重试、文书助手真实目标执行及知学其余离线缓存隔离；全部仍需真实双人 iPhone/Safari/PWA 验收。此轮没有执行任何 Cloudflare 生产迁移、部署、开功能开关、合并 Draft、删除旧数据或重建 Preview。A Mac 本地备份恢复 PASS 不等于 F 生产上线批准。


## 32. 2026-11-14 家計簿 #309 Stage D：成员主动核实 HomeFlow 批准、严格区分批准与入账（代码已提交，最新 CI 待验）

- 在原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 的 `src/FamilyFinanceProposals.vue`，仅对状态为 `submitted_status_unknown` 且保存合法 HomeFlow approval UUID 的成员本人草稿显示「核实 HomeFlow 审批」按钮；明确写「审批通过不等于已入账」。它调用既有独立 `POST /api/family-finance/proposals/{id}/approval-proof`，携带**原始当前 HomeFlow member 的** `expected_user_id`、本申请已持久存储的 `homeflow_request_id`。既有服务端会重新验证当前源 Session、本人账户、提交状态、未过期提案、HomeFlow HMAC 签名与完整 digest/actor/家庭/版本、真实 owner 批准。没有新建直写账本路由、没有自动修改 `entries`。
- 前端仅在后端回执 `ok:true`、`approval_confirmed:true`、`status:'approved_not_applied'`、`applied:false`、`ledger_changed:false`、提案 ID/审批 UUID 均一致时显示「已批准、**尚未入账，需等待后端实际执行**」；待审批/撤销/不可用/损坏回执一律不当作成功；切号、旧请求迟到不会污染新身份界面。代码 Commit `626d3afc021fc790bfaaf8af90b779e007da205f`。
- `tests/family-finance-approval-check.test.mjs` 从真实 Vue 原方法运行普通成功、错误宣称已执行（`applied:true`）和切号后延迟请求等场景，并断言请求不包含任何 `/api/entries` 或 `approved-actions` 客户端直写；Commit `10d7807825e21a1b52576bb274956d59d1d849b0`。
- CI 已确认 **上一个身份栅栏精确 HEAD `6bb1f27c8e8e0429feef64fb4650273130d0845e` 的 [Validate #43539357105](https://github.com/PTamako/kakebo_jp/actions/runs/43539357105) 为 `completed/success`**。但它并不包含本节新增核实 UI。当前最新 HEAD `10d7807825e21a1b52576bb274956d59d1d849b0` 的 [Validate #43539564331](https://github.com/PTamako/kakebo_jp/actions/runs/43539564331) 首次为 `in_progress`、[Mobile WebKit #43539564342](https://github.com/PTamako/kakebo_jp/actions/runs/43539564342) 为 `pending`；**新功能未获最终 CI 通过结论，需等精确 HEAD 的结果**。
- **仍未完成的核心 Stage D**：由可信 HomeFlow 批准触发实际后端幂等执行器、现金以外信用卡/储值卡/SBI 的正确账务/资产路径、`executing→applied` 持久回报/失败补偿/通知；**仅主动验证批准绝不使账本变化**。Stage C 全量旧资源无损 stable ID、Stage E 四应用跨 PWA 双人真机均未完成。本轮全程只改原 Draft #309 和本交接 docs；未合并功能 PR、修改生产 SQL/Secrets/Workers/Pages/R2、启用生产开关或创建 Preview。A 本地恢复 PASS，不代表 F 生产上线授权。


## 33. 2026-11-14 家計簿 #309 Stage C：旧支付来源稳定 ID 只读核对（精确最终 CI 待验）

- 原 Draft [家計簿 #309](https://github.com/PTamako/kakebo_jp/pull/309) 不变，branch feature/homeflow-sso-isolated-foundation-20261113；新 GET /api/family-finance/legacy/mapping-audit 仅供 HomeFlow 实时核验的 owner 使用，并复核同 household、active 的 owner link。通过有界 D1 grouped SQL 比对旧 payment_sources、历史 entries.payment_source、转账 entries.transfer_target 与仅原 owner 双证明领取的 legacy_source_name→account_id。只返回来源名称、历史笔数、转入目标笔数与已验证稳定账户 ID，状态区分 adopted_to_original_owner、legacy_account_not_adopted、historical_source_missing。无任何 INSERT/UPDATE/DELETE、OCR 原文、原账本归属假设，不按新成员的同名显示标签冒领；超 300 种来源、异常或异户归属 fail closed，ledger_changed:false。
- 真实代码提交：新 functions/api/family-finance/legacy-mapping-audit.js Commit 66368f6a4fdd71b4e1699fda3a6cf32037d8520d；原 [[path]].js 只读路由 Commit 634ddfb7ede629bd93ec6b4766a6595ffcc90dcb；移动端仅 owner 可见的默认折叠审查组件 src/FamilyFinanceMappingAudit.vue Commit 25a79e8368a1bbc249b73d64db6e7f6a9316203d、FamilyFinanceAccess.vue owner 挂载 Commit ad5a7f65bb12fed4a5b82123cce3913372a18b3f。
- 测试：tests/homeflow-sso-isolated.test.mjs 新真实 SQLite 对照（成员账户可与旧 PayPay Visa 同名但不得继承其旧流水、nanaco 转账目标计数、历史已不存在的银行来源、owner 领取前/后核查、成员 GET 403、POST 405、原 entries/payment_sources 完全未变及只读不产生日志），Commit 002858e74b37b3d8738cf57a3e57f94a739b249b；tests/family-finance-ui.test.mjs owner-only/无本地存储/无写操作检查，Commit 7fd971afa27efc75de0134cf3f2478f6904108e7。
- 真实 CI：后端测试 HEAD 002858e7 的 [Validate #43539897244](https://github.com/PTamako/kakebo_jp/actions/runs/43539897244) completed/success；最终带 UI HEAD 7fd971afa27efc75de0134cf3f2478f6904108e7 的 [Validate #43540014025](https://github.com/PTamako/kakebo_jp/actions/runs/43540014025) 和 [Mobile WebKit #43540014007](https://github.com/PTamako/kakebo_jp/actions/runs/43540014007) 在本次首次检查均 in_progress，**尚不能说最新 HEAD 已全绿**。应按精确 HEAD 核验，失败逐项修复。
- 此模块只是为 Stage C 无损迁移生成差异清单，**绝非历史账务 ID 已回填**。剩余旧金融所有资源稳定 ID/业务编辑/数据迁移、可信获批后真实执行器/回报/通知、跨应用双人 iPhone PWA E2E。A Mac 本地恢复 PASS。此次无任何正式 Cloudflare D1/R2/Workers/Pages/Secrets 改动、Preview 资源重建、功能 PR 合并或生产部署；所有开关仍 OFF。


## 34. 2026-11-14 §31～§33 精确最终 CI：家計簿三项 Stage C/D 增量全绿（仍 Draft）

- 已对原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 的精确最终 HEAD **7fd971afa27efc75de0134cf3f2478f6904108e7** 重新拉取 PR 和 Actions：PR 仍 open / Draft；[Validate #43540014025](https://github.com/PTamako/kakebo_jp/actions/runs/43540014025) **completed/success**，且 [Mobile WebKit Smoke #43540014007](https://github.com/PTamako/kakebo_jp/actions/runs/43540014007) **completed/success**。不是仅沿用早期分支 CI；此最终 SHA 包含：§31 提案全路径原 actor 栅栏、§32 只读核实 HomeFlow 已批准但尚未入账的成员 UI、§33 owner-only 旧支付来源 stable ID 差异核对 API 与 UI，包含真实 SQLite/VM/静态回归。已知中间提交导致旧 WebKit 运行 cancelled，不影响此精确最终 HEAD 的双绿结论。
- 同时核查本次 HomeFlow 唯一交接 docs-only main SHA bd10b767be5581a971777a8d92e4f8ba83889e4c 的 [Validate HomeFlow #43540129842](https://github.com/PTamako/homeflow/actions/runs/43540129842) **completed/success**；未触发生产 Deploy 工作流。交接继续单独更新，不合并任何功能 Draft。
- **自动化验收不能替代** 两名真实用户 iPhone PWA、Safari 首次授权/退号/断网切号、真实 OAuth 和原生产账簿数据的无损迁移校验。Stage C 金融 stable ID 仅已完成核对差异工具，历史旧流水并未自动回填；Stage D 家庭审核证明不能代替实际财务目标执行器及 applied 回报。所有生产 Cloudflare D1/R2/Workers/Pages/Secrets/flag 原样，未合并或部署功能代码，也未重建 Preview。A 用户已做的 Mac 本地备份恢复 PASS 不改变 F 生产上线授权限制。


## 35. 2026-11-14 文书助手 Draft #97：迟到审批预览的双用户/双文书身份隔离（代码与回归已提交）

- 继续原 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)、branch `feature/homeflow-identity-link-safety-20261113`，不新开 PR。检查 `web/src/App.vue` 发现旧 `async prepareCandidate(item)` 直接在等待 `/api/candidates/{id}/preview` 后把私人候选、HomeFlow 审批相关字段、家庭成员候选名单和目标支付来源写入全局 reactive 状态、强行打开 `sheet='candidate'`；虽然底层 `api()` 原本已核对 `accountEpoch`，但同账号切换文书/候选、弹出其他表单或上一个 PWA 账号异常回执仍有陈旧 UI 状态风险。
- 实际修复：`web/src/App.vue` 增 `candidatePreviewSerial`；每次准备预览捕获 **原 accountEpoch、detailOpenSerial、documentId、candidateId、原 sheet 状态及预览代次**，网络回执后先确认全部相同、该候选仍属于当前文书列表才开始设置任何字段/打开弹窗；第二次点击另一个候选会让第一个迟到回执失效；退出/身份更换 `clearPrivateWorkspace()` 同步失效全部旧预览；旧请求失败仅在当前文书/用户还匹配时显示错误。代码 Commit `226bc189a76253916f1d347a6dbc12e7712733a9`。
- 新 `tests/document-member-approval-preview-epoch.test.js` 用 Node VM **实际执行真实 Vue 函数体** 和人为延迟 Promise，覆盖「候选 A 晚于候选 B 回来不可覆盖 B」「文书 A→B 后旧审批表单不可重开」「账号登出并收到旧异常不可向新账号弹出」及源码栅栏检查。测试 Commit `c5a0ed7758fc508e6c5d749f1a6df5c1de64a70d`。
- 此模块属 **Stage E UI 私有内容防串号**，不涉及新业务目标写入，也不代表 Stage D 文书→家計簿/家庭任务/知学 **真正经 HomeFlow 可信审批后目标执行器** 已存在。HomeFlow 当前 execute 仅支持受限现金入账，不要将文书审批状态 `approved` 伪作 `applied`。
- 原 #97 代码 HEAD `c5a0ed7758fc508e6c5d749f1a6df5c1de64a70d` 的 GitHub Pre-merge CI **尚需精确核验**；成功前本模块不能标为自动化全绿，失败需按具体日志修复。全部功能 PR 保持 open/Draft，不运行生产迁移、不触发 Workers/Pages/D1/R2 部署、不启用功能开关、不创建 Preview；A 用户 Mac 本地备份恢复 PASS，不代替 F 生产发布授权。


## 36. 2026-11-14 文书助手 #97 Stage E：迟到审批提交/状态回执的界面隔离与防锁死（代码提交；精确新 HEAD 需验 CI）

- §35 前一个 Document Assistant Draft #97 预览模块，精确 HEAD `c5a0ed7758fc508e6c5d749f1a6df5c1de64a70d` 的 [Pre-merge #43541162460](https://github.com/PTamako/jp-document-assistant/actions/runs/43541162460) 已 `completed/success`，前一代码 HEAD `e702c28e424fd99f093767d0b63f0fabd9537865` 的 [Pre-merge #43541297977](https://github.com/PTamako/jp-document-assistant/actions/runs/43541297977) 也已 `completed/success`（但其后新测试须单独验）。
- 本轮在原 `web/src/App.vue` 修复 `commitApprovedCandidate()`：原 `stillCurrent()` 只验证 `accountEpoch`，同一用户切换文书、候选或关闭审批弹层后，迟到的 HomeFlow 回执仍可能改动当前审批 UI、重新打开旧文书并显示错误 toast。现在每笔提交绑定原 `accountEpoch + detailOpenSerial + document.id + candidate.id + sheet='candidate'`。不属于当前页面的旧回执不更新审批表单、不会导航回旧文书；旧请求在同账号完成时仍释放 busy，避免用户在关闭弹窗后永远无法操作。成功后刷新本份文书使用独立 refresh serial，仅在原刷新仍当前时显示结果。代码 Commit `e702c28e424fd99f093767d0b63f0fabd9537865`。
- 同时修复 `checkCandidateApprovalStatus()` 的旧 `finally`：此前 `if(stillCurrent())busy=false` 会因为用户关闭表单/切换文书而永远保留 busy=true；现在本账号代次仍有效时正常释放该请求锁，新账号时代次失效不触动新账号工作区。
- 新 `tests/document-member-approval-reply-epoch.test.js` 实际 Node VM 运行 App.vue 里的两个真实 async 方法：关闭审批表单时晚到 status 不能显示旧批准且 busy 会释放；提交时切换到第二份文书后不能设置旧 HomeFlow 状态、刷新旧文书或弹成功提示；账户登出之后的旧失败不能污染新账号；当前用户正常的已提交回执仍只显示待审批，不假装目标已同步。测试 Commit `5ecf30cb63225441d8b1c474632674c383d15356`。
- 精确最新 HEAD `5ecf30cb63225441d8b1c474632674c383d15356` 的 [Pre-merge CI #43541374689](https://github.com/PTamako/jp-document-assistant/actions/runs/43541374689) 首次核查 `in_progress`；**必须查询最新结果，失败则按日志修复，不可沿用旧绿色作为新测试通过证据**。
- 本次只改原文书助手 Draft #97 与唯一 HomeFlow 交接 docs，未修改任何线上 Secrets/Workers/Pages/D1/R2、未合并/部署功能 Draft、未重建 Preview。阶段 D 文书审批后的跨应用可信目标执行器仍没完成；申请 `approved` 不是目标 `applied`，iPhone 双人真机授权/切号/断网仍须验收。阶段 A 本地加密备份恢复已 PASS，但 F 生产迁移/上线授权仍需单独确认。


## 37. 2026-11-14 文书助手 #97 §36 最终 CI 已通过

- 对文书助手原 Draft #97 的精确 HEAD 5ecf30cb63225441d8b1c474632674c383d15356 重新查询 GitHub Actions：[Pre-merge CI #43541374689](https://github.com/PTamako/jp-document-assistant/actions/runs/43541374689) 已 confirmed completed/success；§35 预览安全测试 HEAD c5a0ed7758fc508e6c5d749f1a6df5c1de64a70d 的 [CI #43541162460](https://github.com/PTamako/jp-document-assistant/actions/runs/43541162460) 也 confirmed completed/success。两模块均为原 Draft #97、没有合并或生产部署。此前后端 §23 版本校验已有独立成功测试。
- 已通过的是迟到私有候选预览、审批状态/提交回执对跨账号/跨文书 UI 的阻断及同账号 busy 解锁；不是 HomeFlow approved 后真正写入家計簿/HomeFlow 任务/知学目标的执行链，也不是双人真机 iOS PWA 验收。该权限边界继续严格阻断。

## 38. 2026-11-14 知学 #179 Stage E：旧每日任务待同步队列与语言掌握回执账号代次保护（CI 最新 HEAD 待验）

- 继续原知学 [Draft PR #179](https://github.com/PTamako/it-study-platform/pull/179)，branch feature/homeflow-identity-isolated-20261113；不合并、不开 Preview、不触发生产。
- src/App.vue：旧单密码 saveDailyTask() 在创建 pending 前检查 legacyWorkCurrent(actorGeneration)，每条排队 POST 真正发送前再次检查，网络完成后检查，远端错误解析后再次检查。这样切换 HomeFlow 账号之后不会继续发送尚未发出的原账号每日任务队列，也不会以迟到成功回执删除旧设备 zhixue:daily-pending-v1 或覆盖新身份错误提示。loadCloudDashboard() 的数据/错误仅在发起时同一代次生效；hydrateCloudProgress() 捕获旧身份 epoch，原 mastery hydrate callback 在回写 zhixue:mastery-imported-v1 前校验；language-review 网络回执写入之前再次检验，拒绝跨账号异步混合。业务代码 Commit 1580735c87ecaf44422dda18a4fb532c71b52fb2；原 legacy 数据快照不会删除或自动归给新 member。
- 新 scripts/homeflow-legacy-daily-epoch.test.mjs 用真实 Vue 方法体和延迟 Promise 覆盖已经发出的 POST 切号后不能删本地 pending、等待前序 Promise 的旧写入不可启动、同一登录正常成功清空 pending、云端 dashboard 迟到数据不可污染 UI，以及 mastery 回调源检查；测试 Commit ec711144a9fdf67740df43bdfa6aa9da0c6eeefe；快速 CI 增补该回归 Commit d0a525dd2665750f8dfc37563b27f51f627f7c49。
- 准确失败记录：业务代码首个 HEAD 1580735c 的 [Validate #43541626007](https://github.com/PTamako/it-study-platform/actions/runs/43541626007) completed/failure；新增快速回归后 HEAD d0a525dd 的 [Validate #43541743729](https://github.com/PTamako/it-study-platform/actions/runs/43541743729) completed/failure。日志确认为旧 scripts/daily-task-runtime.test.mjs 的单独 VM 测试切片缺少 App.vue 外层定义的 legacyOperationGeneration/legacyWorkCurrent，7 个旧每日任务测试在尚未发真实请求前失败并带未处理的 ReferenceError；不是用来证明防串号业务测试失败。已补完整真实模拟的 login generation 与 actor 守卫，明确旧会话失效需要代次增加，保持旧测试全数保留，测试修复 Commit fe4e7fd848440a145b09945a73c8de692effd153。
- 当前精确新 HEAD fe4e7fd848440a145b09945a73c8de692effd153 的 [Validate #43541838350](https://github.com/PTamako/it-study-platform/actions/runs/43541838350) 首次核查 in_progress，必须等 job 真实 completed/success 后才能宣称本轮全绿。其他旧 WebKit/缓存/离线 IndexedDB 全归属、真机双人 PWA、Study 与文书目标受信执行联动仍未完成。所有正式 Cloudflare 环境、数据、Secrets 和应用开关未改，A Mac 本地加密备份/恢复 PASS 不等于 F 生产上线授权。


## 39. 2026-11-14 知学 #179 §38 精确最终 CI 已通过（仍仅 Draft）

- 已核验原知学 [Draft #179](https://github.com/PTamako/it-study-platform/pull/179) 最终 HEAD **ed0b6da560c6647eb1adfbe92db5bef0bef55c8a** 的 [Validate #43542029507](https://github.com/PTamako/it-study-platform/actions/runs/43542029507) **completed/success**，其中 “Fast identity and type checks” 和包含完整 Node tests、语言语料校验、Vue 构建、完整本地 D1 migration chain 与 Worker dry-run 的完整 validate 都通过。没有运行正式 D1 迁移。
- §38 中间 HEAD fe4e7fd848440a145b09945a73c8de692effd153 的 [CI #43541838350](https://github.com/PTamako/it-study-platform/actions/runs/43541838350) 曾 completed/failure：7 项原 daily-task VM 环境缺少代次问题修复后，只余一项旧会话交接测试在“第一笔请求还未进入 fetch”时提前切号，导致保护逻辑正确取消了尚未发送的旧请求，而测试将新登录的第一笔请求误当旧请求。没有降低安全约束；旧测试改用明确的 firstStarted Promise 屏障，保证旧请求真实发出后才模拟切号并检查迟到回执不可清除新 pending。修复 Commit **ed0b6da560c6647eb1adfbe92db5bef0bef55c8a**；最终 #43542029507 完整成功。所有原测试仍保留。
- 此绿色 HEAD 涵盖旧每日任务离线 pending 队列排队期间切号保护、dashboard 迟到回执拒绝、语言掌握缓存回写及 review 收据同一身份代次检查、新增 VM 延时回归和原每日任务测试更新。**仍未完成**其他本地字典、单词、IndexedDB、离线历史数据完整 owner-proof 分区，以及文书→个人知学受信执行等 Stage E 部分。
- 本次仅原知学 Draft #179 及 HomeFlow 唯一交接 docs/main 更新，未合并功能 PR，未改 Cloudflare 生产 Worker/Pages/D1/R2/Secrets、未启用新 SSO、未创建 Preview。A Mac 本地加密备份和隔离恢复 PASS，不能代替 F 生产发布授权。


## 40. 2026-11-14 HomeFlow #306：目标 409 不再误标为终态冲突；审批反馈保留（精确 CI 通过）

- 继续原 [HomeFlow Draft #306](https://github.com/PTamako/homeflow/pull/306)，branch `feature/family-approval-state-machine-20261113`，基于原 #305 身份读契约分支；不合并、不部署。审查 `worker/approval-execution.js` 发现目标家計簿 Worker 返回任意 HTTP 409（可能是临时审批 proof 状态、目标幂等日志尚待恢复、或先前已应用但回执遗失）时，原 HomeFlow 不核对证明便直接把 `household_approval_requests.status` 置为终态 `conflict`。这会阻断后续按同一 ID 安全对账，且无法据此证明财务操作最终未入账。
- 修复 Commit `fe45cbaf3d27a04de33621e6c46ba53c0ef74bde`：目标 HTTP 409 一律按结果未确认处理，仅使用原 nonce 租约的原子 `statusChange(...,'failed_retryable','target_conflict_unconfirmed')` 释放执行锁；仅返回 `503 target_conflict_unconfirmed_safe_to_retry`（D1 状态更改失败时返回 `receipt_reconciliation_required`）。**绝不把目标错误视为已 applied，也不擅自创建新审批 ID 或目标账单**。目标仍以 immutable approval ID 和一笔入账 journal 做幂等确认。签名验证、owner/current membership、cash-only、lease 和实际 applied 回执要求不放宽。
- 新真实 SQLite 回归写入 `tests/household-approvals.test.mjs` Commit `41893e69bc3618f6f4ccbc78a22e106eb43182db`：owner 提交获批账务，目标第 1 次返回 409，HomeFlow 必须保留 `failed_retryable`、清理 nonce/lease、无终态 conflict/applied 假事件；原 approval ID 第二次由目标提交合法 `already_applied:true` 回执，才迁移至 `applied`；检查 attempt=2、nonce 更新且不能产生第二份审批/第二次 applied 事件。
- UI `src/components/ApprovalCenter.vue` Commit `9a191861d850506456678c5f40a919f37668d3ad`：先前 act() 设置「已执行并入账」或错误提示后 `finally await load(true)` 立即清掉 feedback；现行动后 `load(true,true)` 保留反馈，普通用户手动刷新仍清旧反馈，目标不确定回执显示中文安全重试/不要创建新账单提醒。新增真正运行 Vue 原方法的 Node VM `tests/approval-execution-feedback.test.mjs` Commit `337c773c486f27d6a93c2d8081f0802b4908a4c1`，验证成功、503 不确定、刷新后的消息保留与手动刷新清理。
- **精确最终 HEAD `337c773c486f27d6a93c2d8081f0802b4908a4c1`** 的 [Validate HomeFlow #43543435519](https://github.com/PTamako/homeflow/actions/runs/43543435519) 已真实查为 `completed/success`，包含真实 SQLite、VM/UI 与 typechecked Vue build。仍是 open/Draft #306，不是上线，也未跑正式 D1 迁移。当前仅受限 Kakeibo cash `finance.entry.create` 的可信执行器存在；文书/其他账户和通知闭环未完成。

## 41. 2026-11-14 家計簿 #309：旧数据归属认领操作绑定原 HomeFlow 用户（最新 CI 待验）

- 原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 的历史银行卡/储值卡 `POST /api/family-finance/legacy/adopt` 和旧固定费用、SBI、卡账单 `POST /api/family-finance/legacy/resource-owners` 都是不可逆的原 owner 归属标记操作，过去仅验证新鲜 Cookie 当前 role=owner 而未检查 PWA 操作发起时的账号身份。共享 iPhone 切换 HomeFlow 用户后若旧请求迟到，可能被当前另一 owner 错认领。
- `functions/api/family-finance/[[path]].js` 的 adoptLegacy 在读取历史资源或 D1 写入之前强制 `input.expected_user_id===user.user_id`（无/错号为 `403 ACTOR_CHANGED`），只允许确认和原 actor 两个明确字段；代码 Commit `3bf28130641f41863e4591ae663ac46e9a7def48`。旧资源 owner handler 同样在开始 D1 读写前强制检查原 actor，并严格限制额外字段，Commit `a1e41ef6ff7f0b35add8f6e88ed6f6b0a707a7a2`。不允许由调用方自定义 owner/SQL/家人资源，原先的实时 cookie 身份与 role、owner link、事务写入验证保持不变。
- 真实测试 helper 的旧 actor 自动注入覆盖 `legacy/*` POST，Commit `729ff64f62a470f4dc7498158fe3400637221dc2`；新增 Node SQLite 双用户回归 Commit `d7509d7dfea13263288156f97099e78135b42fd0`：错号/缺 ID 的两种旧 owner 认领一律 403 且原始账户、资源归属、审计无变化；本 owner 精确身份仍可正常领回。
- 中间 HEAD `729ff64f62a470f4dc7498158fe3400637221dc2` 的 [Validate #43543592146](https://github.com/PTamako/kakebo_jp/actions/runs/43543592146) 和下一 HEAD `d7509d7dfea13263288156f97099e78135b42fd0` 的 [Validate #43543626707](https://github.com/PTamako/kakebo_jp/actions/runs/43543626707) 都 `completed/failure`，日志定位在旧 `tests/family-finance-ui.test.mjs` 硬编码 `ACTOR_CHANGED` 断言数量必须恰好 2，现增加了第三处原 owner 认领身份校验，实际为 3；完整 883 个测试中其余 882 个通过。已保留全部测试并将断言更新为 3，额外验证 resource-owners 的 actor 检查，提交 Commit `90568f183fec7b5792e3816c67d100f4347a7d3c`。
- 最新 HEAD `90568f183fec7b5792e3816c67d100f4347a7d3c` 的 [Validate #43543748110](https://github.com/PTamako/kakebo_jp/actions/runs/43543748110) 首次核查 `in_progress`、[Mobile WebKit #43543748109](https://github.com/PTamako/kakebo_jp/actions/runs/43543748109) `queued`；**必须等精确 HEAD 真实最终结果再标绿**，失败继续修复。仍未完成旧金融 stable ID 全业务无损迁移与真正双人 iPhone PWA 验收。全程生产 Cloudflare D1/R2/Worker/Pages/Secrets/flags 未改、未创建 Preview 或合并功能 Draft；A 用户已在 Mac 完成的加密备份/恢复 PASS 不等于 F 上线授权。


## 42. 2026-11-14 §41 家計簿 #309 最终 CI：双绿，旧资源原 actor 认领安全回归完成（仍 Draft）

- 精确最新代码 HEAD `90568f183fec7b5792e3816c67d100f4347a7d3c` 重新查得：原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 保持 open/Draft；[Validate #43543748110](https://github.com/PTamako/kakebo_jp/actions/runs/43543748110) 为 **completed/success**，并且 [Mobile WebKit Smoke #43543748109](https://github.com/PTamako/kakebo_jp/actions/runs/43543748109) 为 **completed/success**。这两条属于最终代码 SHA，不是中途 3bf/729/d750 的中间 Actions；旧硬编码断言错误已被修正而非删掉旧用例。
- 本模块已可用代码与真实 SQLite 验证：旧银行卡/储值账户与固定费/SBI/卡账单历史 owner 认领的写入必须同时满足当前真实 HomeFlow 管理员角色与 **操作发起时相同 user_id**；错号/缺号不会修改历史表、归属标记或审计事件。**尚未**在生产运行归属认领，亦未自动将历史流水 family_account_id 回填；真实两人 iPhone PWA 验收仍需另行进行。
- 上轮 HomeFlow #306 精确 HEAD `337c773c486f27d6a93c2d8081f0802b4908a4c1` 的 [Validate #43543435519](https://github.com/PTamako/homeflow/actions/runs/43543435519) 同样 completed/success，且原 HomeFlow #305、家計簿 #309、知学 #179、文书助手 #97 都仍保留功能 Draft，不合并。全部生产 Cloudflare D1/R2/Worker/Pages/Secrets/flags 未改、未新建 Preview；A 用户 Mac 加密备份/恢复 PASS 不改变 F 生产上线的独立批准要求。


## 43. 2026-11-14 家計簿 #309 Stage D：现金以外不可执行审批前置拒绝（最终 WebKit 待验）

- 检查原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 与 HomeFlow #306 实际执行链发现产品缺口：家計簿成员加密财务草稿支持现金、信用卡、储值卡、积分、证券等本人账户，但目前唯一受信执行器明确仅支持本人创建的 **cash** 账户。旧 `POST /api/family-finance/proposals/{id}/submit` 不检查账户类型，可能把无法实际入账的信用卡等草稿提交 HomeFlow，经 owner 审批后在家庭审批中心显示「执行入账」，最后目标 409/失败重试，用户误以为审核可以入账。
- 服务端 `functions/api/family-finance/approval-submit.js` 的本人成员+家庭+未归档账户 SQL 额外读取 `a.account_kind,a.origin`，只允许准备态、本人创建 `account_kind='cash'/origin='member_created'` 申请实际提交到 HomeFlow；其他类型明确 `409 ACCOUNT_TYPE_NOT_EXECUTABLE`、`applied:false`、`ledger_changed:false`，**阻止发送 HomeFlow 审批与更改申请 state/审计**，不删除旧加密草稿。已存在的 submitted（例如未来独立迁移数据）先走现有严格幂等 replay，不暗改状态。代码 Commit `b236cf1039418be465220517c00051fe79aaa153`。
- `src/FamilyFinanceProposals.vue` 仍支持成员保存非现金账户加密草稿，但仅可对本人未归档、member_created 现金账户显示可用「提交审批」按钮；非现金草稿显示「目前仅本人现金账户可提交并实际执行；其他账户草稿继续保留」，内部 `action(item,'submit')` 同样校验，杜绝绕过 UI。成功保存非现金草稿提示「等待后续功能」不误导。代码 Commit `0f760f9b61eb92c5e8967132c43384eb6290faf3`。
- 旧真实 SQLite 测试中的「HomeFlow 已审批回执验证」「远程回复丢失后同一申请重试」属于**受支持的现金审批路径**，对应测试账户从 credit_card 改为 cash，业务测试本身完整保留；新 `tests/homeflow-sso-isolated.test.mjs` 真实 D1 遍历 credit_card/prepaid/securities 三种本人新账户：允许创建加密草稿，但全部不能 submit，确保无 HomeFlow submit 请求、无新增原 entries、无 `finance_entry_submitted` 审计，草稿仍原样 prepared。代码/测试 Commit `9d94c146d76c9489e1d75c50037e6d585f6417b4`。静态 UI/安全接口防退化回归 Commit `e0de70f6698a8a1e1aba5c488ace4349ff448599`。
- 最终精确 HEAD `e0de70f6698a8a1e1aba5c488ace4349ff448599` 的 [Validate #43544276058](https://github.com/PTamako/kakebo_jp/actions/runs/43544276058) 经重新核查 **completed/success**；[Mobile WebKit Smoke #43544276142](https://github.com/PTamako/kakebo_jp/actions/runs/43544276142) 此刻 `in_progress`，必须等它最终完成并记录，不可提前宣称全绿。先前中间 Commit 的取消/红灯不能代替最终 HEAD 结果。
- 这属于 **Stage D 安全范围约束**，不代表非现金受信执行器已实现；需要以后逐一设计信用卡出账/结算日、预付卡余额、SBI 投信分账和严格幂等会计语义。当前 HomeFlow #306 仍只有 cash executor；双人真实 iPhone PWA、文书助手审批后的可信联动、历史 stable ID 全量迁移仍未完成。所有项目功能 PR 仍 Draft，**未改 Cloudflare 生产 D1/Worker/Pages/R2/Secrets/flags，未合并/部署或重建 Preview**。A 用户 Mac 全量加密备份/恢复 PASS 不代表 F 上线批准。


## 44. 2026-11-14 §43 家計簿现金执行边界：精确最终 CI 双绿（仍 Draft、正式环境未改）

- 已对原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 最终 **代码** HEAD `e0de70f6698a8a1e1aba5c488ace4349ff448599` 直接核验 Actions：[Validate #43544276058](https://github.com/PTamako/kakebo_jp/actions/runs/43544276058) **completed/success**、[Mobile WebKit Smoke #43544276142](https://github.com/PTamako/kakebo_jp/actions/runs/43544276142) **completed/success**。此最终 SHA 包含 cash-only 后端审核提交拦截、非现金可留加密草稿的移动端提示和真正 SQLite 回归；无需引用中间 Commit 被取消的 CI。
- 对 Stage D 真实能力边界的明确结论：**只有本人新建、未归档的现金账户草稿支持提交 HomeFlow 审批并在管理员执行后由家計簿签名后端写入账本**。信用卡、储值卡、证券、积分等非现金草稿不会被自动删除，但**暂不能提交并执行**，必须待独立、经会计语义验收的对应执行器才能开放。此 green CI 不代表非现金已开发完，也不代表真实两个 iPhone PWA 授权已验收。
- 本轮 HomeFlow #306 目标 409 安全重试和 UI 回执持久提示的完整 Validate #43543435519 也为 completed/success；家計簿上一模块 §42 的 Validate #43543748110 / Mobile WebKit #43543748109 双绿。本轮所有功能仍为原 open/Draft PR，正式环境 Cloudflare 未改，仍禁止生产 D1 迁移、启用 flags、合并部署、删除旧资源或重建 Preview。A 用户在 Mac 做过的加密备份与恢复 PASS 仍不是 F 生产发布授权。


## 45. 2026-11-14 家計簿 #309 Stage C：旧流水逐笔无损 stable ID 回填（功能代码已实现、默认 OFF，精确 CI 部分通过）

- 继续**原** [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，branch `feature/homeflow-sso-isolated-foundation-20261113`。核对§33/§44 后，历史 `payment_sources` 已有双证明 owner 领取与只读差异工具，但旧 `entries.family_account_id` 仍没有可执行、可审计、可验证原始记录未变的安全回填；生产绝对不能从显示名称推断成员归属。
- 实际新增 **Stage C 独立、默认关闭** 的 `migrations/0027_family_legacy_entry_link_audit.sql`（Commit `ff7ecb0e6b6b6879c11cfcaa3a42d8e1f74e0b31`），仅创建 `family_finance_legacy_entry_links` 不可更改/不可删除的逐笔审计及索引、schema migration marker；**迁移文件并未在 Cloudflare 正式 D1 执行**。使用独立审计而非改动原历史字段或 HomeFlow 审批 journal；不强制限制旧 `entries` 的正常回收站删除路径。
- 新 `functions/api/family-finance/legacy-entry-links.js`（Commit `455d29cdd4efc674de31a503748f562dcc6d7d9a`），在既有强验证 HomeFlow SSO 的 family-finance 路由下提供 `GET/POST /api/family-finance/legacy/entry-links`（路由 Commit `c9d49dd2ba20cb61191703dd7650b28f8d20849c`）。**必须同时满足 `APP_ENV='production'` 和新独立 `KAKEIBO_LEGACY_ENTRY_LINKS_ENABLED='true'`、实时 HomeFlow owner、`homeflow_identity_links` 中本 household active owner；默认 flag 缺失即 503，当前 Draft 不写生产**。GET 只显示最多 5 条确切 `payment_sources.name === entries.payment_source === legacy_source_name` 的原用户已领回旧金融账户收支，返回稳定 ID、日期、金额、分类、原来源与对旧行全部字段和目标账户 ID 计算的 SHA-256 指纹，不返回 OCR 私人原文。历史 `transfer` 不会自动关联，因转账要独立解释来源/目标两方向；未匹配/被删除来源及同名 member_created 账户也不会被猜测归属。
- POST 必须 owner **原始发起用户 `expected_user_id`** 与当前源 session 严格匹配、`confirm:true`、单条 `entry_id/account_id/source_digest` 且 payload 字段白名单正确。服务器重新读取真实原始记录与关联账户证明，对比指纹并在实际 SQL UPDATE 中逐一核对原行所有字段、仍为未关联、且目标仍为原 owner 的 legacy 来源。仅执行 `SET family_account_id=?`，同一个 D1 原子 `batch` 内写入不可变的逐笔 receipt；任何失败/账号变更/编辑竞态/审计重复会保守拒绝或原子回滚。重放相同 receipt 只返回 `already_linked:true`，**绝不修改金额、分类、日期、商家、原支付方式、资产、转账、SBI、卡账单或 R2**。
- 管理员专用的默认收起 `src/FamilyFinanceLegacyLink.vue`（Commit `f5224406f849b7bda185ffe1bfc476d36d2fada1`）提供 5 项一页的本地 UI 预览、逐笔二次明确确认、回执核验与切号/换文书式异步身份隔离，未开放时仅说明默认关闭、不自动写入；在 `FamilyFinanceAccess.vue` 只为经验证原 owner 挂载（Commit `5f1ce0af5fd4dce8ef0f737727360378331c16de`），未引入定时轮询、浏览器私有数据缓存或新审批/财务入账入口。
- 实际 SQLite 全链路 `tests/homeflow-sso-isolated.test.mjs`（Commit `e1de2cea36fb224bce5380fc520d3b08993da506`）引入 0027 迁移，证明 flag OFF 503、member 禁用、owner 领回前 0 可链接、双用户**同名信用卡**不能串号、错 actor/伪 account 403/409、原流水除 `family_account_id` 外所有列逐值完全不变、`payment_sources` 未变、单条不可变审计、重复重放不追加审计、编辑后的旧 digest 409、在 read→SQL batch 中途另一写者改商家也要 409 且无未审计 link、transfer 保持未关联。旧原型差异导致首次精确 HEAD f395854e 的 [Validate #43546822504](https://github.com/PTamako/kakebo_jp/actions/runs/43546822504) 失败（888/889 通过），修复并保留最严格全字段语义比对（Commit `e7373942c7ce6c18a943dbac1303486e77607573`）；此 SHA 的 [Validate #43547044105](https://github.com/PTamako/kakebo_jp/actions/runs/43547044105) **completed/success**，WebKit #43547044125 当时仍在运行。
- UI 防退化测试 `tests/family-finance-ui.test.mjs` Commit `f395854e14e2a21468a1fb5427134df2295b70a2`；整个模块只有代码、测试和被默认关闭的接口，**没有执行生产迁移、实际数据回填、发布或开启任何 flag**。

## 46. 2026-11-14 家計簿 #309 Stage C：区分历史账户认领与已关联流水笔数（精确 Validate 绿灯，最新 WebKit 待验）

- 原 `GET /legacy/mapping-audit` 之前的 `mapped_source_count` 仅说明旧账户名称已经领回，不能判断实际历史 `entries.family_account_id` 回填了多少，容易误把“来源已认领”当作“原流水已迁移”。现增加只读有界 D1 SQL，对本 household 原 owner 的 `origin='legacy'` 且 `entries.family_account_id=account_id`、`entries.payment_source=legacy_source_name`、`entries.type IN ('expense','income')` 的精确已关联计数与旧字段仍未关联数量独立汇总；不包括其他成员同名账户、转账、无目标 ID 的自动猜测。
- 后端 Commit `f02d93584efd344311a353cae86621a8b02fe2ff` 与历史已关联但旧来源设置已经移除时的名称列表修正 Commit `e11bb0e84b7c2215c4de9ec4e24bb56d56569a93`，多加了 `items[].linked_entry_count`、`linked_legacy_entry_count`、`remaining_legacy_entry_count`。原 `entry_source_count` 保留，且新字段逐一数值校验、最大 300 来源 fail-closed。管理员 UI `src/FamilyFinanceMappingAudit.vue` 新展示“原管理员历史收支已关联 / 待关联”，与“账户来源已认领 / 待认领”分离（Commit `a7dbf6f098b1c4557d3d1ab23cc234cebf70dff3`）。
- 测试更新：真实 SQLite 先 owner 领回旧 PayPay Visa、逐笔关联原支出 ID=1，再 GET 审计需回报 PayPay Visa **已关联 1、未关联 0**，且一笔未匹配的旧「银行」工资仍未关联；Commit `90e70d75ab48ee59cf7ce231fd1c704af864038a`。静态无写 SQL/owner 过滤/UI 计数回归 Commit `4baa91792619c6cc6249db065211ad03bf28b005`。此提交的 [Validate #43547399487](https://github.com/PTamako/kakebo_jp/actions/runs/43547399487) 因引入模块变量 `linked` 与原 owner proof 同名造成 SyntaxError，已重命名成 `linkedRows` 并保留所有测试，修复 Commit `7d0b9f7d4fc8b02eea797512cac85910857bb2ba`。
- 对**最新精确代码 HEAD `7d0b9f7d4fc8b02eea797512cac85910857bb2ba`** 的 [Validate #43547540470](https://github.com/PTamako/kakebo_jp/actions/runs/43547540470) 已真实核查为 **completed/success**；对应 [Mobile WebKit #43547540483](https://github.com/PTamako/kakebo_jp/actions/runs/43547540483) 首次查询为 `pending/in_progress`，**需另查精确最终结果后才能宣称两个 CI 全绿**。
- 未完成：并非已实际迁移正式数据，转账必须有独立双向会计设计，历史被删支付来源/商家规则、卡账单/SBI/固定费/积分等原表仍需无损稳定账户引用，非现金审批执行器未开发，HomeFlow–文书助手–知学后端联动与真实双人 iPhone PWA 验收仍未完成。新迁移 SQL、执行 flag 和按钮均只在 Draft #309，**没有动 Cloudflare 正式 D1/R2/Workers/Pages/Secrets、没有合并 PR、没有生产 flag、没有 Preview 资源**。A 用户在 Mac 完成加密备份及独立恢复 PASS，但 F 生产上线授权还需独立确认。


## 47. 2026-11-14 家計簿 #309 §45～§46 最新代码 CI 双绿；仅 Draft 安全交付

- 对家計簿原 [Draft PR #309](https://github.com/PTamako/kakebo_jp/pull/309) **精确最终代码 HEAD `7d0b9f7d4fc8b02eea797512cac85910857bb2ba`** 重新拉取 Actions，确认 [Validate #43547540470](https://github.com/PTamako/kakebo_jp/actions/runs/43547540470) **completed/success**，且 [Mobile WebKit Smoke #43547540483](https://github.com/PTamako/kakebo_jp/actions/runs/43547540483) **completed/success**；此最终 SHA 包含§45 逐笔 stable ID 关联 SQL/服务端/管理员 UI/真实 SQLite 回归及§46 区分“账户已认领”和“旧流水已关联”的进度统计，亦包含修复旧测试对象原型比较与新统计模块变量重名后结果；不是沿用旧 HEAD 或中间失败/取消的 CI。
- **安全边界**：逐笔历史流水关联接口需单独 `KAKEIBO_LEGACY_ENTRY_LINKS_ENABLED=true`、原 owner 实时 HomeFlow proof、原主人的 `expected_user_id` 与不可变记录指纹，且每笔明确二次确认。当前生产 flag **未启用**、migration 0027 **未在正式 D1 执行**、没有任何正式旧 `entries` 被回填或修改；旧支付方式和所有财务列的保留已在真实 SQLite 测试核验，**不等于生产迁移完成**。转账多资产双向归属、信用卡/储值/SBI 资源、跨应用执行器和双人真实 iPhone PWA 仍为后续 Stage C～E 工作。
- 其他四应用功能 Draft 状态与生产封存禁令不变：不合并会自动部署的 PR，不调整正式 Workers/Pages/D1/R2/Secrets/功能开关，不创建 Preview，不将 A Mac 加密备份+隔离恢复的成功视为自动 F 上线授权。唯一交接 docs 可以按已经验证过的 docs-only 不部署流程更新 main。


## 48. 2026-11-14 家計簿 #309 Stage C：原转账双向稳定账户关联（真实代码与 SQLite 测试已提交；独立 flag 默认 OFF）

- **接手时状态**：唯一交接 docs/main 至 §47，四应用 HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 的功能 PR 均 open/Draft。原家計簿 #309 HEAD `7d0b9f7d4fc8b02eea797512cac85910857bb2ba` 的 Validate #43547540470 / Mobile WebKit #43547540483 已 completed/success，§45～§47 的原收支逐笔旧 stable ID 关联仅适用 income/expense，**transfer 不能单侧链接**。
- **本轮实际开发继续同一** [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)、原 branch `feature/homeflow-sso-isolated-foundation-20261113`。新增尚未执行的 `migrations/0028_family_legacy_transfer_ids.sql`：仅向原 `entries` 新增独立 `family_transfer_target_account_id` FK + index；使用已有 `entries.family_account_id` 表示来源；新 `family_finance_legacy_transfer_links` sidecar 记录单次不可更改/删除的 `entry_id`、源/目标 stable IDs、原始来源/目标名称、SHA-256 指纹、原 owner actor、household 和时间，并有 INSERT 前源/目标账户归属与原流水一致性 D1 trigger、append-only UPDATE/DELETE trigger。**不会更新任何现有旧条目，也不修改原转账删除/归档语义**。迁移 Commit `d5116fcdbaa6e24ea6e9bdb3783d5fd0cb37469b`，旧转账删除限制修正 Commit `5ad171202ab8b8b101adc194c89d1639f056fb6c`。
- 新 `functions/api/family-finance/legacy-transfer-links.js`，Commit `e2c901b6a3abec07429f856536f8aa288e3f212d`；路由在既有实时 HomeFlow SSO `/api/family-finance/legacy/transfer-links`，Commit `0478378b5bf00aa75c8174efd45157d19997f501`。访问须**双重开关** `APP_ENV='production'` + **新** `KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED='true'` + 新鲜 HomeFlow owner/原 owner active household link；默认缺 flag 即 503。GET 分页最多 5 行，只选择 `type='transfer'`、原始 payment_source 与 transfer_target 都属于原管理员已独立认领的 `origin='legacy'` 账户，并在当前 `payment_sources` 有精确匹配、来源和目标不同、两个 stable ID 当前均为空的历史原转账；预览仅金额/日期/来源/目标/两个稳定 ID/原 `transfer_applied` 状态及原记录全部列+ID 的 SHA-256 指纹，不含 OCR 原文。
- POST 强制 Origin+JSON、无 extra 字段、原用户 `expected_user_id` == 真实当前 SSO owner、`confirm:true`、同一真实转账 `entry_id`、**不同** `source_account_id` 和 `target_account_id`、旧响应指纹匹配；数据库再查双账户 owner proof 与每列原值。一个 D1 `batch` 原子地 **同时** `SET family_account_id=?, family_transfer_target_account_id=?`，以全行 SQL 条件和双 owner 独立 EXISTS 保护竞态，并 INSERT 不可变 sidecar（触发器也验证两端）；任一失败原子回滚，不能发生“只有一侧已关联”，网络重试在同一 `entry_id`/digest/IDs 下安全返回 `already_linked:true`。**仅填两个引用列，不重新执行转账，不动钱、日期、分类、商家、原支付来源、资产、SBI、卡账单、R2，也不计算/改变余额或积累投资**。名称缺失、双向同账户、成员另建同名、单边旧 ID 或无可信 receipt 的条目 fail closed、必须人工审查。
- `src/FamilyFinanceLegacyTransferLink.vue` 管理员默认收起的移动端 5 条/页预览、分行原“转出→账户”和“转入→账户”、二次明确 `window.confirm`、切号/卸载时代次失效、两 ID 回执核验，不保留任何本地财务缓存；Commit `9f760838626d1b41ba544117dffc614788a8efe4`；只在 `src/FamilyFinanceAccess.vue` 已验证 owner 身份挂载 Commit `114f1f9c48a798f288dc597ef50aa2f00c9e2b63`。
- 真正独立本地 SQLite migration 0028+业务回归 `tests/homeflow-sso-isolated.test.mjs` Commit `bfde125fd247e672543518e8559f00060b13fe61`：默认 OFF 503、会员拒绝、未经原 owner 双证明不可预览、原 PayPay Visa→nanaco 双端稳定 ID 原子链接、家庭成员新建同名 nanaco 不能成为旧目标、错号/伪目标/同账户/重复安全重放、保留旧原字段逐项精确一致、审计不可篡改/删除、过期指纹与中途修改目标时双 ID 都必须保持为空、自转账 fail closed；UI/服务端静态回归 Commit `6b782e446c853b2be609824da6726b4c7f55a94e`，包含原证书/旗标安全断言。

## 49. 2026-11-14 家計簿 #309 Stage C：正常收支与转账迁移分别计数、单侧/缺审计强制人工核对

- 先前 `GET /legacy/mapping-audit` 的 `entry_source_count` 把 transfer 源账户也算入了普通收支未关联，会误报收支迁移进度。修复为仅统计 `income/expense`；独立汇总 transfer 两端均未关联 (`remaining_legacy_transfer_count`)、两端均有稳定 ID 且有合法原 owner 不可变关联审计 (`linked_legacy_transfer_count`)、**仅一侧已有 ID** (`partial_legacy_transfer_count`)、**两侧都有 ID 但不能从原 owner 审计确认** (`unverified_linked_transfer_count`)。只读有界 SQL，仅查看表行/分组，不更改旧转账，异常不尝试猜测补写。后端 Commit `4fcda06d74aabc8d31fc9f0f8b4a37e2dec2e755`。
- `src/FamilyFinanceMappingAudit.vue` 分别显示“普通收支已/待关联”和“历史转账双向已/待核对”，单边或缺审计显示必须人工处理的警告，拒绝假装迁移成功；Commit `e8dfd00a80a9244906d211b940a34a5641c1d863`。真实 D1 测试确认 PayPay Visa→nanaco 原 transfer 双 ID 链接后审计数量 1、未链接转账 0、旧未关联收入/支出仍独立统计；另有手工制造“一侧 ID”和“两侧 ID 但无 journal”以确认检测错误不补写；测试 Commits `e3cf2a4843482ed345b6ca9f862a83d0c3c16bac`、`04ccd0b331f360fbadb02d21d2c6d8449720c312`，UI/SQL 防退化 Commit `ca1c794b39c57647603bd41b128942c736fbb37f`。
- **准确 CI 历史**：转账首个完整业务+UI 代码 HEAD `114f1f9c48a798f288dc597ef50aa2f00c9e2b63` 的 [Validate #43548884575](https://github.com/PTamako/kakebo_jp/actions/runs/43548884575) completed/success；新增 UI 静态防退化 HEAD `6b782e446c853b2be609824da6726b4c7f55a94e` 的 [Validate #43548926033](https://github.com/PTamako/kakebo_jp/actions/runs/43548926033) completed/success；转账进度审计 HEAD `ca1c794b39c57647603bd41b128942c736fbb37f` 的 [Validate #43549310803](https://github.com/PTamako/kakebo_jp/actions/runs/43549310803) completed/failure，**895 个测试中 894 个过**：旧测试误以为原始收入/支出只有 1 笔，实际原数据有 PayPay Visa 消费 1 + 银行工资 1，故还待关联 2，*不是 transfer 链接安全失败*。修正测试期望而不删除测试，Commit `b7c5ab576dcb239a6bd008950628f682e1759877`。精确最终 HEAD `b7c5ab576dcb239a6bd008950628f682e1759877` 的 [Validate #43549425053](https://github.com/PTamako/kakebo_jp/actions/runs/43549425053) **completed/success**；[Mobile WebKit Smoke #43549425040](https://github.com/PTamako/kakebo_jp/actions/runs/43549425040) 本次首次查询为 `in_progress`，**需核实最终结果才能标全绿**。
- **严格未完成/部署限制**：迁移 0028 尚未在正式 D1 运行，`KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED` 尚未在生产开启，旧数据没有真实写入；此增量只是历史双向 ID 引用，不是原真实转账重新执行或完整资产余额语义重算；历史卡账单/SBI/固定费/积分资源引用、非现金目标执行器、文书助手和知学的真实受信跨应用执行，以及双人 iPhone/Safari/PWA 真机验收仍待完成。所有四应用功能 PR **保持原 Draft，正式 Cloudflare Workers/Pages/D1/R2/Secrets/flags 没有变化，没有 Preview 创建或 PR 合并**。A Mac 四 D1 + 三 R2 加密备份、隔离恢复均 PASS，F 生产迁移需独立授权。


## 50. 2026-11-14 家計簿 #309 历史转账两侧稳定账户在家庭共享流水展示（只读 API + 真实成员回归）

- 继续原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，原 branch 不变，§48～§49 的新双向 stable ID link 已在单独 flag OFF 的后台服务与 owner UI 实现，但原家庭共享 GET `/api/family-finance/shared/entries` 只返回来源 `family_account_id`/label，转入目标仍只保留 `transfer_target` 旧文字，没有稳定 target ID/owner label。
- 实际只读改动 `functions/api/family-finance/[[path]].js`，Commit `422a622ab231e2b3c717e0093e85cf9913870835`：GET shared/entries 新增 `e.family_transfer_target_account_id`、`COALESCE(t.label,e.transfer_target) AS transfer_target_display`、`t.owner_user_id AS transfer_target_account_owner_user_id`，其中 `t` 仅通过明确稳定 ID JOIN `family_financial_accounts t`，没有按旧显示名称猜测 owner。既有 `payment_source_display` 和 `payment_account_owner_user_id` 源方向保持不变。无任何 POST/PATCH/资产重算、无新增财务字段写入、无泄漏其他应用密码/收据/原文。
- 真正双身份 SQLite 回归加入 `tests/homeflow-sso-isolated.test.mjs`，Commit `38d9f3f0e4b0812cf366258210278047b980e026`：原 owner 安全领取 PayPay Visa 和 nanaco、双向提交一笔历史转账 ID=3 后，使用**另一位 member Cookie** GET shared/entries，源/目标两个 stable ID 必须与签收记录匹配、两个显示名称正确、两个 owner IDs 仍为原 owner；且原 `transfer_target='nanaco'` 文字完全不变。无其他账本操作。
- 精确最终代码 HEAD `38d9f3f0e4b0812cf366258210278047b980e026` 的 [Validate #43549723518](https://github.com/PTamako/kakebo_jp/actions/runs/43549723518) **completed/success**，包含新本地 SQLite 测试/完整构建；[Mobile WebKit #43549723447](https://github.com/PTamako/kakebo_jp/actions/runs/43549723447) 此刻 `in_progress`，要继续按**当前 HEAD** 检查最终结果，不可提前标绿。此前转账模块中间 SHA #43548926033 和统计审计 SHA #43549425053 的 Validate completed/success；#43549310803 初次红灯是两笔原始普通收支误写成一笔，已经保持全部测试并修正，详见 §49。
- **严格边界**：生产 0028 SQL 从未执行、双向写入 `KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED` 从未开启；本次读接口依赖未来 gated schema，现全部在 Draft，**没有实际转账被执行、账本金额被改或 Cloudflare 正式 D1/Workers/Pages/R2/Secrets/flags 被碰触**。仍需信用卡/储值/SBI 业务语义、文书助手跨应用安全目标执行、四应用 PWA 两人真机验收。原所有功能 PR 保持 Draft，不合并，不创建 Preview。A 本地数据备份/恢复 PASS 不能代替 F 发布批准。


## 51. 2026-11-14 家計簿 #309 §48～§50 最终精确 HEAD 双绿；转账双向关联只在 Draft，生产安全禁令继续

- 重新直接核对原 [家計簿 #309](https://github.com/PTamako/kakebo_jp/pull/309) 最终**代码** HEAD `38d9f3f0e4b0812cf366258210278047b980e026`，PR 仍 open/Draft；[Validate #43549723518](https://github.com/PTamako/kakebo_jp/actions/runs/43549723518) **completed/success**，且 **相同 SHA** 的 [Mobile WebKit Smoke #43549723447](https://github.com/PTamako/kakebo_jp/actions/runs/43549723447) 也已 **completed/success**，不沿用旧 HEAD 的绿灯。该代码包含 migrations/0028、默认 OFF 双 ID 转账关联 API/管理员 UI、完整 SQLite 账户证明/乐观并发/双边原子写入+不可变审计、未关联/单边/无审计转账异常检测、双成员家庭只读展示来源和目标账户 ID/名称。
- 本轮自动化通过不是生产迁移或双人实机验收：**没有执行生产 0028 SQL，未启用 `KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED`，没有对真实旧转账回填任何一个稳定 ID，也没有重做任何资金转入/转出。** 后续还需 linked transfer 被编辑后旧字符串与 stable ID 的一致性维护、未匹配历史支付来源和 self-transfer 的人工会计定义、信用卡/储值卡/SBI 等资产语义、可信审批目标执行器、文书助手跨应用执行，以及两个真实 iPhone/Safari/PWA 首次安装与账号隔离。原 HomeFlow #305/#306、家計簿 #309、知学 #179、文书助手 #97 全部功能 Draft 不合并；正式 Cloudflare Workers/Pages/D1/R2/Secrets/flags 不触及，Preview 不重建。A Mac 加密备份和隔离恢复验证 PASS，**不等于已单独批准 F 生产上线**。


## 52. 2026-11-14 家計簿 #309 Stage C：原已关联账目编辑后的 stable ID 一致性保护（代码+真实 SQLite+旧 API 回归通过）

- 从 §51 继续原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) / `feature/homeflow-sso-isolated-foundation-20261113`，原 HEAD `38d9f3f0e4b0812cf366258210278047b980e026`，当时 [Validate #43549723518](https://github.com/PTamako/kakebo_jp/actions/runs/43549723518)、[Mobile WebKit #43549723447](https://github.com/PTamako/kakebo_jp/actions/runs/43549723447) 均已成功。检查 `functions/api/[[path]].js` 发现旧设备的 `PUT /entries/:id`、`POST /payment-sources/update` 与 `rename`、`remove` 仍允许更改已认领来源或已关联转账的原文字段，可能让新 stable ID / 不可变审计与旧支付名称发生漂移。只靠一次性 link INSERT 前验收不足以保证后续一致性。
- 实际新增 **仍未在正式环境执行的** `migrations/0029_family_legacy_identity_guards.sql`，Commit `b92c131862426d2f2ebd1e7ebee61382a22d867f`。只添加数据库保护 trigger 和 schema marker，不自动修改任何历史数据：已写入 `family_finance_legacy_entry_links` 的原普通 income/expense 若被改 type、payment_source、stable `family_account_id` 或冒用审计别名，抛 `LEGACY_ENTRY_IDENTITY_LOCKED`；原转账双端审计已存在时，若改来源、目标、type、来源/目标两个 stable IDs，抛 `LEGACY_TRANSFER_IDENTITY_LOCKED`。非身份字段（金额、备注、日期、分类及符合现有业务约束的转账实际生效状态）可以照旧编辑。已删除的历史行若沿用同一 entry ID 重新插入，必须与原 immutable receipt 的来源/两侧 ID 完全一致，不得让新记录继承旧身份；审核中仍保留既有的回收站删除及合法相同身份恢复路径。已原 owner 认领的 `payment_sources.name` 禁止直接 rename/delete（仍可使用归档或修改 `family_financial_accounts.label` 作为显示名称）。所有触发器只涉及已明确领取/链接的旧资源，尚未认领的原流水与正常支付方式编辑不受此限制。
- 真实 SQLite 本地 migration 链加入 0029，Commit `fefdefe51f8d9c225e8fd74917e8a01c5a5ee21d`；新 `tests/homeflow-sso-isolated.test.mjs` 使用已独立 owner-proof 领回和 link 的真实旧消费、PayPay Visa→nanaco 转账做更新/删除/恢复：允许修改金额/备注；阻止 source/target/type/任一 stable ID 切换；已认领卡名不能变更或删除；恢复同 ID 但错误账户关联被 trigger 拒绝，合法同 ID/同身份可恢复，原 immutable audit 持续只有 1 条。测试 Commit `c28789fadbbf90dda6167a140868c2eb5052f08f`。
- 原旧 API 前置 409 拒绝，`functions/api/[[path]].js` Commit `e4a4e5a0e0ad2b7a7d3e180e8e06c954bf3e0fb2`：新 `isClaimedLegacySource` 禁止已认领的老 source 走直接卡名称变更/删除，中文错误码 `legacy_source_identity_locked`；`PUT /entries/:id` 对存在旧账号审计的行，仅在欲更改 type 或已认领来源/目标时拒绝，返回 `409 legacy_entry_identity_locked`，而不是由数据库抛 500。数据库强触发器仍保护其他自动写入、并发写者及恢复路径。真实旧设备 Cookie API 回归测试 Commit `d22cb5475b4983ff3f0ca2e68a70f20da8e9e1b6`：已认领 PayPay Visa rename/remove 返回 409，旧消费改用 nanaco 返回 409，支付源和 family_account_id 仍原值。
- **中间 CI 故障和修复**：旧 `scripts/d1-sqlite-integration.test.js` 等基础财务 SQLite 用例不安装新家庭身份表，首次集成执行时新的防串号预检 SQL 直接 SELECT 未安装表，导致旧场景返回 HTTP 500；旧存量接口在 B～E 分阶段迁移前必须保持兼容。精确 HEAD `e4a4e5a0e0ad2b7a7d3e180e8e06c954bf3e0fb2` [Validate #43550825103](https://github.com/PTamako/kakebo_jp/actions/runs/43550825103) `completed/failure`，已定位此原因而非删除旧测试。修复为查询 SQLite `sqlite_master` 确认原 `family_financial_accounts`、`family_finance_legacy_entry_links`、`family_finance_legacy_transfer_links` 是否存在后再读取对应审计；旧尚未迁移数据库保持原业务，已装表的已关联身份依然阻止漂移；保留 DB triggers 二次保护。修复 Commit `50c1020bf50e08ce2a0c1ea112d5346d60297c46`。
- **精确新代码 HEAD `d22cb5475b4983ff3f0ca2e68a70f20da8e9e1b6` 的 [Validate #43551014112](https://github.com/PTamako/kakebo_jp/actions/runs/43551014112) 已真实核查为 `completed/success`**，包含旧全部接口回归、新账务 SQLite trigger 与实机 WebKit 之外的项目构建；[Mobile WebKit Smoke #43551014079](https://github.com/PTamako/kakebo_jp/actions/runs/43551014079) 同 HEAD 首次检查 `in_progress`，必须待最终 completed 才可标 WebKit 绿灯。PR 仍 open/Draft；0029 只在 GitHub 和 CI 隔离 SQLite，**未在 Cloudflare 正式 D1 运行；0027/0028 仍未真正迁移，所有 flags OFF**。
- **限制与下一步**：这解决的是“已核验旧身份不能被无意更改”，不是提供需要替换支付账户时的双确认重新归属流程；更复杂的账户合并/重命名须另设计审计/明确二人审批，不能静默改原历史键。实体卡账单、储值卡/SBI/积分稳定 ID 贯通、非现金执行器、文书助手审批→真实受信执行、双人 iPhone PWA 实机仍未完成。所有四应用功能 PR 仍 Draft，未 merge/生产部署、未新建 Preview、未修改 Cloudflare Workers/Pages/D1/R2/Secrets/flags。A 在用户 Mac 的四生产 D1 + 三 R2 加密备份/隔离恢复 PASS 不能当作 F 生产上线许可。


## 53. 2026-11-14 §52 家計簿 #309 旧关联身份不可漂移保护：精确最新代码 CI 双绿、保持 Draft

- 再次核查原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) **精确最终代码 HEAD `d22cb5475b4983ff3f0ca2e68a70f20da8e9e1b6`**： [Validate #43551014112](https://github.com/PTamako/kakebo_jp/actions/runs/43551014112) **completed/success**，且同 SHA 的 [Mobile WebKit Smoke #43551014079](https://github.com/PTamako/kakebo_jp/actions/runs/43551014079) **completed/success**。不是用先前 `e4a4e5a` 的失败跑次冒充通过；原旧接口兼容性问题已在 `50c1020...` 修复，全部旧测试保留。
- 当前仅完成已显式 owner-proof 且有 journal 的**历史收支/转账“来源身份不漂移”**：数据库强制触发器 + 旧 API 409 提前阻断 + 回收站错误同 ID 恢复保护，仍可更新非身份金额/备注等字段。绝对不代表在生产 D1 运行过 0029 或已完成真实老账迁移，亦不代表非现金审批执行器可用。原四应用功能 PR 全部 open/Draft，生产 Cloudflare D1/R2/Workers/Pages/Secrets/flags 完全未变，没有新 Preview 或自动部署。A 用户 Mac 加密备份及隔离恢复 PASS 不等于 F 上线授权。


## 54. 2026-11-14 执行效率调整：设计书 v1.1 缺口核对与跨应用接口契约冻结

- **真实基准**：通过已连接 Google Docs 读取正式设计书 [四应用统一账号与家庭审批系统 v1.1](https://docs.google.com/document/d/1IJ6LIxWDtJ-bPEWp-ynLGXx485GPwpk6rc4_Ry0vHWY/edit) 全部 115 个段落（含 R1–R9、§3.1 首装、§4/4.1/4.2/4.3、§5–7、T01–T14、A–F）；核实当前唯一交接文件此前到 §53。HomeFlow #305 HEAD `b8b877388639b1a2b3ac19dbca58ea8072b8a037`、#306 HEAD `337c773c486f27d6a93c2d8081f0802b4908a4c1`、家計簿 #309 初始 `d22cb5475b4983ff3f0ca2e68a70f20da8e9e1b6`、知学 #179 `ed0b6da560c6647eb1adfbe92db5bef0bef55c8a`、文书助手 #97 初始 `5ecf30cb63225441d8b1c474632674c383d15356` 均为原 open/Draft。此前已通过的 A 阶段四 D1/三 R2 加密备份、Mac 本地恢复、§45–§53 原收支/转账 stable ID 及防漂移不重复开发；不以交接章节计完成比例。
- **真实剩余功能/顺序（逐条对应 v1.1）**：B §3/§3.1：统一身份与昵称/角色变更传播、iOS PWA 首装/登出/切号真机 T01–T02 未完整验收；C §4.1/§6：个人信用卡/储值/余额/积分、SBI 持仓与定投、固定费周期计划完整稳定 owner ID、actor 审计与 T03–T05/T09，旧账户 mapping 只是部分；D §5：member 现金 create 有受限真实签名执行骨架，**非现金、原财务明细 update/delete/restore、周期 Cron 授权/高风险规则、通知及 target receipt 恢复 T06–T08 仍未打通**；E §4.2：文书私人 OAuth/共享全操作权限与附件，finance/homeflow/study 三种文书同步均须 HomeFlow owner approved 后目标真实写入并回报 applied，不能拿旧单用户 bridge 或申请 status 代替；E §4.3：知学所有个人表/SQL/句子卡/收藏/IndexedDB 离线缓存及旧主人的历史 owner-proof 全量迁移、同词双人独立 T12；R9/§6.1：所有写操作真实 actor 与持久审计、不可伪造历史、GET 不产生无谓 D1 审计 T13–T14；F §10：生产迁移、D1/R2 只读计数摘要与版本、真机双人 E2E、Cloudflare 费用/回滚与旧授权受控撤下仍未完成。以上均不可删减。
- **冻结合同已经实际写入** [`docs/four-app-cross-app-contract-v1.md`](https://github.com/PTamako/homeflow/blob/main/docs/four-app-cross-app-contract-v1.md)，docs-only 主分支 Commit `f99d6199b6bfbbd4ca62faa26af5a40bed3ba37f`，[HomeFlow Validate #43551856312](https://github.com/PTamako/homeflow/actions/runs/43551856312) **completed/success**。这是实现可依赖的统一协议基准，固定 HomeFlow 身份、真实已有的现金申请 HMAC 签名及受限执行器、文书申请/status 签名、approval != applied、不确定超时按同一 request ID 对账、owner/actor/resource_owner 区分、后续 `document.sync.finance/homeflow/study` 与 `finance.entry.update/delete/restore/transfer` 目标受信执行器验收要求。明确标记 **未实现的目标接口和非现金执行器为设计契约，不假称可用/已部署**。
- **CI/Commit 约束变更已实际落地**：各仓库独立 Draft 功能模块集中改源代码、UI、真实 D1/R2/双身份测试、专项测试先于原整仓测试的 workflow；使用 Git data `create_tree/create_commit/update_ref(expected_sha)` 将一批文件原子落在 **一个功能 Commit**，从而每模块一次真正完整 CI + 现有 WebKit，不再为每个文件/小节多次提交触发 cancel-in-progress。只有失败才修复重跑，不能隐藏失败或删必要测试。未来允许按仓库隔离并行开发，但跨仓库 wire schema/签名改变必须先对本合同与 T01–T14 回归，不在相互依赖的 PR 上并行改同一路由。
- **始终禁止**合并功能 Draft、正式 D1 迁移/启用 flags/Worker/Pages/R2 变更、重建 Preview、复制凭证、把跨应用直接连接到对方生产 D1。A 加密备份 PASS 不代表 F 上线授权。

## 55. 2026-11-14 家計簿 #309：家庭资产三类真实 owner 证明与双人可见性（完整模块、单 Commit、双绿）

- 原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，同一 `feature/homeflow-sso-isolated-foundation-20261113` 分支，**唯一功能 Commit `ea731ff95eebd4ae47958cf2e263f61241f144d5`**，一批 7 文件（后端归属证明+家庭资产汇总+移动端 UI+两组测试+CI），没有拆成 7 个 Commit/反复取消 Actions：
  - 新 `functions/api/family-finance/asset-owner-projection.js` 基于当前 household 的不可变 `family_financial_accounts(origin=legacy)` 及 `family_financial_resource_owners`，以 payment_sources 真实 legacy 名、SBI `fund_code:account_type`、card_bill `payment_source:month` 索引限界 read-only SQL 查**各项原属主人**；储值卡需确切已领回 legacy prepaid、SBI 持仓需独立 investment_holding 收据、信用卡账单必须原卡账户与 card_bill 收据双方 owner 匹配。无法证明、字段缺少、同名 member_created 账户一律 `identity_status:'unverified'`、`owner_user_id:null`、`account_id:null`，不得猜测归给当前用户。验证记录可显示为 `verified_legacy` 并返回稳定账户 ID/owner。原财务数值/预付余额算法/证券估值/卡账单财务语义未变，GET 不写审计。
  - `functions/api/family-finance/assets.js` 为夫妻双方共同可见的 `GET /api/family-finance/shared/asset-summary` 增三个分类的真实 owner/status + `ownership_verification` 汇总；新 `src/FamilyFinanceAssetOwnership.vue` 按需读取不轮询、区分“本人/家庭成员/归属待核验”，切换 HomeFlow 用户或家庭后通过 epoch 丢弃旧响应，不引入浏览器财务缓存；在既有 `src/FamilyFinanceAccess.vue` 以 `key=user_id` 为双方挂载。没有新增家庭统计“我的/他的/全部”强制切换，家庭总额仍共同可见，不误称完整家庭净资产。
  - 原 `tests/homeflow-sso-isolated.test.mjs` 真实 Node SQLite 双人 SSO：明确旧 owner 领回前 3 类 owner 均 unverified；领回 legacy card 后卡/储值卡映射证据区分；只有独立 `investment_holding`、`card_bill` 认领后才 verified；成员另建同名 nanaco 不会继承旧历史；夫妻读同一汇总且旧 entries/holdings/card_bills 与汇总金额完全不变；重复 GET 不产生 D1 审计。原 `tests/family-finance-ui.test.mjs` 新私有 epoch、读写/来源匹配、无同步旧私人缓存防退化。修改 `.github/workflows/validate.yml` 在完整 release 验证前先专项两文件测试。
- **精确代码 HEAD `ea731ff95eebd4ae47958cf2e263f61241f144d5`** [Validate #43552363209](https://github.com/PTamako/kakebo_jp/actions/runs/43552363209) **completed/success**，其 job 确认先 `Focused family finance identity and asset provenance regressions` success、后 `Verify tests, production build...` success；同 HEAD [Mobile WebKit #43552363219](https://github.com/PTamako/kakebo_jp/actions/runs/43552363219) **completed/success**。#309 仍 open/Draft，线上旧账没有重新归属/复制、D1 没有迁移、feature flag 未启用。
- **边界**：这是 T04 的可验证“家庭资产归属汇总”功能，不是所有证券、固定费、卡账单完整个人可编辑 CRUD、也不代表信用卡/储值/SBI 的审批真实记账已经打通，T05/T07/T09 及旧资源完整 stable ID 仍待后续单独模块。

## 56. 2026-11-14 文书助手 #97：共享家庭成员可真实上传附件，保留原 owner R2 与操作者审计（完整模块、单 Commit、CI 绿）

- 原 [文书助手 Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)，同一 `feature/homeflow-identity-link-safety-20261113`，**唯一功能 Commit `d2607eeaeee5b11a7dde3a30a9110b5b9113bb44`**，一批 3 文件（`worker/upload.js`、真实端到端 `tests/worker.test.js`、专项先跑 `.github/workflows/ci.yml`），无需逐文件触发多次 Pre-merge。
- 核对现状：`worker/index.js` 已支持经原 owner 明确 shared 后双方修改元数据、字段、已有附件回收/恢复/排序、成员永久删除单页附件；但 `attachPage` 原先仅接受文书原 owner，违反 v1.1 §4.2/T10 的“家庭共享双方管理附件”。现在只对 `active` 且同 household `visibility='shared'` 的 collaborator 开放**新附件上传**，保留原 owner 仍能上传私人附件。R2 `storage_objects.owner_id`/真实 object_key 仍保留文书原所有者；实际操作人 `audit_events.actor_user_id` 是上传的 member，身份和资源归属严格区分。跨共享文书 SHA 复用限定 `quality_profile='web-shared-doc:'+documentId`，绝不因同 hash 查询或引用原 owner 其他私人文书对象；同一文书重复传相同 bytes 可安全返回同一附件。写入使用 `documents.version` + 原 owner/仍 shared 权限 + active + 限 30 页的条件原子 CAS，`attachments` INSERT 与真实操作者 append-only audit 仅在 CAS 成功后同 D1 batch commit；撤销共享或改动版本发生在 R2 PUT 期间时，无非授权附件/虚假审计，已上传孤儿 R2 仍记录在原 owner 可补偿清理路径，不向 member 私有对象库暴露。
- 真实 Node SQLite + in-memory R2 两人 tests：未共享时 member 404；共享后另一成员可上传，确认 R2 归 original owner、跨私人文书 same SHA 不复用、同文书重复幂等、上传者审计、共享撤销后 404；在 R2 PUT 过程中动态撤权仍 409 `SHARE_OR_VERSION_CHANGED`、无新附件/审计且待补偿对象有原 owner 路径。无新 Preview、无直接跨应用执行，旧文书 OCR/翻译、OAuth 数据不重写。
- **精确代码 HEAD `d2607eeaeee5b11a7dde3a30a9110b5b9113bb44`** [Pre-merge CI #43552958042](https://github.com/PTamako/jp-document-assistant/actions/runs/43552958042) **completed/success**，实际 job 次序为 `Source syntax` success → `Focused shared collaborator upload identity and R2 replay checks` success → `Unit and in-memory D1 tests` success → `Build Vue UI (no deploy)` success；原 #97 仍 open/Draft，不对生产 R2/D1 创建或改动任何对象。
- **边界/后续**：这解决 T10 一项真正缺失的“共享文书新增附件”权限与审计；不等于跨应用 `document.sync.finance/homeflow/study` 已有受信 execute/journal，也不等于共享整份文书永久删除与原 owner 共享 R2 补偿所有特殊竞态完全验收。文书的成员私人 Google OAuth/Drive、批量操作、SSO 两人实机仍需 T10/T11 独立完整验收。

### 下一批优先模块，不因本轮提交数量调整真实开发完成率

- **D 非现金执行**：先在家計簿实现 update/delete/restore 的加密待执行操作、expected_version 与可信 owner 审批签名、journal/回收站/R2 一致性；信用卡/储值卡余额、SBI 有各自会计语义，不可直接把现有 cash executor 扩大或当成已生效；HomeFlow 状态机可按冻结合同扩展 Service Binding，错号/签名重放/timeout 实际 receipt 必测。
- **C 金融持久 owner ID**：旧 credit bill/投资持仓/固定费计划和周期扣款 grandfathered/approved 稳定 ID/个人可编辑 CRUD，保留自动扣款日期和真正 actor 审计、全家统计不缩水。
- **E 文书目标实际写入**：doc 源快照版本/hash/最少字段→HomeFlow 审核→kakeibo / HomeFlow task / Study 本人的受信 execute + 目标 journal → 真实 applied 回执、通知与丢包重试；旧桥接与当前只读 status 不能冒充已执行。
- **E 知学彻底隔离**：句子卡/收藏等 HomeFlow user-scope CRUD、旧 owner 确认映射、旧习题/离线 IndexDB/localStorage 各路径隔离、两个账号同词及文书同期不同句子卡、清理撤权后的陈旧网络回执。B/F 最终统一 iPhone PWA 首装、Safari 回跳/撤权、两个人切号、四端数据回归仍需真实设备/上线前的受控验证。
- **部署禁令持续有效**：A 阶段生产备份/离线恢复 PASS，但 F 部署/正式数据库迁移尚无授权；四应用五个功能 PR 均继续 Draft，不合并、不操作 Cloudflare 生产、不创建 Preview、不把文档章节数当成功能完成度。


## 57. 2026-11-14 知学 #179 Stage E 本人句子卡：7 文件一批交付、真实双人 SSO/SQLite 全绿

- **原仓库/PR**：继续原 [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179)、`feature/homeflow-identity-isolated-20261113`，没有合并到 main 或创建 Preview。设计书 v1.1 §4.3 所需的“每人可独立保存日/英语句子卡、同一句可各自不同注释/掌握记录”此前仅有旧单密码句子卡与一些个人词汇/语言掌握进度保护；这次实际实现新的个人句子卡 CRUD **不是重复做已完成的词汇/模拟考队列/每日任务防串号**。
- **集中实现单 Commit `30325d704900be5c533f5201b2500668527ba43f`**，共 7 文件一批：
  - 仅在 Draft 的新增 `migrations/0190_homeflow_personal_sentence_cards.sql`，独立 `homeflow_personal_sentence_cards` 以联合 PK `(homeflow_user_id,card_id)`、角色原 owner 与新 member 均只能读写本人的 UUID、严格长度/语言/来源 `source_kind='manual'`、乐观 `version`、软删除状态、真实 `updated_by_user_id`；插入更新时的活动身份 D1 trigger、防跨 user 移动、禁止物理删除，另有不可变句子操作审计表 `homeflow_personal_sentence_events`（saved/edited/removed）。
  - 新 `worker/homeflow-sentences.ts`，固定 `GET /api/homeflow-study/sentences/status`（只读 flag）、`GET /api/homeflow-study/sentences`（当前用户、20 条以内稳定 card_id cursor）和 `POST /api/homeflow-study/sentences`（当前用户显式 `expected_user_id`、同源 Origin+JSON、固定字段白名单、一次最多一张卡、`expected_version` 乐观条件 + D1 原子写/唯一 audit）；重试同卡同字段/已软删除返回 `replayed:true` 不产生第二条审计，旧版本修改和跨账号/伪造 actor 拒绝。专门要求 `HOMEFLOW_STUDY_SSO_ENABLED`、`HOMEFLOW_STUDY_SENTENCES_ENABLED=true`、实时 HomeFlow verifiedStudyActor，默认 OFF；不赋予旧学习 Cookie 写权限，`source_kind` 固定 **manual**：后续文书同步必须单独签名+家庭审批/目标 idempotent journal，不能让浏览器冒充文书授权执行。
  - `worker/index.ts` 仅在新目标路由被访问时加载句子处理器，避免无关旧 API 或 Node 遗留测试沙箱提前解析新模块；`src/StudyHomeFlowSentences.vue` 支持当前本人日/英句子手动新增、编辑、确认移除、分页、切号和返回前台时丢弃旧回执；网络结果不明确时保留原 card ID/原意图用于安全重试、不创建新笔，个人数据不写 localStorage/IndexedDB；`src/StudyHomeFlowAccess.vue` 以 `key='sentences:'+identity.user_id` 切换组件，不能把前账号卡片挂在新人界面。
  - `scripts/homeflow-sso-isolated.test.mjs` 在真实 SSO 夫妻 Cookie 和 SQLite 0190 隔离迁移中验证：原 owner 绑定后新 member 首次空；相同 `card_id` 与同语言句子分别按原身份独立保存，伪造 `expected_user_id`、伪 `actor_user_id`、错误 Origin 被拒；正常保存、幂等重试、版本编辑、过期版本 409、软删重试均只写真实自己的数据和恰当 actor 审计；审计不可修改、持久记录不能删除、跨 actor SQL 插入 trigger 拒绝、HomeFlow 源撤权后 GET/POST 401、关闭开关 503。全部原旧考试/词汇/语言/离线/CI 测试均保留。
  - `.github/workflows/validate-pr.yml` 把 `node --test --test-name-pattern='Stage E personal sentence cards' ...` 专项 SSO/SQLite 测试排在快速身份/类型检查前，并令重型完整 `validate` job `needs:fast-identity-checks`，防止专项红灯时仍浪费费用与时间生成整套公开题库与执行完整 D1 迁移链。只有模块聚合稳定后才提交代码。
- **真实 CI 首次问题与集中修复**：精确初次 HEAD `30325d704900be5c533f5201b2500668527ba43f` 的 [Validate #43553771658](https://github.com/PTamako/it-study-platform/actions/runs/43553771658) **completed/failure**；fast identity+type checks 全绿，完整 reg 450 项 434 pass / 16 fail，因若干旧测试脚本通过 `data:` URL 或临时 worker.mts 模拟独立 Worker `index.ts`，静态加载新 `./homeflow-sentences` 时无法在旧沙箱解析，**不是身份泄漏或 D1 条件写入失败**。没有删任何旧测试，唯一必要修复 Commit `abc7c08048eb07a7da4af6acb027c1b2fcd8f6a3` 把 index 的句子 Handler 改为仅匹配该新路由时按需 `await import('./homeflow-sentences')`，旧无关 worker API 不会尝试加载新私有模块；专项本人读写和 TypeScript/Worker bundle 继续自动验证。
- **精确最终 HEAD `abc7c08048eb07a7da4af6acb027c1b2fcd8f6a3`** 的 [Validate #43553952473](https://github.com/PTamako/it-study-platform/actions/runs/43553952473) 已 **completed/success**：`Fast identity and type checks` 完整成功，然后才运行重型 `validate`；整套旧 Node 测试/新双成员本地 D1、前端类型构建、全量 SQL 本地迁移链及 worker dry-run 通过。**没有在生产 D1 执行 0190**，未启用 `HOMEFLOW_STUDY_SENTENCES_ENABLED`，没有合并功能 Draft、改任何正式 Cloudflare 资源或重建 Preview。
- **仍未实现（不得假称完成）**：旧公共/单人句子收藏与讲解缓存的原 owner 有证据迁移、所有 IndexedDB/localStorage 和异步请求完整命名空间隔离、文书助手经 HomeFlow 审批后 `document.sync.study` 的独立可信目标执行器与回执 journal、本人日/英语语句与课程复习任务双向挂接，以及真机两人 iPhone PWA 断网/切号/撤权 T12。完整阶段 E 仍属 partial，A Mac 生产 D1/R2 备份恢复 PASS 仍不批准 F 部署。


## 58. 2026-11-14 批量交付第 1 模块：家計簿 #309 历史固定费/SBI 计划真实 owner 证明 + 手机端只读查看

- **依据设计书**：R2/R3/R8/R9、§4.1/§6/T04–T05/T09，复用已冻结的 `docs/four-app-cross-app-contract-v1.md`。此前 §55 只完成家庭资产三类 owner 投影、§57 知学本人句子卡，**本次不是重复开发**。业务目标是已存在 `family_financial_resource_owners` 的历史固定费、SBI 定投与历史版本，在真实夫妻 HomeFlow 身份下可查证原 owner；这一步仍不包含修改旧计划或自动扣账。
- 在家計簿原 [Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)，原分支 `feature/homeflow-sso-isolated-foundation-20261113` **单一整模块 Commit [`f7ebf7b3c4c3c89235cb11e9cc3bf5d9908da77e`](https://github.com/PTamako/kakebo_jp/commit/f7ebf7b3c4c3c89235cb11e9cc3bf5d9908da77e)**，5 个文件一次 Git tree 原子提交：
  1. 新 `functions/api/family-finance/plan-ownership.js`：先经原 HomeFlow 身份服务验证，再通过 keyset 分页（1–30 行）只读旧 `recurring_plans`、`investment_plans`、`investment_plan_history`；仅配合同家庭不可变资源归属映射与原 owner 链接才显示 `verified_legacy`，没有证明返回 `unverified / owner_user_id:null`，不能根据同名、登录者或昵称猜测归属。禁止借这一接口编辑财务资源或写 GET 审计。
  2. 原财务路由新增 `GET /api/family-finance/shared/plan-ownership`，仍由 SSO + 原功能旗标控制；新增 `src/FamilyFinancePlanOwnership.vue` 本人/家庭成员/待核验标记、限量分页、前台重新验证、切号后丢弃旧回执；在原 `FamilyFinanceAccess.vue` 以 `user_id` 分区挂载，**两人均可看相同历史计划但没有借此获得修改配偶权限**。
  3. 在现有 `tests/homeflow-sso-isolated.test.mjs` 中用真实 SQLite 和双 HomeFlow SSO Cookie 回归：旧主权利未认领时 unknown、经 owner 原证据映射后两人同一结果、非法查询拒绝、跨页 44 条无重复、撤权 401、正式账本和原 SBI 历史不变、没有创建假入账事件。
- **精确代码 HEAD `f7ebf7b3c4c3c89235cb11e9cc3bf5d9908da77e` CI 双绿**：[Validate #43555179660](https://github.com/PTamako/kakebo_jp/actions/runs/43555179660) **completed/success**（先专项双人身份/SQLite 与 UI 回归，再全量 release tests/build）；[Mobile WebKit Smoke #43555179691](https://github.com/PTamako/kakebo_jp/actions/runs/43555179691) **completed/success**。没有人为删除旧测试，没有每文件重复提交取消 Actions。
- **没有完成/不可上线代替**：这是历史固定费/SBI 资源的归属可视性，不是稳定 ID 全链编辑 CRUD；投资/信用卡/储值卡/积分完整 owner 和会计动作、非现金审批执行、跨应用文书真实目标写入、完整知学隔离、T01–T14 实机/正式 F 仍缺。四应用正式 D1 迁移、flags、Workers/Pages/R2/Secrets **均未操作**；Draft PR 仍 Draft、没有创建 Preview、没有合并功能 PR。A 的四 D1/三 R2 加密备份+Mac 隔离恢复 PASS，绝不能视为 F 部署许可。


## 59. 2026-11-14 批量交付第 2 模块：知学 #179 本人收藏 UI 与跨账号原始操作人安全栅栏

- **真实缺口**：知学原 Stage E 已有 `worker/homeflow-vocabulary.ts` + `0181_homeflow_user_vocabulary.sql` 的 per-user 后端，但是 HomeFlow 首次进入的 PWA 尚无本人收藏/删除/历史导入 UI；本人收藏 POST/原 owner 导入 POST 没有绑定**发起操作时的 HomeFlow user_id**，设备换号后可能把已确认前一身份的写入发到新 Cookie。此处必须补齐，同时保留已有生词隔离、旧库历史、复合键、审计和 feature gate。
- 在知学原 [Draft #179](https://github.com/PTamako/it-study-platform/pull/179)，原分支 `feature/homeflow-identity-isolated-20261113`，**单模块原子 Commit [`d1a97ae803bf440b4dcd6b3bd3166715dc65f857`](https://github.com/PTamako/it-study-platform/commit/d1a97ae803bf440b4dcd6b3bd3166715dc65f857)**，6 文件：
  1. `worker/homeflow-vocabulary.ts` 的个人 save/remove 与 owner-only `legacy/adopt` 强制包含 `expected_user_id`，再由原服务端 `verifiedStudyActor` 实时重查 SSO 身份，不匹配在任何 SQLite 写入/原数据读取前 `403 ACTOR_CHANGED`。客户端身份只能作为比对栅栏，不能冒充权限来源。
  2. 新 `src/StudyHomeFlowVocabulary.vue`：独立 HomeFlow user_id PWA 个人生词列表、分页、收藏、移除与 owner 经明确确认后原历史每批 20 行只复制到本人；无法核对回执时保留**原始请求**供同一账号重试，换号/unmount/前台恢复丢弃旧回执，不读写旧 `localStorage` 或 `IndexedDB`。原 `StudyHomeFlowAccess.vue` 仅认证后按当前 user_id 独立挂载。
  3. `scripts/homeflow-sso-isolated.test.mjs` 原有双账号、损坏历史导入等测试全部保留并按新契约附加原操作人；新增真实 SQLite/双 Cookie 的跨账号 stale POST、缺失原 actor 403、相同单词两账号独立、同请求重试不重复审计、撤权 401、原 owner 旧库不变回归。`scripts/homeflow-pwa-ui.test.mjs` 检查 PWA 不碰旧缓存；`.github/workflows/validate-pr.yml` 在完整 CI 前**批量运行个人句子卡 + 个人词本相关真实 SQLite 专项**，然后保留完整旧校验。
- **CI 状态与精确 run**：[`Validate pull request #43555788635`](https://github.com/PTamako/it-study-platform/actions/runs/43555788635) 绑定 HEAD `d1a97ae803bf440b4dcd6b3bd3166715dc65f857`；已核实 **Fast identity and type checks completed/success**（专项真实 D1、原 PWA 与缓存回归、Vue typecheck），**完整 validate job 已 completed/success**，同一精确 HEAD `d1a97ae803bf440b4dcd6b3bd3166715dc65f857` 的完整旧 Node/SQLite 回归、静态生成/数据许可验证、数据库迁移链以及最终 Worker/前端构建全部经真实 Actions 验证通过，不因 CI 自动通过而授权生产。
- **剩余且未完成**：完整全应用旧 `src/App.vue` 本机数据/队列逐身份隔离、旧句子/收藏归属证明与全量 owner 历史迁移、文书 `document.sync.study` 经 HomeFlow 审批后的真实 Service Binding 目标执行、书本其余个人学习链路、两部 iPhone 实机与完整 T01–T14。家計簿非现金审批执行、金融稳定 ID 全类型 CRUD、文书同步真实 finance/task/study 执行器均没有因此完成。
- 本轮 **只改 Draft 源码/测试**；`HOMEFLOW_STUDY_VOCAB_ENABLED` 默认 OFF，未执行任何生产迁移，没有改 HomeFlow 生产库/正式 Worker、没有合并功能 PR、没有 Preview。A 备份 PASS 与最终 F 部署许可严格分离。


## 60. 2026-11-14 批量交付第 3 模块：家計簿 #309 五类历史金融资源 owner 实际人工认领入口

- **真实缺口**：原 §56 已有数据库 `0025_family_financial_resource_owners.sql` 与仅管理员 `POST /api/family-finance/legacy/resource-owners`，§58 已实现五类原资源中固定费/定投计划及资产 owner 可视性；但 PWA 没有原 owner 逐项确认/运行映射的入口，导致真实使用时资源仍可能全部显示 `unverified`。此批连接现有**安全数据库迁移路径与用户操作**，不额外复制一套原账/资产规则。
- 原 [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) 新增 `src/FamilyFinanceOwnerAdoption.vue`，在 `FamilyFinanceAccess.vue` **仅经验证 HomeFlow 管理员**可见；五个原资源类型为 `recurring_plan`、`investment_plan`、`investment_plan_history`、`investment_holding`、`card_bill`。原管理员每次 `window.confirm` 明确确认，携带 `expected_user_id` 和真实 household 身份下后端自主枚举的 keyset `cursor`，后端每批最多 50 条事务登记不可变证据，不接受客户端自选原 owner/SQL/金融金额。
- 前端 `GET` 只看同家庭 owner 映射汇总；`POST` 严格检验 `resource_kind/owner_user_id/ledger_changed=false/mapped/has_more/next_cursor`，网络丢包不猜测结果，保留冻结原请求供幂等重试；账号失效、前台恢复、unmount 后清空旧数据显示。原 `tests/family-finance-ui.test.mjs` 增加管理员只可见、完整五类、原本人 actor、明确确认、无本机财务缓存、无旧 `entries` 修改的 UI/源代码守卫。原 `tests/homeflow-sso-isolated.test.mjs` 的真实双成员 SQLite 50 条分页、重复写入不会重复事件、原主 ID 不可变、原源表逐行不变等测试完整保留。
- **代码 Commit**：[首个整功能批 `55fa7efd81155e9b7ae2a6f1484984a3d5f2b371`](https://github.com/PTamako/kakebo_jp/commit/55fa7efd81155e9b7ae2a6f1484984a3d5f2b371)（3 文件）→ 修正新 select 在 `v-model` 与 `@change` 事件先后顺序可能导致复用旧 cursor 的故障，后续精确 HEAD [`87cdc6f9de785f7149b4a250b23b854ee51d6671`](https://github.com/PTamako/kakebo_jp/commit/87cdc6f9de785f7149b4a250b23b854ee51d6671)（2 文件）。**只以后一 HEAD 验收**，上一中途 Actions 取消或通过均不等于新 HEAD 通过。
- **准确 CI 截至本节**：最终 HEAD `87cdc6f9de785f7149b4a250b23b854ee51d6671` 的 [Validate #43556260761](https://github.com/PTamako/kakebo_jp/actions/runs/43556260761) 已 **completed/success**（现有原双 SSO/SQLite/UI 专项优先，完整 `verify:release` 次之）；[Mobile WebKit Smoke #43556260789](https://github.com/PTamako/kakebo_jp/actions/runs/43556260789) 已 **completed/success**；最终 HEAD `87cdc6f9de785f7149b4a250b23b854ee51d6671` 的 Validate + Mobile WebKit 两项均已真正 completed/success。
- **剩余边界**：原资源 owner 可视/人工侧车认领完成，不代表旧固定费/SBI 计划已可独立人别 CRUD、信用卡/储值卡/积分及投资完整财务账务可独立修改或自动执行，也不是家庭成员非现金审批执行器已实现。家計簿家庭账本真实入账仍需严格正反记账/余额一致性和专门目标回执。文书助手三目标的真实审批后执行、完整知学离线隔离、T01–T14 双 iPhone 均是未完成；设计书任何功能不删减。
- **部署禁令**：五个 PR 均 Draft，原正式 D1/R2/Worker/Pages 未变、无 Preview，原 A 备份恢复 PASS 不代表 F 授权。交接只记录真实 commit、完整专项和 CI，不使用章节数或 Commit 数计算完成率。


## 61. 2026-11-14 文书同步 P0 前置：审批快照加密（真实目标执行仍未完成）

- 文书助手 [Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97) 分支 `feature/homeflow-identity-link-safety-20261113`，代码 commit [`d973a2aec557034fd718a4a08faa603e8061e9e3`](https://github.com/PTamako/jp-document-assistant/commit/d973a2aec557034fd718a4a08faa603e8061e9e3)。在尚未执行生产的 0023 Draft 迁移中把待执行快照改为 AES-GCM 密文与随机 96-bit IV；AAD 绑定候选、文书、两套用户/家庭身份、目标、版本和摘要。独立 256-bit `DOCUMENT_INTENT_ENCRYPTION_KEY` 缺失时申请入口和预览 fail closed；不在仓库保存密钥，不改任何生产 Secret。
- 重试先解密并比对原内容、digest 和身份，丢包后继续使用原申请；更改密文、密钥或身份导致解密失败。修改 0023 只适用于该迁移尚未在目标库执行的前提；任何已经试运行旧 0023 的隔离数据库需单独设计迁移，不能假设旧表自动升级。将来部署前须按受控发布流程准备和安全备份独立密钥。
- 本地针对性 SSO/审批测试通过；安装项目依赖后完整 `npm test` 和 `npm run build` 通过，`npm run check:syntax` 通过。首次完整测试因本地缺少 yaml 依赖失败，`npm ci` 后完整重跑通过；不是删减测试。精确 HEAD 的 [Pre-merge CI #43557319867](https://github.com/PTamako/jp-document-assistant/actions/runs/43557319867) 已 **completed/success**，包含全量测试、模型验证及前端构建。
- **未完成**：这仅是源快照保护，不是 `document.sync.finance/homeflow/study` 的目标执行、journal、可靠回执、通知或源撤权竞态闭环；也未完成非现金账务、金融历史完整迁移、知学全部离线隔离或 B–E 验收。下一步应优先实现至少一条完整的可信文书目标执行流程，包括 HomeFlow 执行租约、源快照版本与身份复核、目标同事务写入与幂等 journal、回执丢失同 ID 恢复，再扩展其他目标；不能把 approved 显示为 applied。
- 无生产部署、D1 迁移、数据回填、Preview 或 Secret 修改；PR #97 保持 Draft。A 备份恢复已通过，不代表 F 正式发布已授权。


## 62. 2026-11-14 家庭现金审批：过期后仅查原回执的真实恢复

- 冻结契约补充 §G（[commit 99458d6be2e09e496feec93b3e65f5ccb756f76a](https://github.com/PTamako/homeflow/commit/99458d6be2e09e496feec93b3e65f5ccb756f76a)）：已尝试现金执行但结果不明，且审批随后过期时，HomeFlow 只用原审批 ID、家庭、申请人、资源与摘要查询家計簿 journal；签名域 `homeflow:receipt`，严格 backend-only，查不到不视作未入账的确定证明，也不再次执行。
- [家計簿 Draft #309](https://github.com/PTamako/kakebo_jp/pull/309) [`4c2542b921d3ff94838eac811d29e0b7f2111aab`](https://github.com/PTamako/kakebo_jp/commit/4c2542b921d3ff94838eac811d29e0b7f2111aab)：新增签名隔离的 `POST /api/internal/approved-actions/receipt`，只查不可变 `family_finance_applied_actions`，严格字段及原身份/摘要匹配；不存在或冲突不能修改账本。真实 SQLite 测试覆盖未入账只查、签名域混淆拒绝、成功原回执、摘要冲突及额外字段拒绝。
- [HomeFlow Draft #306](https://github.com/PTamako/homeflow/pull/306) [`eca357d41faff0a66fc01dde1878094fea9e788c`](https://github.com/PTamako/homeflow/commit/eca357d41faff0a66fc01dde1878094fea9e788c)：已过期且曾尝试的 `failed_retryable` 取得租约后只调用 receipt，匹配目标回执方标记 applied；404、丢包及不确定结果仍为 failed_retryable，原 ID 可再次核对。未曾执行且过期的审批不联系目标；UI 对过期且回执不明明确提示不会重新入账。HomeFlow 本地测试模拟目标已落账丢回执、过期查询、查无结果、再次查询成功和事件唯一；两仓库各自使用真实 SQLite 测试，**跨仓库真实 Service Binding 的端到端集成仍待补测**。
- 本地 HomeFlow 完整 `npm run check`：813 项测试通过及构建通过；其后增加“过期但从未执行不联系目标”断言并单独通过。家計簿 `npm run verify:release`：902 项测试、生产依赖审计和构建通过。精确 HEAD 的 [HomeFlow Validate #43564057408](https://github.com/PTamako/homeflow/actions/runs/43564057408) 和 [家計簿 Validate #43564053368](https://github.com/PTamako/kakebo_jp/actions/runs/43564053368) 均 completed/success；[Mobile WebKit #43564053495](https://github.com/PTamako/kakebo_jp/actions/runs/43564053495) 也已 completed/success。
- 这修复现有现金执行器的同 ID 失败恢复，不代表非现金、新增/修改/删除/恢复全部类型、文书三目标执行、通知或 B–E 已完成；仍按 §61 优先推进文书真实执行链和非现金账务，不能把 approved 当 applied。两端须配套，均默认关闭；未合并、部署、执行生产迁移或修改正式资源，无 Preview。A 备份恢复已通过；F 正式部署仍须用户单独批准。


## 63. 2026-11-14 现金过期回执：两仓库真实代码跨应用联调

- [HomeFlow Draft #306](https://github.com/PTamako/homeflow/pull/306) [`db494ab2d2c93905ba720e8500ad60730149898e`](https://github.com/PTamako/homeflow/commit/db494ab2d2c93905ba720e8500ad60730149898e) 新增 `tests/cross-app-cash-receipt.test.mjs`，在两个互相隔离的内存 SQLite 中加载两仓库真实迁移，以进程内模拟 Service Binding 连接实际 HomeFlow 审批、验证、执行处理器与家計簿 `approvedActionRoute`，不请求生产 URL/数据库。建立受审批现金意图后，真实目标入账并丢弃回执，审批过期后只查询目标原 journal 并恢复 applied；断言一条账目、一条目标 journal 与审计、仅一次 execute 和一次 receipt。
- HomeFlow CI 新增只读 checkout 家計簿固定契约版本 `4c2542b921d3ff94838eac811d29e0b7f2111aab`，设 `KAKEBO_CONTRACT_ROOT` 将跨仓库测试纳入完整检查；今后修改目标协议时需同步审查并更新固定版本。无对应检出时本地可跳过该专项，CI 明确提供检出路径，不以跳过替代验收。本地对两仓库实际代码运行 `KAKEBO_CONTRACT_ROOT=… npm run check`：814 项测试通过、0 skipped，构建通过；精确 HEAD 的 [HomeFlow Validate #43565275359](https://github.com/PTamako/homeflow/actions/runs/43565275359) 已 completed/success，包含固定目标版本检出、跨仓库实际处理器测试、完整构建与迁移校验。
- 这验证的是双真实处理器通过本地模拟 Service Binding/真实 SQLite 的现金回执对账，不是 Cloudflare 正式部署或双 iPhone 实测，也不等于非现金与文书三目标真实执行已完成。文书可信执行链、非现金会计语义和其他 B–E 缺口仍需继续开发。所有功能 PR 保持 Draft，未触碰生产 D1/Worker/Pages/R2/Secret，未建立 Preview。


## 64. 2026-11-14 文书→知学目标事务内核（未接线，不能称跨应用已完成）

- 契约补充 §H [`c533ef75b7a582b0e125beb0e4d9b1130ec78efe`](https://github.com/PTamako/homeflow/commit/c533ef75b7a582b0e125beb0e4d9b1130ec78efe)：确定目标本人句子/词汇、原审批及候选 ID 不可重复使用、私有词条不覆盖和被删除词不擅自恢复；这不是外部 wire 协议，也未开启接口。
- [知学 Draft #179](https://github.com/PTamako/it-study-platform/pull/179) [`01cc3097532d842964eb31db1f57f07c806260fa`](https://github.com/PTamako/it-study-platform/commit/01cc3097532d842964eb31db1f57f07c806260fa)：新增**未注册为 HTTP 路由**的 `worker/document-study-apply.ts` 和未执行生产的 `0191_homeflow_document_study_receipts.sql`，提供将已验证的文书快照写入指定 member 本人的句子或词汇、同事务写入不可变回执及必要审计的内部函数；相同 ID 与摘要重放返回原回执，身份/摘要冲突拒绝，现有私人词条不覆盖、软删除词不复活。未执行生产的 0190 允许 document 来源；手动公开 API 仍硬编码 manual。因为修改的是未执行的 0190，若隔离环境曾试跑旧版本，需先处理 schema 版本差异，不可假定 CREATE IF NOT EXISTS 会升级旧约束。
- SQLite 专项覆盖两账号相同句子隔离、同 ID 重试、已存在私人词条保留、被删除词拒绝、身份撤权、私密信息/摘要篡改、回执冲突，以及注入 journal 失败时句子/词汇和审计一起回滚；4 项专项、原句子/词汇专项及前端/新增 Worker 代码类型检查均在本地通过。当前环境为 Node 24，而仓库完整本地工作流要求 Node 22 和生成题库，故没有声称完整本地 CI 通过；[初始代码 CI #43565912284](https://github.com/PTamako/it-study-platform/actions/runs/43565912284) 已 completed/success；后续补充同审批并发重试 SQLite 测试 [`2fc063fc864cb948ee28a2d7fefa92d9e532f486`](https://github.com/PTamako/it-study-platform/commit/2fc063fc864cb948ee28a2d7fefa92d9e532f486)，本地 5 项专项通过。[并发补充 CI #43566164504](https://github.com/PTamako/it-study-platform/actions/runs/43566164504) 已 completed/success；随后修复文书生词中文含义与现有个人生词本 `entry.zh` 字段的兼容 [`1a5420cc41b2573eb733c3d6d835cf2af6827589`](https://github.com/PTamako/it-study-platform/commit/1a5420cc41b2573eb733c3d6d835cf2af6827589)，5 项 SQLite 专项及 Worker 类型检查通过。精确最终 HEAD [Validate #43566377270](https://github.com/PTamako/it-study-platform/actions/runs/43566377270) 已 completed/success，包含新增专项、完整旧测试、构建和 D1 本地迁移链。
- **关键边界：内部函数并不证明批准或源授权，任何调用者都必须先独立验证 HomeFlow nonce、申请人/审批人/家庭、文书快照及版本、源撤权；目前没有可信服务端路由、源版本锁、HomeFlow 执行调度、跨服务联调、状态/通知和丢包对账。** 因此尚不能执行任何文书同步，不能以这批工作或 commit 数提高整体完成率。下一步必须接通这条真实链路及回执，然后才可标记 applied；finance/homeflow 目标与非现金审批亦仍未完成。
- 无生产迁移、资源修改、Preview 或合并；所有 PR 保持 Draft，F 阶段部署仍需另行批准。

## 65. 2026-11-14 文书金融审批与稳定账户 ID：三仓库 Draft 联动、执行 UI、事务回执（开发验证通过，尚未生产）

> 此节专门记录 §64 之后的增量；**不可由 CI 绿推断生产已迁移或上线**。本节检查的四个功能 PR 均为 Draft。以下 Commit 均真实写入对应 PR 分支；交接文件本身通过 main 的**仅文档**更新保存，HomeFlow `deploy.yml` 对 `docs/**` 有 `paths-ignore`，本次不能触发 Cloudflare 正式部署。

### 65.1 已提交的金融账务跨应用实际代码

- **家計簿 [Draft #309](https://github.com/PTamako/kakebo_jp/pull/309)**：
  - [`12405885c7755e8523c0a23e35850cb7683c568b`](https://github.com/PTamako/kakebo_jp/commit/12405885c7755e8523c0a23e35850cb7683c568b)：只读、backend-only 的 HMAC 稳定 `account_id` 验证；按真实 `homeflow_identity_links` 和 `family_financial_accounts` 校验本人、状态、账户种类与版本，拒绝同名误映射、他人账户、撤权及非现金业务。
  - [`9d03e50dacf15b090c6d6514dc004ef7c34dcbe6`](https://github.com/PTamako/kakebo_jp/commit/9d03e50dacf15b090c6d6514dc004ef7c34dcbe6)：独立 `/api/internal/document-finance/{execute,receipt}`；再次签名确认 HomeFlow 执行租约、文书源端版本及账户有效性，再在一个 D1 事务内写入共享 `entries`、不可变 `document_finance_applied_actions`、实际审批人审计；仅 journal 精确命中可复用同审批 ID 的回执，拒绝跨账户/候选/摘要碰撞。新增未执行生产的 `0030_document_finance_execution.sql` 和 SQLite 测试。
  - [`2ec664fb16d5934615459a53a587f35f5bf34ee4`](https://github.com/PTamako/kakebo_jp/commit/2ec664fb16d5934615459a53a587f35f5bf34ee4) 与 [`900fb17c3bbc68f24c18466da321e85c496b4ea7`](https://github.com/PTamako/kakebo_jp/commit/900fb17c3bbc68f24c18466da321e85c496b4ea7)：签名 `list` 仅返回当前 member 自有、未归档的现金账户稳定 ID 与版本；同名账户可独立列出；修复 SQLite 测试夹具 `.all()`。
  - 精确 HEAD `900fb17c` 的 [Validate #43569840284](https://github.com/PTamako/kakebo_jp/actions/runs/43569840284) 与 [Mobile WebKit #43569840303](https://github.com/PTamako/kakebo_jp/actions/runs/43569840303) **completed/success**。
- **文书助手 [Draft #97](https://github.com/PTamako/jp-document-assistant/pull/97)**：
  - [`fa50c0fa788e282256ad074951190742439e2584`](https://github.com/PTamako/jp-document-assistant/commit/fa50c0fa788e282256ad074951190742439e2584)：提交审批前从目标端验证稳定账户，把 `account_id` / `account_version` 写入源端 AES-GCM 不可变审批快照，不能只靠支付方式名称入账。
  - [`d18d0ab2256e46b39c4c262af81b6fc507a407f9`](https://github.com/PTamako/jp-document-assistant/commit/d18d0ab2256e46b39c4c262af81b6fc507a407f9)：未执行生产的 `0024_document_execution_reservation.sql`、签名源端 `execute / receipt / source-check` 路由；在结果不明时保持源端版本/回收锁，保存目标真实回执后才报告 applied。
  - [`0281d51d5acb831ff88286c276857fe8218dc7af`](https://github.com/PTamako/jp-document-assistant/commit/0281d51d5acb831ff88286c276857fe8218dc7af)：PWA 仅从目标已验证的本人现金账户列表按 ID 选择，并显示同名账户的 ID 后缀；拒绝手填名称充当稳定 ID；非现金类型不冒充现金操作。
  - [`f93588fda8ddf50f27e196a4ed329ec6474c8225`](https://github.com/PTamako/jp-document-assistant/commit/f93588fda8ddf50f27e196a4ed329ec6474c8225)、[`55bdd321c8fb367d4602f9007d1eeeff05b1fb38`](https://github.com/PTamako/jp-document-assistant/commit/55bdd321c8fb367d4602f9007d1eeeff05b1fb38)、[`730814a4b564eba5ce3e9902bdbff7b07df10015`](https://github.com/PTamako/jp-document-assistant/commit/730814a4b564eba5ce3e9902bdbff7b07df10015)：审批状态支持 `executing`、`failed_retryable`、`applied`；只有 HomeFlow 已应用且源端 journal 的审批、候选、摘要和目标 entry_id 相符才显示“已生效”；更新 UI 及旧断言。
  - [`cf084adeb42385733c5e446b8ae6abab529cab9d`](https://github.com/PTamako/jp-document-assistant/commit/cf084adeb42385733c5e446b8ae6abab529cab9d)：文书真实执行路由额外要求 `APP_ENV=production`，非正式环境 fail closed。
  - [`05cb0a3c8e4347c22b8517c9515d1003f945c6b7`](https://github.com/PTamako/jp-document-assistant/commit/05cb0a3c8e4347c22b8517c9515d1003f945c6b7)、[`dcfaa5f714c222d69985f1038341f0bde56c6de9`](https://github.com/PTamako/jp-document-assistant/commit/dcfaa5f714c222d69985f1038341f0bde56c6de9)：新增**真实内存 SQLite 文书源** + 签名模拟 HomeFlow / 家計簿 backchannel 贯通测试，覆盖密文快照、租约证明、目标源复核、源端保留锁、不可变回执、实际审批人单次审计、同 ID 重试、撤权与 Preview 拒绝。首次新测试失败因模拟目标重放时仍要求源状态为 executing；按真实家計簿目标 **先查不可变 journal 再决定是否进行 source-check** 的顺序修复测试夹具，未放宽生产业务代码。精确最终 HEAD `dcfaa5f7` 的 [Pre-merge CI #43573564291](https://github.com/PTamako/jp-document-assistant/actions/runs/43573564291) **completed/success**。这还是隔离模拟 Binding，不是 Cloudflare 真实跨服务部署验收。
- **HomeFlow [Draft #306](https://github.com/PTamako/homeflow/pull/306)**：
  - [`480b969045646b521ea2dee8e6098ce7522a25c7`](https://github.com/PTamako/homeflow/commit/480b969045646b521ea2dee8e6098ce7522a25c7) 扩展专用 `document.sync.finance` 执行路由，另设签名域/Binding，不更改旧 `finance.entry.create` 的目标契约；其后 [`2430d256ba7530ff77de279143b70a186d78c104`](https://github.com/PTamako/homeflow/commit/2430d256ba7530ff77de279143b70a186d78c104) 修复旧现金测试回归。
  - [`8efbc07bd4c8524d8d0eb2f33af3dd1a0f862b02`](https://github.com/PTamako/homeflow/commit/8efbc07bd4c8524d8d0eb2f33af3dd1a0f862b02) 与 [`045f1e3bd41e74b1faca425573d3793e6e90f256`](https://github.com/PTamako/homeflow/commit/045f1e3bd41e74b1faca425573d3793e6e90f256) 将可信文书金融状态回读从 `pending/approved` 延伸到 `executing/applied/failed_retryable`，仅有真实正整数 entry_id 等不可变回执标记才返回 applied；不对不相关文书类型显示成功。
  - [`d42887e855f11953a1267a03e2dddf7ca3a94608`](https://github.com/PTamako/homeflow/commit/d42887e855f11953a1267a03e2dddf7ca3a94608) 与 [`d1e9665cb51c9ae99ddbde55269ea874f97bd4d6`](https://github.com/PTamako/homeflow/commit/d1e9665cb51c9ae99ddbde55269ea874f97bd4d6)：管理员审批 UI 只在独立的文书执行开关、签名密钥及 `DOCUMENT_EXECUTION_SERVICE` 存在时显示文书金融执行按钮；保留原现金操作。精确 HEAD `d1e9665c` 的 [Validate HomeFlow #43570486078](https://github.com/PTamako/homeflow/actions/runs/43570486078) **completed/success**。

### 65.2 现阶段安全边界与剩余任务（不得假报完成）

- 上述代码全在 **Draft PR**，所有新增功能 flag、Service Binding、签名秘密和迁移在正式环境均**未配置/未执行**；本节没有对 Cloudflare D1、R2、Worker、Pages、Secrets 做任何更改，也没有创建 Preview。阶段 A 的历史可恢复备份已由用户验收，但**未授权阶段 F 正式部署**。
- 文书→家計簿 **现金 expense/income** 已有源端真实 SQLite + 签名目标模拟、目标端真实 SQLite/journal 独立专项，各自 CI 绿；仍欠跨仓库三个真实处理器同场的 Service Binding 集成、生产前 schema 实际重放检查、网络断连/并发隔离回归、双人 iPhone PWA 实机验收。不能称端到端上线。
- **明确未完成**：文书→HomeFlow 任务 / →知学学习卡的可信真实执行链；知学 §64 只有未接线目标内核；非现金账务（信用卡、SBI、储值、积分、资产转移）的独立会计执行器；剩余金融历史身份迁移、严格多用户/离线缓存隔离、B–E 其余需求与 F 用户授权后的正式发布。现金不应替代上述操作。
- 继续遵守冻结契约：`document.sync.finance` 的源候选/目标账户只按稳定 ID、版本、不可变摘要、家庭/双方身份关联；HomeFlow 执行租约不携带私人 OCR 正文。失败恢复只重试原审批 ID，结果不明先查目标 journal，不能另外创建支出。密钥不可写入代码/交接。
- **执行交接状态**：截至本节这批代码全部已直接 Commit 到各自 Draft 分支，未遗留此会话创建的本地未提交文件。另一 Work/云端工作区如有私有未提交改动，GitHub 不提供查询渠道，不能宣称已经看见或保存。下次接手以四仓库 PR HEAD 和 CI 精确 SHA 为准。

## 66. 2026-11-14 P0-1 首次三仓库真实处理器隔离贯通与故障恢复回归（Draft CI 通过，未部署）

### 66.1 真实核对及实际提交

- 本轮重新阅读 Google Docs v1.1、唯一交接及冻结契约；开工时五个 Draft PR HEAD 与 §65 基线完全一致，没有后续提交。HomeFlow #306 仍以 #305 功能分支为 base，其他 PR 均保持 Draft/open；不做功能合并。
- HomeFlow #306 创建 `tests/document-finance-three-real-apps.test.mjs`，**CI Checkout 精确 pin** 家計簿 #309 `900fb17c3bbc68f24c18466da321e85c496b4ea7` 与文书助手 #97 `dcfaa5f714c222d69985f1038341f0bde56c6de9`，在同一 Node 22 测试进程真正导入 HomeFlow `documentApprovalSubmissionRoute/approvalRoute/approvalExecutionRoute/approvalVerificationRoute`、文书助手 `documentExecutionRoute/sealDocumentIntent`、家計簿 `documentFinanceRoute`。三个独立内存 SQLite 分别执行真实迁移，不接入真实 Cloudflare，不用生产 Token/数据。
- 第一笔 commit [`d555d682`](https://github.com/PTamako/homeflow/commit/d555d682afc35d69168594fdc850cf47a013f166) 创建真实执行链测试；首次 CI [#43574840721](https://github.com/PTamako/homeflow/actions/runs/43574840721) **失败**，819 个测试中 817 通过、2 个新断言失败：未审批隐藏资源按真实后端返回 404（不是预期 409），且金融账户 HomeFlow 家庭身份为不可变字段。**没有修改/削弱生产安全代码或迁移**。修正测试场景 commit [`992eaa6c`](https://github.com/PTamako/homeflow/commit/992eaa6cd3a6568e56cd86c7bdf951cd0dba0f52)，精确 CI [#43574957949](https://github.com/PTamako/homeflow/actions/runs/43574957949) `completed/success`。
- 追加并发/事务失败/网络断开/过期回执/变更身份场景 commit [`96beabb0`](https://github.com/PTamako/homeflow/commit/96beabb03b721e01fe967aaed428da4ea2d7b1cd)，精确最终 [Validate HomeFlow #43575145862](https://github.com/PTamako/homeflow/actions/runs/43575145862) `completed/success`。此 commit 为本节核对的 HomeFlow #306 HEAD，**不是生产部署**。
- HomeFlow main 的仅 Markdown 冻结契约 `docs/four-app-cross-app-contract-v1.md` 已安全更新 `v1.0.3`：把旧 `applied:false` 静态表格改为文书金融真实执行状态，记载六条跨服务 HMAC 域、Binding、精确字段、回执/恢复和默认 OFF 规则。独立 docs-only commit [`11fb5b7c`](https://github.com/PTamako/homeflow/commit/11fb5b7c892eb74f620d1cf593ecb2b20697cf34)，[main Validate CI #43575044869](https://github.com/PTamako/homeflow/actions/runs/43575044869) `completed/success`。已核对 HomeFlow `deploy.yml` 的 `paths-ignore: docs/**, **/*.md`，该 main 文档提交未触发生产部署工作流。

### 66.2 同一次 CI 真实三端处理器的覆盖与结论

- 文书助手真实 AES-GCM 冻结快照和用户/家庭/候选/账户版本建立后，真实 HomeFlow 签名提交建立 `pending`；成员未经 owner 审查不写账；owner 后端真实 `review/approve`；HomeFlow 原子执行租约签名调用文书真实处理器，文书后端再次取得 HomeFlow 真实执行中 proof；文书把加密收入/支出操作交给家計簿真实处理器，家計簿取得 HomeFlow 真实 proof 与文书实时 `source-check`，真实 SQLite 事务提交 `entries`、目标不可变 journal、真实 approver 审计，随后源端持久 reservation/receipt，HomeFlow 标记 `applied`。
- 覆盖同名不同稳定账户 ID、源撤权、账户版本变化、HomeFlow 身份停用及跨家庭管理员不能审批/执行、文书版本和候选更新的旧申请失效；flags 缺失在三端分别拒绝；伪造目标 HMAC 被拒绝。身份链接家庭改写在家計簿被不可变触发器阻止。
- 覆盖双设备并发只写一条、重复点击和 journal replay 不增记账、目标已成功入账但调用方回执丢失同 ID 重试、执行前 source-check 网络断开后同 ID 恢复、目标 SQLite 在第一笔 `entries` 写入后人工注入异常并强制回滚，确保未产生孤儿流水、journal 或审计；审批过期后的未知回执走**只读 receipt** 而非再次执行；0023/0024/0030 等相关**幂等增量迁移**在内存 SQLite 重放并检查关键索引。
- 特别注意：测试中的 `APP_ENV=production` 仅用于使真实 Worker 业务模块在**内存环境**走同一分支；绝未调用 Cloudflare API、真实 Worker Service Binding 或正式 D1/R2。尚未验证真实 iPhone 两个账号的独立 PWA、真实 Cloudflare Service Binding 与正式迁移后的完整业务链，均属于以后 F 阶段用户明确许可后才能进行的验收。不可称已经上线。

### 66.3 余项与安全交接

- P0-1 的主要跨仓库真实处理器隔离测试已通过。仍可扩展细粒度 HTTP 超时/回执签名及更高并发量、不同成员/家庭异常字段注入、源权限变化的跨库并发竞态和两 App 完整 UI 浏览器回归；**跨 D1 的撤权与已开始执行竞态仍须谨慎验证/改进，不可把内存 SQLite 误报成实际多 Worker 生产事务**。
- 尚未完成：P0-2 文书→HomeFlow 待办真实可信执行；P0-3 文书→知学 §64 内核的真实 Service Binding 执行；P0-4 非现金账务（信用卡、储值、积分、SBI、转账、修删恢复等）独立执行；B–E 剩余身份迁移/通知/多用户离线缓存覆盖，以及 F 阶段生产批准后迁移与双 iPhone 实机验收。不要重写 §65 的三端现金逻辑。
- 本轮功能代码只提交至 HomeFlow #306 Draft 分支；main 只做文档更新。其余四个 Draft PR 未因本次测试而更新；各自 §65 精确 HEAD 保持可核对。没有创建 Preview、没有启用 Flag、没有生产写入/部署，不重新要求 A 阶段备份。CI 中运行的 GitHub Runner 临时空间不代表可访问上一位 Work 未提交代码；本轮变更均有以上 GitHub commit，可继续从实时 HEAD 接手。

## 67. 2026-11-14 P0-2 HomeFlow 真实任务目标 D1 事务内核（隔离 CI 通过；文书源端尚未接线）

- 本节在 §66 的真实三仓库文书现金测试成功后继续；HomeFlow #306 保持 Draft，基于 #305，原来四个其他功能 Draft PR 不变。
- HomeFlow #306 新建未执行 migration `0056_document_task_apply.sql`（独立 `document_task_applied_actions` journal、身份/任务/执行租约约束、不可变更新/删除触发器、创建时由 D1 trigger 原子标记 HomeFlow 审批 `applied` 并追加**真实 approver** 事件）、`worker/document-task-apply.js` 的 `applyDocumentTask` 及 `documentTaskReceipt`、`tests/document-task-apply.test.mjs`；仅导出已有 `worker/tasks.js` 的 `validated`/`validateRefs` 以复用**同一套任务业务约束**，并将 0056 纳入 `scripts/check_migrations.py` 的完整迁移/索引/trigger 检查。
- 新 target kernel 必须有 `APP_ENV=production` 以及 `APPROVALS_ENABLED`、`APPROVAL_EXECUTION_ENABLED`、`APPROVAL_VERIFICATION_ENABLED`、`DOCUMENT_TASK_EXECUTION_ENABLED` 全部显式 `true`、当前且未过期的审批 executing lease + nonce、owner/member 当前身份、相同候选 ID/摘要、HomeFlow 任务的 visibility / assignee / bonusPoints / reminder 和剩余额外积分校验。它**没有注册任何外部 HTTP 路由**，没有建立文书助手 Service Binding，因此未经文书实时源端复核不可能经网络调用这个 kernel；不得将 `DOC_TASK_EXECUTION_ENABLED` 或其他开关在生产打开。
- 首笔 commit [`3b621496`](https://github.com/PTamako/homeflow/commit/3b62149600df8e873c9e2c7c8498e0c50eb3e464) 的 [CI #43576036320](https://github.com/PTamako/homeflow/actions/runs/43576036320) 失败：两个历史测试将 migration count 固定为 57；新 0056 应为 58，**没有跳过/删除/削弱测试**。修复硬编码清单计数的 [`bef0706e`](https://github.com/PTamako/homeflow/commit/bef0706e88ecf5dee516c63ca88c6cec1736df20)，[完整 Validate CI #43576129976](https://github.com/PTamako/homeflow/actions/runs/43576129976) `completed/success`。
- 测试实际使用 HomeFlow 全量历史迁移 + 新 0056 的内存 SQLite，检查任务/审批 journal/真实 owner 审计的同 D1 事务、重复 ID 回执不重复写、租约 nonce、当前成员停用/账户归属、过期/篡改的拒绝、私人任务分配他人的拒绝、额外积分余额不足的拒绝、任务写完但 journal 之前失败的整事务回滚、迁移 SQL 幂等重播及新开关默认 OFF。
- **P0-2 尚未完成：** 文书后端签名 source-check / 持久 source reservation、HomeFlow 后端真实任务 Service Binding 执行路由、回执回源/网络故障恢复、文书与 HomeFlow 双端 UI 状态更新、跨仓库真实处理器测试，特别是执行过程中的撤权竞态。当前只是可复用的原子 D1 任务目标内核；不得在交接或 UI 宣称文书待办已经同步。P0-3、P0-4 和 B–E 其余全部未完成项沿用 §66。
- 所有改动仅在 Draft 功能 PR（未合并），交接文件仅作为 main 的 docs-only Commit 更新；没有创建 Preview、生产迁移、部署、Cloudflare 资源改动、密钥或敏感文书内容外泄。

## 68. 2026-11-14 P0-1 双应用真实状态 API 端到端回归（隔离 CI PASS）

- HomeFlow #306 Draft commit [`7ca4339f`](https://github.com/PTamako/homeflow/commit/7ca4339f12bde87c779abbaf8215ba41eb792fa7) 扩展三仓库真实处理器测试，**直接调用**文书助手 `documentMemberApprovalStatus` 和 HomeFlow `documentApprovalStatusRoute`、`approvalRoute`，共用 HomeFlow 真正签名状态 API 的请求/回执，替代仅查询 SQLite 表格的 UI 状态假设。
- 在同一隔离集成进程校验真实状态为 `pending:applied=false` → `approved:applied=false` → 真实目标 SQLite entry/journal/source reservation/HomeFlow applied 后，文书助手 `applied=true,target_changed=true,entry_id=1`，HomeFlow 管理员/成员 GET 审批记录同时 `applied=true`、真实 remote_id 与历史 `applied` 事件一致。该来源/目标 UI 的后端状态契约已被实际测试；**不等于两台 iPhone PWA 的实际浏览器 E2E 测试**。
- Commit 对应 [Validate HomeFlow CI #43576488449](https://github.com/PTamako/homeflow/actions/runs/43576488449) `completed/success`；原 #305、家計簿 #309、知学 #179、文书助手 #97 未改变。继续保持 HomeFlow #306 `Draft`；本节唯一交接仍只更新 main 文档，不部署、不执行生产迁移。
- P0-1 剩余更高并发跨数据库撤权竞态以及 F 阶段真实 Service Binding/双 iPhone 实机验收仍不可假报通过。P0-2 尚缺源端可信签名与 Service Binding；已有 HomeFlow 独立任务 kernel 详见 §67。

## 69. 2026-11-14 P0-2 文书→HomeFlow 待办真实双仓审批执行闭环（隔离 CI PASS，仍 Draft）

### 69.1 已实现真实代码

- 文书助手 #97 Draft `b98f25f5` 新建未执行 migration `0025_document_task_execution_reservation.sql`、`worker/document-task-source.js`，在 `worker/index.js` 注册严格签名且默认 OFF 的 `/api/internal/document-task/{prepare,receipt}` 内部入口；执行前实时检查源文书、候选、HomeFlow 身份及撤权、AES-GCM 冻结快照和 HomeFlow 可信 nonce/lease；预约持久且未确认期间锁定文书/候选关键字段；应用回执后持久源端 task_id 与真实本地 approver 审计，同 ID 不重复审计。之后补充 `tests/document-task-source-execution.test.js` commit [`186151f3`](https://github.com/PTamako/jp-document-assistant/commit/186151f3833635430a691674d915b20051389b52)，[CI #43576900525](https://github.com/PTamako/jp-document-assistant/actions/runs/43576900525) **success**。
- 文书助手 #97 [`6735022c`](https://github.com/PTamako/jp-document-assistant/commit/6735022c95bbd0b91a73febb0afbe0431fd3036a) 在原 `documentMemberApprovalStatus` 增加 HomeFlow task 回执核验和 `task_id` 状态回读，不把仅批准视作已同步。[CI #43577122000](https://github.com/PTamako/jp-document-assistant/actions/runs/43577122000) **success**。现金路径没有替换。
- HomeFlow #306 [`7597744d`](https://github.com/PTamako/homeflow/commit/7597744ddae8f29da1b4cd1b9fdc76a1a4e6443d) 新增 `worker/document-task-orchestrator.js`，在原 owner 执行路由调用文书真实 prepare，验证源端返回身份证明、摘要和 task payload 后执行 §67 的 HomeFlow 真实 D1 task 内核；成功后独立签名发送 source receipt；applied 后重复请求只补源回执不再创建任务；修改真实 `approvalVerificationRoute` 支持 doc task 的当前 owner/member+nonce proof，修改 `documentApprovalStatusRoute` 对 task UUID 和 journal 实际比对，保留金融原有处理路径。[CI #43577073137](https://github.com/PTamako/homeflow/actions/runs/43577073137) **success**。
- HomeFlow #306 [`4a19fba5`](https://github.com/PTamako/homeflow/commit/4a19fba5b3df09da05bdaf179ada7b893e59413e) 在 CI 中把文书源仓库 checkout **pin** 到 `6735022c95bbd0b91a73febb0afbe0431fd3036a`，新建 `tests/document-task-three-real-apps.test.mjs`，同一次 Node 测试用两个真实仓库的处理器及独立真实 SQLite schema，贯通成员提请→管理员审查→nonce 租约→文书源端解密/身份复核/预约→HomeFlow 原生 task/journal/审计/applied 事务→文书精确 receipt→两端 status API；还实测双设备竞态、执行前撤权、各端 flag OFF、目标任务已创建但源回执网络丢失后仅补回执，没重复建任务。对应 [完整 Validate CI #43577281240](https://github.com/PTamako/homeflow/actions/runs/43577281240) `completed/success`。

### 69.2 诚实剩余与边界

- 此次通过的是**真实双仓处理器隔离集成验收**，不是 F 阶段正式部署/迁移。还未做旧任务匹配/更新、源端正在执行时 HomeFlow 身份撤权/文书授权撤销的分布式竞态与失败终态释放/回收、完整 PWA 浏览器界面回归、生产 Cloudflare Service Binding 联调及两台 iPhone 实机验收。不要把 P0-2 宣称全部完成。
- 完整需求仍保留：P0-3 文书→知学可信执行、P0-4 信用卡/储值/积分/SBI/转账等非现金事务以及 B–E 其余身份/金融/通知/离线隔离均未因本次任务路线提交而完成。
- 五个功能 PR 继续 Draft/open；未修改任何 Cloudflare 生产资源/迁移/Secrets，不启用功能开关，不建 Preview。A 阶段生产备份 PASS 但 F 部署仍必须另请用户批准。


## 70. 2026-11-14 P0-3 知学可信目标执行及审批人原子审计：隔离 CI PASS，跨仓整体待完成

- 本轮以真实 Study #179 HEAD 1a5420cc41b2573eb733c3d6d835cf2af6827589 为基线，在原 Draft PR 开发，不重新实现 §64 事务内核。
- [7bfb4dab](https://github.com/PTamako/it-study-platform/commit/7bfb4dab7afe6f82ff2bf4e98af54fa4373a8300) 新增 worker/document-study-execution.ts，且为 worker/index.ts 增加独立后端路由。目标端要求文书助手 13 位时间戳原始 JSON 签名、HomeFlow 有效 executing nonce/lease 以及文书端当前源内容的独立签名复核，才可执行 §64 applyVerifiedDocumentStudy；重复 ID 只读原 receipt。
- 新未执行 migration 0192_homeflow_document_study_approver_audit.sql：真实审批人与申请人分别记录、严格校验同家庭 active member/owner，个人词汇/句子、immutable journal、actor audit 同一 D1 batch；若审计插入失败则个人学习记录与 journal 全事务回滚。没有更改现有手动收藏路由。
- [9402e17c](https://github.com/PTamako/it-study-platform/commit/9402e17c57ed421325e11bd6a9f738bda9a08177) 加入 scripts/document-study-execution.test.mjs：真实内存 SQLite、签名模拟 HomeFlow/文书源、错误签名/Origin、重复 ID、撤权和跨用户隔离、回执复核及强制审计故障回滚。
- 初始 [CI 43578060278](https://github.com/PTamako/it-study-platform/actions/runs/43578060278) 失败：部分原 Worker 测试用 data: URL 加载入口，无法解析新增静态 import。采用项目已存在的 lazy-load 模式，不弱化任何测试，修复 commit [c4e7928a](https://github.com/PTamako/it-study-platform/commit/c4e7928ad3c94c2bcfdbfc92c3d646ebd45cb1ed) 后 [完整 CI 43578236478](https://github.com/PTamako/it-study-platform/actions/runs/43578236478) completed/success。Study #179 当前 HEAD c4e7928a、保持 Draft。
- **P0-3 尚未完成：** HomeFlow real study proof 客户端、文书真实 study-source-check/源预约/回执、HomeFlow study 执行编排、申请人状态更新、真实三仓处理器集成测试、撤权并发恢复均未接线；目前目标后端在缺少真实 Service Binding/独立密钥或默认 OFF 的新开关时拒绝写入。不能使用普通收藏桥接绕过审批。
- P0-4 非现金金融及 B–E 其他所有未完成项仍保留，F 正式部署与双 iPhone 实机验收仍须用户另行授权。未触碰正式 Cloudflare/生产数据，未创建 Preview、未部署、未执行正式迁移。


## 71. 2026-11-14 P0-3 文书→知学真实三仓执行闭环：隔离完整 CI PASS；正式联调仍阻断

### 71.1 本次实际增量与真实 PR/Commit

本轮从 §70、设计书 v1.1 和冻结契约 §K 继续。先核对五个 Draft PR 最新 HEAD：HomeFlow #305 `b8b877388639b1a2b3ac19dbca58ea8072b8a037`（#306 base 仍是 #305 功能分支），HomeFlow #306、家計簿 #309 `900fb17c3bbc68f24c18466da321e85c496b4ea7`、知学 #179、文书助手 #97；未重复开发 §66/§68 现金或 §69 任务事务内核。无法通过 GitHub API 查看上一位开发者**未提交的私有本地工作区**，只核实了服务端 Git refs 及提交。

- **HomeFlow Draft #306**（branch `feature/family-approval-state-machine-20261113`）：`c1bda1ba` 给 HomeFlow proof 路由增加独立知学签名客户端 `it-study-platform` 和精确 `document.sync.study` / `document_sync_candidate` 类型校验；`321cb43f` 加独立 HMAC、活跃成员、nonce/lease、跨客户端拒绝测试；`4fb79734` 增加所有者执行租约调度文书 Study 源端，同一 request_id receipt-only 到期回读，不复用家計簿现金业务；`f88dcdea` 支持文书源端独立签名复核同一 Study 工单；`80ad0480` 文书审批状态 API 只接受 opaque 32hex Study remote_id、有效 applied 回执；`ab69088a` 修复新 HMAC 测试采用 LF 原始字节；`a07fdead` 新 `tests/document-study-three-real-apps.test.mjs` 真实三仓处理器与隔离 SQLite 测试；`db044b7a` 将 JPDA `ade2dba8` 与 Study `496b06a0` 精确 pin 为 CI 对端；`5abc869d`、`7a1a0534` 修复测试真实数据库表字段及独立文书源 proof 预期。**最后一次完整功能代码提交：`7a1a0534c47368ff0a6afadb53209fb48cb1ceed`**。 [CI `43584526633`](https://github.com/PTamako/homeflow/actions/runs/43584526633) `completed/success`。
- **文书助手 Draft #97**（branch `feature/homeflow-identity-link-safety-20261113`）：`288e52fc` 新未执行 migration `0026_document_study_execution_reservation.sql`（防删除/身份不可变/执行源版本锁）；`28cb1e94` 新 `worker/document-study-source.js`：HomeFlow 私有 execute/receipt、Study 独立源 check、AES-GCM 冻结候选解密、活跃身份/源版本和审批租约核实、持久 reservation/nonces、知学目标真实 Service Binding 执行及回执对账、实际 approver 审计、失去 target 回复后同 request_id 先读原 journal 再决定是否执行；`57d94201` 注册严格内部签名路由；`ade2dba8` 文书状态只有核对 HomeFlow opaque ID 与自己已保存的真实 Study 回执才显示已同步。**当前功能 HEAD：`ade2dba88f95a183a6bf31f73309a9792a6daa5e`**。[完整 CI `43583992542`](https://github.com/PTamako/jp-document-assistant/actions/runs/43583992542) `completed/success`。
- **知学 Draft #179**（branch `feature/homeflow-identity-isolated-20261113`）：`de995da6` 独立 Study→文书 source-check 加 **execution_nonce**、校验持久 reservation、nonce_hash、源摘要；回执 JOIN 新 immutable approver audit，而不只读目标词句，避免无法从私人目标回读真实审批人；`496b06a0` 更新真实内存 SQLite、签名模拟后端测试，保留错误 HMAC、撤权、跨用户、事务回滚验证。**当前功能 HEAD：`496b06a021cdd1c822f49774b31a26f31bca9895`**。[完整 CI `43583598302`](https://github.com/PTamako/it-study-platform/actions/runs/43583598302) `completed/success`。
- 冻结跨应用契约更新：HomeFlow #306 `docs/four-app-cross-app-contract-v1.md` 新 **§L v1.0.6**，固定原始 JSON HMAC 域、Study 双独立 proof/Service Binding、source-check nonce/reservation、回执隔离及开关默认 OFF；覆盖 §K 待协调项但不改变 §I/J 已完成现金和任务协议。**此契约修改仅存在原 Draft 分支，尚未合并 main、未部署**。
- 三仓集成测试真实 import HomeFlow `approvalExecutionRoute`、`approvalVerificationRoute`、`documentApprovalStatusRoute`，文书 `documentStudySourceRoute`、`documentMemberApprovalStatus`，知学 `documentStudyExecution`；三个仓库各自在独立 SQLite 打开实际迁移。mock 仅用于 **Service Binding 传输**，而非整个业务处理器。测试批准仍不改目标、AES-GCM 快照、源端预约、知学实际个人词汇/receipt/approver 审计、文书真实 receipt、HomeFlow applied、重复 ID 不再写入、目标已提交但回执网络丢失后读取原 receipt、安全失败（撤权/过期功能开关）和 migration 重放/不可变触发器。

### 71.2 验收边界、未来优先级与绝对限制

- **P0-3 现已通过三仓实际处理器的隔离集成 CI**；但这不代表全产品完成，也不代表生产三套 Cloudflare Service Binding、真实迁移、网页/PWA、夫妻 iPhone、生产 R2/D1 联调已授权或通过。所有新功能仍默认 OFF。
- 已知待补：执行中跨独立 D1 的真正并发身份/文书撤权与 target commit 竞态、源端失效租约和失败终态清理（目前持久 reservation 可保持锁，需可靠且可审计恢复）、浏览器级审批状态 UI/PWA 回归、双设备跨网络联调。
- **下一优先 P0-4**：从完整非现金业务模块实际执行开始（信用卡消费及应付、储值充值/消费、积分、SBI 積立/追加/ポイント投资、资产转移、历史关联、共享账簿增改删恢复/批量/周期授权），明确资产/应付/现金流的不同会计语义。不得借现金执行器假装非现金目标已实现。
- **B–E 仍未完成**：跨 PWA 首次 OAuth/PKCE/禁用、双人完整金融账户 CRUD 与历史正确迁移、审批周期和高风险动作、私人文书共享权限及全部知学离线/缓存隔离均需按设计书 R1–R9 与 T01–T14 逐项检验。家計簿 #309 未因本次 Study 完成而变更。
- A 阶段四 D1+三 R2 真实加密备份与 Mac 恢复 PASS；绝不重新要求用户执行 A。五个功能 PR 均保持 Draft，**不合并、不创建 Preview、不执行生产迁移/回填、不改生产 Secrets、不部署/启用 flag**。F 阶段生产及两台 iPhone 验收必须单独经用户明确批准。


## 72. 2026-11-14 P0-4 第一组完整非现金业务：信用卡消费+独立应付账款，两仓真实处理器 SQLite / 完整 CI PASS

### 72.1 交付事实与对应 PR

此节从 §71 的 P0-3 三仓 PASS 继续，而非回到 §70 重新开发。**本节只宣告首组 `finance.credit_card.purchase` 隔离闭环，不代表 P0-4 全部完成**。冻结契约已经追加 §M v1.0.7（见 HomeFlow Draft #306 `docs/four-app-cross-app-contract-v1.md`）。

- **家計簿 Draft #309** `feature/homeflow-sso-isolated-foundation-20261113`：增加未执行 migration `0031_family_card_purchase_execution.sql`：加密意图、版本 CAS、不可变共享家庭消费及独立信用卡截账月应付、实际 requester/approver 审计；独立 `functions/api/family-finance/card-purchases.js` 成员申请准备/提交/查询/取消；独立 `functions/api/internal/card-purchases/[[path]].js` 真正信用卡执行（AES-GCM 解密、HomeFlow 同 nonce/lease 签名证明、entries + 目标 journal + audit 单事务、回执同 ID 恢复），绝不调用现金账户执行器；`functions/api/family-finance/assets.js` 稳定 `account_id` 的家庭应付账期汇总，与资产分离，不虚构银行现金扣款；成员 `src/FamilyFinanceCardPurchases.vue` 及家族账户页面挂载，`src/FamilyFinanceAssetOwnership.vue` 双人共享显示；`tests/family-card-purchase-execution.test.mjs` 实测独立 SQLite 幂等、HMAC、真实事务与审计回滚、身份/版本失效、迁移重复执行。当前最新功能 Commit **`244535227826f6caa2258179ba30aa32162c7ad1`**，完整 CI **`43586044462` success**、**`43586044499` success**。此前 CI 中测试用 `revoked` 而真实 Kakeibo enum 仅有 `disabled`，已修复，未删除安全断言。
- **HomeFlow Draft #306** `feature/family-approval-state-machine-20261113`：新 `worker/card-approval-submission.js` 严格后端卡片独立 HMAC 提交，`worker/index.js` 注册，`worker/approvals.js` 新 `finance.credit_card.purchase`；`worker/approval-verification.js` 独立卡端 `kakeibo-card` proof key + 精确 `operation/resource_type/version`；`worker/approval-execution.js` HomeFlow owner 租约调度真实 Kakeibo 卡目标及不可变回执后置 applied，不把批准误报入账。**首次双仓 CI 发现未执行审批表的操作 CHECK 白名单遗漏了新 operation，修复**：因为 `migrations/0054_household_approval_core.sql` 从未进入 main 或生产，只在 Draft #306 上对未执行的迁移扩展操作白名单（不触碰现有生产 D1），保留原始身份触发器/审计。工作流精确 pin 家計簿 `24453522` 为对应处理器。新 `tests/family-credit-card-real-cross-app.test.mjs` 真实 HomeFlow+Kakeibo 处理器、两套独立内存 SQLite、只模拟 Cloudflare Service Binding 传输，验证 member 提案→owner 批准→真实非现金目标事务→HomeFlow applied、目标已提交但 HomeFlow 收不到回执仍同 ID 恢复、撤权与 CAS fail-closed。最后功能/迁移 Commit **`16e3e3d44bf920bf7fff0962c003b87415880fe6`**；完整 HF CI **`43586512718` success**（tests + build + migrations + Wrangler dry-run）。契约 §M 提交 **`fb077e129384d6a89988f415e44fd1344c07941f`**。
- **文书助手 Draft #97** `ade2dba88f95a183a6bf31f73309a9792a6daa5e`、**知学 Draft #179** `496b06a021cdd1c822f49774b31a26f31bca9895`，本节没有修改；§71 三仓业务及完整 CI 仍保存。**HomeFlow #305** 保持原 Draft/base 关系；**HomeFlow #306** 仍基于 #305，不是 main。

### 72.2 已验收财务边界与仍未完成内容

- 信用卡购买**一笔家庭消费**进入 entries，源端本人独立 `stable account_id`，不使用旧卡显示名冒充稳定账户，目标另记一笔 `family_card_purchase_applied` 应付负债与批准人不可变审计，不应立即减现金、银行、储值卡余额或 SBI 份额；截账月根据卡片 closing_day 计算，卡片还款日/实际扣款不凭空推断。
- **未完成且不能对外宣称已实现**：卡片账单还款与银行现金扣款、积分抵扣卡账或兑换、储值卡充值/消费及现金流关系、SBI 積立/追加买付/积分投资、资产转移与历史关联、家庭共享修改/删除/恢复、批量与高风险审批、周期定投/固定费授权。每类需独立账务语义、真实事务、CAS、审计、回执和跨仓测试。下一步应按一类完整模块推进，而不是创建大量不可用的接口。
- 待完成安全验收：HomeFlow/Kakeibo 当前版本 CAS、跨独立 D1 执行途中撤权的真实竞态一致性（虽然双方执行前都会验身份、但不能将单次 mock 验证宣称并发证明）、实际 PWA 浏览器 UI/E2E/双 iPhone、生产 Cloudflare Service Binding 与本地/远程迁移应用，及 R1–R9、T01–T14 其余 B–E 项。
- A 阶段历史加密备份与 Mac 真实恢复全部 PASS，不重做。**绝对限制延续**：五 PR 都保持 Draft，不合并、不碰正式 Workers/Pages/D1/R2/Secrets，不重建 Preview，不启用正式 flag，不动任何真实用户历史；F 阶段必须由用户额外明确授权。此轮 GitHub API 只能查看远程提交/分支，不可能读取上一位开发者工作区未提交的代码，不能虚称已清理他们的本地更改。


## 73. 2026-11-14 P0-4 后续：信用卡银行流水核对、还款核销、两仓真实执行（Draft；生产 F 未授权）

### 先确认最新真实基线

- 家計簿 #309 最新完整功能 SHA：e37d66a09256c85884f3f745208a587469b5b287。GitHub Actions Validate run 43591071019 completed/success；Mobile WebKit Smoke run 43591071020 completed/success。均为 PR 隔离 CI，不是生产双 iPhone 验收。
- HomeFlow 家庭审批 #306 代码与精确 Kakeibo 对端 SHA pin：5e903a08669f88e02b280b82c758ddb623b5659c。GitHub Actions Validate HomeFlow run 43591391921 completed/success（包括新真实 HomeFlow → Kakeibo 处理器的双 SQLite 回归）。#306 仍以 #305 功能分支为 base；不要以 main 为功能基线。
- 原有身份 #305、文书助手 #97、知学 #179 仍采用 §72 所列 Draft 基线，未合并、未部署；继续作业前必须再核对 HEAD/CI，以上 SHA 只是本节核验时点。
- §71/§72 的完整交接文件从 #306 安全 append-only 同步到 main：main docs-only commits 5c535b4c93fe878e70896edc9a0885d920551055 和 cda8209d2ebafc6cdab53a51dcc951ad837d4f5f；首次同步前已经确认 .github/workflows/deploy.yml 的 docs/** 与 **/*.md paths-ignore，未合入 #306 功能代码。§N 新冻结契约也已 append-only docs-only 同步 main，commit 6ddd994b3a8d348931bf73d30e1640bddf09510a。只将文档同步视为文档可见，不得解释为生产协议部署。

### 已真实编码、提交、通过针对性/完整 CI 的功能

- 家計簿新增未执行 migration 0032_family_card_settlement_foundation.sql：独立密文源申请 family_card_settlement_intents；银行流水凭证 family_card_bank_debit_evidence；不可变还款转账 family_card_settlements_applied；每笔跨账期、部分偿还的 family_card_settlement_allocations；强制金额全部核对、实际 actor/approver 分离、变更拒绝的 family_card_settlement_audit；加数据库 triggers 防过额、跨卡、版本漂移、伪造日期、重复来源参考号、无审计篡改和购买前还款。此迁移从未执行于生产 D1。
- 家計簿新成员源 API functions/api/family-finance/card-settlements.js，受真实 HomeFlow member 身份 + stable card/bank account ID + expected_version + flag 控制；申请仅在人工勾选确认实际银行流水、提供交易参考号、真实扣款日期与多购买分配后才生成 AES-GCM 冻结申请。银行参考号不明文进入 HomeFlow；新只读 outstanding 只列本人有剩余应付的购买。借记日期不得晚于 JST 今天，亦不得早于拟核销的原消费日期。仅 prepare 不创建费用/转账，提交后状态是等待 HomeFlow，不可把 approved 显示成 applied。
- 家計簿新目标 functions/api/internal/card-settlements/[[path]].js：单独 HMAC execute/receipt，单独 HomeFlow 审批租约 nonce proof，双账户/用户身份 CAS，解密源快照与 digest；真实 D1 batch 一次插入银行已确认扣款 evidence、entries.type=transfer（bank stable account → credit stable account）、应用 journal、逐笔原消费核销分配和审计。采购早已记过的 expense 不再插入第二次；同一 HomeFlow request ID 丢回执或重试先读原不可变结果。
- 家計簿新增 read-only memberCardLiabilities 投影：按卡及原 bill_month 算 gross_charge、settled 与 remaining；用户能看到部分结算及跨账期核销，应付总额随真实核销减少，家庭消费不会重复加算。家庭资产 UI 明示此结果不是银行实时余额/净资产。新增 FamilyFinanceCardSettlements.vue 在既有 FamilyFinanceAccess 内呈现本人卡、本人银行账户、人工确认扣款日期/参考号、待清偿原消费逐条分配及 HomeFlow 状态；切号时清理内存私密状态。
- HomeFlow #306 新 worker/card-settlement-approval-submission.js + index 路由、approval whitelist、0054 migration 操作 CHECK 白名单、approval-verification 新独立 client/secret/domain、approval-execution 独立 Service Binding/secret/lease/receipt 路由；owner 必须在 HomeFlow 另行审批并执行，member 不得直改正式家庭共享账。
- 独立冻结契约扩展为 §N v1.0.8，明确各方向独立 HMAC 密钥与域、签名字段、幂等 ID、银行日期证据、分配、实际 actor、受控 flags 与数据边界；不覆盖 §M 信用卡消费 / §I 现金。HomeFlow CI 的 .contract-kakeibo 精确 pin 到 e37d66a09256c85884f3f745208a587469b5b287，未动态引用会移动的分支。

### 测试事实与边界（不得缩写为“生产验收成功”）

- 家計簿 tests/family-card-settlement-foundation.test.mjs：真实 SQLite migration 重复载入、消费与转账不重复计费、跨账期拆分、超额/重复参考号保护、不可变审计和账户版次、日期匹配失败。
- 家計簿 tests/family-card-settlement-execution.test.mjs：真实 SQLite AES 申请加密、不暴露银行参考号、签名验证、重复执行原回执、同笔只记一次 transfer、真实流水日期、无第二笔 expense、gross－已分配净应付、撤权/版本错误/禁用开关/注入审计失败完全回滚，以及拒绝未来扣款日期/购买前还款。对应完整 Validate 和 Mobile WebKit 成功。
- HomeFlow tests/family-credit-card-settlement-real-cross-app.test.mjs：真实 HomeFlow 申请、审批、proof、租约、执行，以及真实家計簿源和目标处理器，在两套独立 SQLite 和模拟后端 Service Binding 上验证审批前无流水、审批后执行一次、跨月部分还款、重复请求、目标先提交但返回网络丢失后同审批 ID恢复、member 撤权、card/bank CAS、owner 禁用。与 HomeFlow 完整 CI 43591391921 成功。
- 所有独立 flag 仍默认 OFF；APP_ENV=production 只是隔离测试构造条件，不代表启用生产。没有操作任何生产 D1/R2/Worker/Pages/Secret、没有建立 Preview、没有在两台 iPhone 上实际运行功能。

### 必须继续、绝不能误报已完成的内容

1. 信用卡退款、消费撤销、还款冲正、重复出现于遗留银行流水中的对账与真正银行端交易核实：当前还款仅对**人工确认已发生的银行交易**建独立 journal，未接银行 API；不能声称已经验证第三方银行数据或实现退款反向账务。不能直接修改已完成消费/还款/审计，只能设计并实现可追溯反向凭证。银行实时余额也未在此迭代启用计算。
2. P0-4 下一整模块：按会计语义分别打通储值卡充值/消费/余额、积分充值/兑换/抵扣、SBI 積立/追加買付/ポイント投資和真实生效日、资产转移的双账户借贷、共享账目修改/删除/恢复/批量导入、周期授权/固定费/定投 Cron 幂等，先真实 SQLite，再 HomeFlow+目标仓跨仓真实处理器 CI；不得复用现金或信用卡消费 journal 冒充其他财务类型。
3. 其他 B–E 未完成：设计书 R1–R9、T01–T14 的首次 PWA 安装/重授权/切号、全账户历史归属及 CRUD 边界、审批 Push/长期租约终态、文书已有三条跨应用联动剩余旧任务匹配/更新及恢复、知学旧考试/错题/进度/收藏/离线队列/端侧缓存隔离、跨 D1 最终撤权与持久 reservation 回收、真实浏览器级 PWA 回归等。绝不能按本节完成来高估整个项目进度。
4. 未来继续每完整业务模块时，记录精确仓库 HEAD、PR Draft、CI run、真实测试失败与修复、迁移/contract version、风险与未完成项；必要时将 **仅文档** append-only 同步 main，但部署生产 workflow 必须再次校验路径排除。严禁误合并 #306 功能代码或操作生产/Preview。
