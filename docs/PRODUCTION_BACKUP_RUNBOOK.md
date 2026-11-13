# HomeFlow 正式环境数据库与相册灾难恢复手册（2026-11-13）

> 重要：这是**操作说明与本地核验**，不是自动备份，不能把 ZIP 应用内导出当作完整的生产数据库备份。本仓库不上传真实数据、不创建 Preview/D1/R2、不会在部署时自动对正式数据库执行写入。

## 需要分开保存的备份

1. **完整 D1（必需）**：包含家庭账号关系、任务、积分、抽奖、优惠券、通知记录、照片元数据等。普通 ZIP 的积分档案只读，恢复不会重新铸造积分或券。
2. **私有 R2 照片对象（必需）**：D1 SQL 导出只包含 `media_assets` 元数据，不包含照片实际字节。各账号的 HomeFlow ZIP 可以保存有权读取的照片，但共享照片的恢复仍由原创建者执行。若计划灾难恢复，另将已授权 R2 对象备份到受保护的位置并维护对象键清单。
3. **两位成员各自的 HomeFlow ZIP（辅助）**：每人单独导出并安全保存，验证完整性，但不替代完整 D1 + R2 快照。

## 只读导出正式 D1

先在**自己的可信计算机**上安装依赖、登录 Cloudflare。确认 `wrangler.toml` 仅指向生产 `homeflow`。

```bash
npm ci
umask 077
mkdir -p private-backups
npx wrangler d1 export homeflow --remote --output=./private-backups/homeflow-$(date +%Y%m%d).sql
```

Cloudflare 官方命令说明：
https://developers.cloudflare.com/d1/best-practices/import-export-data/

**不要**把 SQL、R2 对象、ZIP 上传到公开 GitHub、PR、Actions artifacts、聊天或无加密云盘。建议将备份放到已加密的本地磁盘；离线复制一份。备份结束后清理非加密临时文件。不要把它放进 Git 工作树；`private-backups/` 已在 `.gitignore`。

## 安全恢复演练（不得操作生产）

- 在离线本地临时 SQLite 数据库导入导出的 SQL，执行 `PRAGMA integrity_check;` 和 `PRAGMA foreign_key_check;`。
- 检查 `d1_migrations`、`household_members`、`completion_points`、`household_lottery_draws`、`lottery_coupons`、`media_assets` 的计数和引用一致性。
- 验证两位成员私人资料不互通，照片对象存在且可由授权账号读取。
- 演练数据使用本地隔离环境；**禁止**创建已弃用的 Preview，也禁止 `wrangler d1 execute --remote` 重放历史迁移。
- 如需要正式恢复，先由负责人审核恢复范围与时点、确认最新备份、计划停写与回滚，并单独授权。当前自动部署只进行检查，不自动恢复生产记录或积分。

## 验收

真实 iPhone/iPad 的两账号登录、推送到达、点击跳转、离线同步、图片编辑，以及双方 ZIP 导出/恢复，继续记录在 Issue #4。代码 CI 通过不能代替真机签收。
