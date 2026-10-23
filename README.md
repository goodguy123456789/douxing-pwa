# 都行 · Sites 版

基于原项目提交 bbbced227a63f95d24f80b5d23fe1f9363394025 迁移，保留 v1.2.4 页面、算法、匿名 Token 和 PWA。

## Windows 本地开发

使用 Node.js 24，在本目录用 CMD 执行：

```cmd
npm run install:ci
npm run build
npm run dev -- --hostname 127.0.0.1 --port 55180
```


首次初始化本地 D1 时，将 drizzle/ 中尚未应用的 SQL 按顺序交给模板 README 中的本地迁移命令；仅使用 --local。

## 验证

- npm test：算法、界面逻辑、真实本地 D1 的 API、并发、认证和清理测试。
- npm run typecheck：类型检查。
- npm run test:browser：对独立本地环境运行真实双端浏览器回归。
- npm run build：构建 Sites Worker。

## 数据与发布

新站独立数据库，不读取旧站数据。饭局创建后寿命固定，1/3/12/24 小时可选，新页面默认明确提交 12 小时，旧客户端缺省为 24 小时。到期立即拒绝操作；每次 API 完成后后台删除最多 100 个到期饭局，无访问时不保证立即物理删除。

房间状态按内部版本进行原子更新，冲突最多重试五次。Token 原文仅在创建/加入时返回，数据库只存哈希，响应不披露对方身份或草稿。

通过 Sites 官方工具同步源码、保存版本和部署。不要把 .env、.wrangler、.sites-runtime、node_modules、浏览器 trace 或旧数据库放进源码仓库。Replit 原站与原 GitHub 仓库保持现状。

原模板的运行说明见 docs/sites-template.md。
