# 浏览器回归

在本项目根目录使用 CMD。先构建、对本地 D1 应用尚未执行的迁移，再启动本地 Worker。

```cmd
set "DUOXING_TEST_BASE_URL=http://127.0.0.1:55180"
npm run test:http
npm run test:browser
```

首次需要通过 Playwright 安装 Chromium，或设置 PLAYWRIGHT_BROWSERS_PATH 指向已有兼容浏览器目录。不要将测试地址指向 Replit 正式站；默认使用 55180 的独立本地环境。

71 项单元/D1/算法测试使用 npm test。tests/reference-api 中仅 rooms.test.mjs 作为迁移后的 HTTP 回归运行，其余 PostgreSQL 代码只作原始实现参考，已排除出当前类型检查和测试入口。

trace 与截图保存在 generated-artifacts/，包含合成测试凭据，仅在本机诊断使用，不纳入 Git 或发布产物。
