# HomeFlow × kakebo_jp · 只读财务联动

## 设计
- 家計簿为唯一真实账本。HomeFlow 不具备家計簿写权限，也绝不连接它的 D1。
- kakebo_jp 独立 PR #240 提供 GET /api/homeflow-bridge，只允许专用 HTTP Secret，限制日期最多 31 天、200 笔费用。
- HomeFlow 中只有 Owner 可访问账本集成，而且只能关联**自己创建**的旅行计划。
- 用户在“旅行计划 → 家計簿实际支出”中主动选择记录；HomeFlow 只存外部 entry ID，不复制原始记账条目。
- 预留资金不是真实存款/收入；实际支出总额根据最新账本数据实时计算，不重复记账。
- 家計簿桥接口绝不能被浏览器直接调用；连接密钥仅存 Cloudflare Worker Secret。
- HomeFlow Preview 一律禁止请求家計簿 Production。

## 配置与验收（请不要将值发送到聊天）
1. 家計簿 PR #240 的只读接口 CI 与安全审查通过后，用户自行在 Cloudflare Pages Production 的 Variables and Secrets 中设置 HOMEFLOW_BRIDGE_TOKEN，随机 >=32 字符。
2. HomeFlow Worker Production 设置 KAKEBO_BRIDGE_TOKEN，**值必须与家計簿 HOMEFLOW_BRIDGE_TOKEN 完全相同**，仅限 server-side secret。
3. 在 HomeFlow Owner 账号中打开某次自己创建的旅行，指定最多 31 天的查询范围，然后逐笔勾选需关联的真实消费。
4. 验证日志没有复制密码或任何 Secret，且 partner 无法读取关联的真实明细；不要把明细显示为家庭共享。
5. 若未配置 Secret，FinancePanel 显示“家計簿安全只读联动尚未启用”，这是正确的安全行为。

正式启用前，不要在 PR 文本、GitHub Issues 或聊天中粘贴 token。
