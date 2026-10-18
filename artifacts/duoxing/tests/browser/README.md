# 重选与刷新浏览器回归

覆盖二次确认、另一端轮询同步、偏好版本错误后的刷新恢复，以及邀请链接与本人草稿隔离。
使用真实 API 和临时房间，每例独立创建两个参与者，不依赖历史房间。
测试不删除已有数据；新建的测试房间按应用现有到期规则处理。

## 运行

1. 安装工作区依赖：`pnpm install --frozen-lockfile`。
2. 首次安装 Chromium：`pnpm --filter @workspace/duoxing exec playwright install chromium`。
   Linux 环境须具备 Playwright Chromium 所需系统库。
   若已提供兼容 Chromium，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。
3. 启动现有的都行 web 和 API Server 工作流，确保开发数据库可用。
4. 在项目根目录运行：

   ```sh
   pnpm --filter @workspace/duoxing run test:browser
   ```

   本工作区也可直接使用环境提供的 Chromium（已实测通过）：

   ```sh
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium \
     pnpm --filter @workspace/duoxing run test:browser
   ```

默认访问共享代理 `http://localhost:80`（同时路由页面和 `/api`）。
也可以设置 `DUOXING_TEST_BASE_URL` 指向该项目的开发预览地址；不要指向生产。
测试不会另起服务或修改部署配置。

所有用例使用 402×874 视口。取消确认后等待真实轮询再核对无 reset、
版本/双方草稿/确认/结果不变；确认后阻断发起端轮询，要求 reset 响应本身
在 1.5 秒内移除结果，另一端通过真实轮询恢复草稿。
两个版本错误用例仅修改首次请求体，不伪造服务端响应；刷新后检查本地身份、
保存草稿和未保存修改的恢复边界，并提交当前版本。

失败截图和 trace 位于 `generated-artifacts/duoxing-browser/`，已排除 Git 与部署。
trace 含测试房间的参与凭证，仅用于本地诊断，不应公开分享。
原有单元/API测试入口保持不变：

```sh
pnpm --filter @workspace/duoxing test
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server test:api
```
