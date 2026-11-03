# HomeFlow Stage 1 — 私人登录、家庭与一次性任务

计划：Owner 在 Cloudflare **Worker Secret** 中单独设置 \`HOMEFLOW_BOOTSTRAP_SECRET\`，长度至少 32 个随机字符；Preview 与 Production 必须不同。此密钥仅用于创建第一个账号，不是 GitHub Actions 的 Cloudflare Token。

- 首次注册：仅当家庭表为空且拥有正确一次性 Bootstrap Secret 时，才允许创建 Owner。
- 第二人通过 Owner 生成的一次性邀请代码注册独立账号；每家庭账号数上限 2。
- 登录：PBKDF2-HMAC-SHA256 + per-user random salt；独立随机 session，D1 仅存 token SHA-256；HttpOnly/Secure/SameSite=Lax cookie，14 日有效。
- 所有改变数据的 API：同源 Origin 校验；登录失败有失败次数限制。
- \`family_profiles\`：绑定账号的人、未绑定账号的人、宠物；豆沙有自己的档案。每个人的密码和会话不共享。
- \`tasks\`：private 仅创建者可见/操作；household 则两人可见与共同完成；可指定成员、豆沙为关联主体。
- 独立 D1 数据库、严格预览/生产身份校验；实际所有个人数据请求均进行登录和 household_id 范围检查。
- 阶段 2 再加生日纪念日、重复任务、Cron 与 Web Push；阶段 1 仅一次性待办和基本家庭档案。

## 迁移
1. 先在 homeflow-preview 运行 \`0002_stage1_family_tasks.sql\`，进行 Preview 验收。
2. 迁移通过后才在 homeflow 生产库运行；先确认尚无真实用户数据。
3. Stage 0 是 REST API 直接执行的，Wrangler migration tracking 可能未初始化；不能误用 Wrangler 从头重跑 ALTER TABLE。
4. 切勿让生产 DB 绑定 Preview Worker，也不能修改 kakebo_jp / it-study-platform。
5. 不把用户密码、邀请码、Bootstrap Secret 放入 GitHub、Issue、日志或聊天。

## 上线限制
- 未配置 Bootstrap Secret 时，创建第一个家庭明确返回 503；登录及私人页面保持安全。
- 部署不等于已通过双设备权限验收。真机和双账号权限验证必须另行做。
- Stage 1 后若还未做完整安全审查，不应录入敏感健康、财务或身份文件。
