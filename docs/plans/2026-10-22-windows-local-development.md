# Windows 本地开发实施计划

目标：在指定的本地仓库准备可安装、可构建的 Windows 开发环境；使用回环地址联调前后端，后端在连接数据库前拒绝远程地址。

方案：使用 Node.js 脚本代替依赖 Unix Shell 的开发入口，保留 Replit 现有开发配置；Vite 加载仓库根目录的本地环境文件，在本机监听并转发 /api。保留现有依赖版本和版本发布时间限制，只恢复 Windows 所需的原生组件。

边界：本轮不推送、不部署、不连接生产；未检测到可用的本地数据库工具，因此不创建数据库、不运行数据库集成测试。独立 PostgreSQL 的安装与建库留到后续步骤。

技术：Node.js 24、pnpm 10.32.1、Vite 7、Express 5、Node Test Runner。

## 步骤

1. 用 scripts/tests/local-development.test.mjs 验证本地数据库地址检查、端口、回环监听、前端代理及 Replit 兼容行为；先确认测试失败，再实现 scripts/development-env.mjs。
2. 新增 artifacts/api-server/dev.mjs，先准备和检查开发环境，再构建与启动后端；为后端入口增加可选 HOST。更新根目录和子项目启动命令。
3. 更新两个 Vite 配置，从仓库根目录读取本地配置并提供本地默认值；移除前端脚本覆盖监听地址的参数。
4. 恢复 pnpm-workspace.yaml 中 Windows 平台组件，保留版本约束；安装依赖并核对锁文件变更。将 pnpm 精确版本写入 package.json。
5. 增加 .env.example 及忽略规则，更新 README 的 Windows CMD 使用步骤和已验证范围。
6. 执行本地配置测试、现有不依赖数据库的前后端测试、类型检查及构建；启动前端进行本机 HTTP 验证，核对 API 转发目标，然后停止验证服务。
7. 核对差异与忽略文件，创建 after 存档，记录实际验证结果及数据库尚未准备的限制。

## 验收

- 本地开发入口拒绝缺失或远程 DATABASE_URL，错误不泄露连接密码。
- Vite 默认监听 127.0.0.1:5173，/api 转发到 127.0.0.1:5000。
- pnpm 可在 Windows CMD 安装依赖；无需 Git Bash。
- 记录构建和现有测试的实际结果；不将未执行的数据库测试记为通过。

## 本轮验证结果

- pnpm 10.32.1 在 Windows 上完成依赖安装，随后 `pnpm install --frozen-lockfile --offline` 成功；锁文件仅补充 Windows 平台组件及对应引用，未升级既有业务依赖。
- `pnpm test` 全部通过：开发配置 7 项、后端默认单元测试 35 项、前端逻辑测试 24 项，共 66 项。
- 初次类型检查发现共享 MJS 配置缺少声明及异步 Vite 配置返回类型推断问题；补充 `scripts/development-env.d.mts` 与 `UserConfig` 类型后，全项目 `pnpm run typecheck` 通过。
- `pnpm -r --if-present run build` 成功构建原型、API 和实际前端。实际前端构建出现一条既有 `tooltip.tsx` 的源码映射定位提示，构建退出码为 0。
- 使用实际 Vite 配置在临时回环端口验证首页 HTTP 200、TSX 转换 HTTP 200，以及 `/api` 向本机 HTTP 验证端点的路径和查询参数转发；没有启动应用后端，没有连接数据库。
- 实际运行后端开发入口，缺失配置与虚构远程数据库地址均在构建前拒绝启动；未输出连接密码。
- 尚未准备 PostgreSQL，未创建真实 `.env.local`，未运行认证、到期清理、房间接口及完整浏览器集成测试。数据库步骤仍需后续完成。
- 依赖目录、构建产物和真实本地环境文件由 Git 忽略，不纳入本地版本存档。

临时 Vite 验证在三项 HTTP 断言通过后，关闭阶段仍有进程挂起；已仅终止本轮验证进程树完成清理。该验证不记为正常退出的测试套件，HTTP 断言结果与上面的 66 项单元测试分开记录。
