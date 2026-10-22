# 都行 · 双人吃饭决策 PWA

「都行」帮助两个人一起决定吃什么：创建饭局、分享房间码、分别填写饮食偏好，再查看共同的推荐结果。项目包含网页前端、API 后端和 PostgreSQL 数据库，采用 pnpm 工作区管理。

> 本仓库已从 Replit 导出。当前仍保留 Replit / Linux 环境配置，尚未完成 Windows 原生开发适配。下载和阅读代码可以直接进行；安装依赖、启动服务前，请先阅读下面的兼容说明。

## 现有功能

- 创建或加入双人饭局，通过房间码邀请另一位参与者。
- 分别填写预算、距离、辣度和菜系偏好，双方提交后查看推荐。
- 换一组推荐、重新选择，并处理双方操作时的版本冲突。
- 使用参与者 Token 访问受保护的房间数据，支持返回上次饭局。
- 创建饭局时支持 1、3、12、24 小时有效期；实际过期时间由服务端计算。
- 提供 PWA manifest、Service Worker 和图标资源。

上述内容根据当前代码整理，不代表已完成本地运行验收或生产发布验收。

## 技术栈与目录

| 层级 | 技术 / 工具 |
| --- | --- |
| 前端 | React 19、Vite 7、TypeScript、Tailwind CSS 4、TanStack Query |
| 后端 | Express 5、TypeScript、esbuild |
| 数据库 | PostgreSQL、Drizzle ORM / Drizzle Kit |
| 接口 | OpenAPI、Orval、Zod |
| 工作区 | pnpm、Node.js 24 |
| 测试 | Node.js Test Runner、Playwright |

```text
douxing-pwa/
├─ artifacts/
│  ├─ duoxing/             # 实际应用前端
│  ├─ api-server/          # API 服务、房间逻辑及后端测试
│  └─ mockup-sandbox/      # 界面原型子项目
├─ lib/
│  ├─ db/                  # 数据库连接、表结构和迁移 SQL
│  ├─ api-spec/            # OpenAPI 定义和代码生成配置
│  ├─ api-client-react/    # 前端接口客户端及请求封装
│  └─ api-zod/             # 接口校验代码
├─ docs/                   # 功能设计、验收记录和运维方案
├─ scripts/                # 工作区辅助脚本
├─ attached_assets/        # 素材
├─ package.json            # 根目录脚本
├─ pnpm-workspace.yaml     # 工作区、依赖目录和平台覆盖配置
├─ pnpm-lock.yaml          # 已锁定的依赖版本
├─ .replit                 # Replit 环境配置
└─ replit.md               # 原有运行说明
```

数据库表结构以 `lib/db/src/schema/` 为准；接口定义以 `lib/api-spec/openapi.yaml` 为准。

## Windows：先下载并打开项目

准备 Git for Windows、Node.js 24、pnpm 10 和 VS Code。仓库没有通过 `packageManager` 字段固定 pnpm 的精确版本；请保留现有锁文件，不要改用 npm 或 Yarn 安装项目依赖。

在 Windows **命令提示符 CMD** 中检查工具：

```cmd
git --version
node --version
pnpm --version
```

本项目当前使用的本地目录为：

```text
C:\Users\Administrator\Desktop\计算机学习\douxing-pwa
```

首次下载时，在目标父目录执行；如果同名目录已经存在，先检查它，不要覆盖：

```cmd
cd /d "C:\Users\Administrator\Desktop\计算机学习"
git clone https://github.com/goodguy123456789/douxing-pwa.git
cd douxing-pwa
git status
```

然后在 VS Code 中选择“文件 → 打开文件夹”，打开仓库根目录。能看到 `package.json`、`pnpm-workspace.yaml` 和 `artifacts`，就完成了下载与打开。

## 安装与启动前的 Windows 兼容事项

当前配置有以下已知限制，本 README 不会自动修复它们：

1. 根目录 `preinstall` 使用 `sh`、`rm` 和 Shell 的 `case` 语法；后端 `dev` 脚本使用 `export`。这些写法不能直接按 CMD 命令运行。仅安装 Git Bash 也不能解决下面的平台依赖问题。
2. `pnpm-workspace.yaml` 的 `overrides` 移除了 esbuild、Rollup、Lightning CSS、Tailwind Oxide 等组件的 Windows 平台依赖，需要先调整平台配置并核对锁文件。
3. 前端 Vite 配置要求显式提供 `PORT` 和 `BASE_PATH`；后端也要求 `PORT`，两者应使用不同端口。
4. 前端使用相对 `/api` 请求。当前 Vite 配置没有本地 API 代理，后端也没有托管前端页面；本地需要配置 `/api` 转发或对应的本地路由。单独启动两个进程不能直接完成联调。
5. 当前开发服务配置监听 `0.0.0.0`。Windows 适配时应将本地开发服务绑定到 `127.0.0.1`，再进行本机验证。

建议顺序：先完成 Windows 脚本与平台依赖适配，再安装依赖；准备独立数据库和本地 API 路由后，再启动应用。完成适配后，可使用 `pnpm install --frozen-lockfile` 检查依赖安装；如果提示锁文件不匹配，应先核对原因。

## 准备独立的开发数据库

开发环境使用本机 PostgreSQL 及一个独立空数据库，例如 `duoxing_dev`。Replit 原配置使用 PostgreSQL 16，可先按这个版本准备本地实例。

- 不复制 Replit 的生产 `DATABASE_URL`、Secrets、数据库备份或线上用户数据。
- 后端启动后会立即执行过期房间清理，之后每分钟重试；清理会删除过期房间及关联记录，因此启动前必须确认连接的是本地开发库。
- 数据库表结构初始化与迁移也只针对这个独立空库执行。
- 当前 `.gitignore` 没有忽略 `.env`；不要直接把真实凭据写入仓库内的文件。当前后端代码也未配置自动读取 `.env`。

主要环境变量如下：

| 变量 | 使用位置 | 本地准备方式 |
| --- | --- | --- |
| `DATABASE_URL` | 后端、Drizzle Kit | 仅使用指向 `127.0.0.1` 的本地开发库连接 |
| `PORT` | 前端、后端 | 分别在两个终端设置，例如前端 5173、后端 5000 |
| `BASE_PATH` | 前端 | 在网站根路径开发时设为 `/` |
| `NODE_ENV` | 后端 | 本地开发设为 `development` |
| `DUOXING_AUTH_MODE` | 后端 | 独立空开发库使用 `token`；未设置时代码默认为 `legacy` |
| `LOG_LEVEL` | 后端 | 可选，日志级别 |

完成 Windows 兼容处理、创建本地数据库及专用开发账号后，下面是后端终端的 **CMD 配置示例**。`LOCAL_USER` 和 `LOCAL_PASSWORD` 是占位符，需要替换为本地开发账号；设置变量本身不会启动服务：

```cmd
set "NODE_ENV=development"
set "PORT=5000"
set "DUOXING_AUTH_MODE=token"
set "DATABASE_URL=postgresql://LOCAL_USER:LOCAL_PASSWORD@127.0.0.1:5432/duoxing_dev"
```

另开前端 CMD 终端时，使用自己的端口和根路径：

```cmd
set "PORT=5173"
set "BASE_PATH=/"
```

这些设置只作用于当前 CMD 及其子进程，不会修改 Replit 环境。不要将 `DATABASE_URL` 的真实值粘贴到问题反馈或 Git 提交中。

确认目标为本地空开发库、且依赖已经可用后，才执行表结构初始化：

```cmd
pnpm --filter @workspace/db run push
```

该命令会修改所连接的数据库。`push-force` 是另一条现有脚本，不作为日常初始化步骤使用。

## 现有脚本参考

以下命令从仓库根目录执行，前提是相应环境和依赖已准备好。它们是脚本索引，不代表当前 Windows 配置已通过运行验证。

| 命令 | 作用 / 前提 |
| --- | --- |
| `pnpm run typecheck` | 检查共享库及子项目的 TypeScript 类型 |
| `pnpm run build` | 先检查类型，再递归构建工作区；前端构建也需要 `PORT` 和 `BASE_PATH` |
| `pnpm --filter @workspace/duoxing run dev` | 启动前端开发服务；需要本地环境变量、监听地址与 API 路由准备完成 |
| `pnpm --filter @workspace/api-server run dev` | 原有后端开发入口；当前含 `export`，不兼容 CMD |
| `pnpm --filter @workspace/api-server run build` | 构建后端，不启动服务 |
| `pnpm --filter @workspace/api-server run start` | 启动已构建后端；会连接数据库并启动清理任务 |
| `pnpm --filter @workspace/api-spec run codegen` | 从 OpenAPI 重新生成接口代码，会修改生成文件 |

在依赖兼容问题已解决、后端环境变量和本地数据库已准备好之后，CMD 可分别执行后端 `build` 和 `start`，以避免使用现有 `dev` 中的 `export`；这不替代其他 Windows 适配与本地路由配置。

## 测试与验证

| 命令 | 测试范围 / 依赖 |
| --- | --- |
| `pnpm --filter @workspace/api-server run test` | 默认执行匹配算法、HTTP 日志和定时清理调度测试 |
| `pnpm --filter @workspace/duoxing run test` | 前端本地逻辑测试 |
| `pnpm --filter @workspace/api-server run test:api` | 房间接口测试，需要运行中的本地 API；当前地址固定为 `http://localhost:80/api` |
| `pnpm --filter @workspace/api-server run test:auth` | 认证回归，需要独立测试数据库及本地 API；包含数据库读写 |
| `pnpm --filter @workspace/api-server run test:retention` | 到期清理回归，需要独立测试数据库及本地 API；包含数据库读写 |
| `pnpm --filter @workspace/duoxing run test:browser` | Playwright 浏览器测试，需要 Chromium 和前后端均可访问的本地应用地址 |

浏览器测试默认地址为 `http://localhost:80`，可使用 `DUOXING_TEST_BASE_URL` 指定其他本地地址；该地址必须同时能够访问页面和 `/api`。部分后端集成测试仍固定使用 80 端口，改变前端端口不会自动修改它们。

集成测试会创建房间、参与者及偏好等数据。测试时应用与测试进程必须连接同一个独立开发数据库，不使用生产环境。修改文档时无需为此启动服务或运行数据库测试。

## 进一步阅读

- [原有运行说明](replit.md)
- [匹配算法说明](docs/matching-v1.2.md)
- [v1.2.1 验收记录](docs/acceptance-v1.2.1.md)
- [v1.2.2 验收记录](docs/acceptance-v1.2.2.md)
- [v1.2.3 实现说明](docs/implementation-v1.2.3.md)
- [认证、数据库迁移与生产切换方案](docs/auth-v1.2.3-operations.md)

文档中的生产切换步骤是操作方案，不表示已执行，也不构成发布授权。本地开发环境准备与生产部署分别处理。
