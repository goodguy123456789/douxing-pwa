# 都行 · 双人吃饭决策 PWA

「都行」帮助两个人一起决定吃什么：创建饭局、分享房间码、分别填写饮食偏好，再查看共同的推荐结果。项目包含网页前端、API 后端和 PostgreSQL 数据库，采用 pnpm 工作区管理。

## 现有功能

- 通过房间码创建或加入双人饭局。
- 分别填写预算、距离、辣度和菜系偏好，双方提交后查看推荐。
- 换一组推荐、重新选择，并处理双方操作时的版本冲突。
- 使用参与者 Token 访问受保护的数据，支持返回上次饭局。
- 创建饭局时支持 1、3、12、24 小时有效期，由服务端计算过期时间。
- 包含 PWA manifest、Service Worker 和安装图标。

## 技术栈与目录

| 层级 | 技术 / 工具 |
| --- | --- |
| 前端 | React 19、Vite 7、TypeScript、Tailwind CSS 4、TanStack Query |
| 后端 | Express 5、TypeScript、esbuild |
| 数据库 | PostgreSQL、Drizzle ORM / Drizzle Kit |
| 接口 | OpenAPI、Orval、Zod |
| 工作区 | Node.js 24、pnpm 10.32.1 |
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
├─ docs/                   # 设计、验收记录、运维方案与实施计划
├─ scripts/                # 工作区辅助脚本和开发环境配置测试
├─ attached_assets/        # 素材
├─ .env.example            # 本地环境配置示例，不含真实凭据
├─ pnpm-workspace.yaml     # 工作区及平台依赖配置
├─ pnpm-lock.yaml          # 锁定依赖版本
├─ .replit                 # Replit 环境配置
└─ replit.md               # 原有 Replit 运行说明
```

数据库表结构以 `lib/db/src/schema/` 为准；接口定义以 `lib/api-spec/openapi.yaml` 为准。

## Windows 本地开发

以下命令使用 Windows **命令提示符 CMD**，从仓库根目录执行。需要 Git for Windows、Node.js 24、pnpm 10.32.1；编辑器可以使用 VS Code。项目通过 `packageManager` 固定 pnpm 版本，请保留锁文件，不改用 npm 或 Yarn 安装项目依赖。

### 1. 下载和安装依赖

首次下载时执行；已有同名目录时，直接打开现有仓库：

```cmd
cd /d "C:\Users\Administrator\Desktop\计算机学习"
git clone https://github.com/goodguy123456789/douxing-pwa.git
cd douxing-pwa
```

在 VS Code 中选择“文件 → 打开文件夹”，打开 `douxing-pwa`。确认工具版本后安装依赖：

```cmd
git --version
node --version
pnpm --version
pnpm install --frozen-lockfile
```

安装检查已使用 Node.js 脚本代替 Unix Shell；工作区保留了 Windows 所需的原生组件，无需依赖 Git Bash 执行开发脚本。

### 2. 先检查前端界面

```cmd
pnpm run dev:web
```

打开 `http://127.0.0.1:5173`。默认只监听本机；`/api` 请求转发到 `http://127.0.0.1:5000`。按 `Ctrl+C` 停止。

**未准备本地数据库、未启动后端时，仅能检查页面加载，创建或加入饭局等功能无法使用。** 前端代理固定使用回环地址，不转发到 Replit 线上服务。

### 3. 准备独立的本地 PostgreSQL

在本机安装 PostgreSQL 16，并创建一个独立的开发账号和空数据库，例如 `duoxing_dev`。这一步需要单独完成；安装 Node.js 依赖不会创建数据库。

不要复制 Replit 的生产 `DATABASE_URL`、Secrets、线上数据库备份或用户数据。后端启动后立即运行过期房间清理，之后每分钟执行，因此开发环境必须与线上数据隔离。

创建根目录本地配置文件：

```cmd
copy .env.example .env.local
```

将 `.env.local` 中的占位账号和密码替换为刚创建的本地开发账号：

```dotenv
DATABASE_URL=postgresql://duoxing_dev:CHANGE_ME_LOCAL_ONLY@127.0.0.1:5432/duoxing_dev
API_PORT=5000
WEB_PORT=5173
DUOXING_AUTH_MODE=token
```

`.env.local` 和其他 `.env*` 文件已被 Git 忽略，只有 `.env.example` 纳入版本管理。不要在提交、截图或问题反馈中附上真实连接密码。

| 变量 | 本地用途 |
| --- | --- |
| `DATABASE_URL` | 独立本地 PostgreSQL 连接；开发启动入口只接受 `127.0.0.1`、`localhost`、`::1` |
| `API_PORT` | 本地后端端口，默认 5000；同时用于前端代理目标 |
| `WEB_PORT` | 本地前端端口，默认 5173 |
| `DUOXING_AUTH_MODE` | 独立空开发库使用 `token` |
| `BASE_PATH` | 可选，本地根路径默认为 `/` |
| `LOG_LEVEL` | 可选，后端日志级别 |

前端 Vite 配置读取根目录的环境文件；根目录 `dev:api` 通过 Node.js 读取 `.env.local`。修改端口或配置后重启相关开发进程。

### 4. 初始化本地表结构

确认连接目标是刚创建的本地空库后，在同一 CMD 中设置本地连接再执行：

```cmd
set "DATABASE_URL=postgresql://LOCAL_USER:LOCAL_PASSWORD@127.0.0.1:5432/duoxing_dev"
pnpm --filter @workspace/db run push
```

`LOCAL_USER` 和 `LOCAL_PASSWORD` 是占位符，替换为本地账号。此处 Drizzle 命令直接读取终端的 `DATABASE_URL`，不会自动读取根目录 `.env.local`，两处连接需要指向同一个本地开发库。

`push` 会修改所连接的数据库，执行前自行核对目标；本地后端启动入口的地址检查不覆盖手动运行的 Drizzle 命令。`push-force` 不作为日常初始化步骤。

### 5. 启动完整本地应用

数据库初始化完成后，分别打开两个 CMD 终端，切换到仓库根目录。

后端：

```cmd
pnpm run dev:api
```

前端：

```cmd
pnpm run dev:web
```

打开 `http://127.0.0.1:5173`，再进行创建饭局、第二位参与者加入和推荐流程验证。后端开发入口先检查本地数据库地址，再构建与启动服务；配置缺失或指向远程数据库时会直接退出。

原有后端 `start` 是通用启动命令，不包含本地入口检查。日常 Windows 本地开发使用 `dev:api`；不要用 `start` 绕过配置错误。

## 构建与测试

不依赖数据库的检查：

```cmd
pnpm test
pnpm run typecheck
pnpm run build
```

`pnpm test` 运行本地开发配置测试、后端默认单元测试和前端逻辑测试；不启动数据库集成测试。构建会生成被 Git 忽略的 `dist` 等产物。

| 命令 | 作用 / 前提 |
| --- | --- |
| `pnpm run test:local` | 本地数据库地址、端口、回环监听、代理和 Replit 兼容配置测试 |
| `pnpm --filter @workspace/api-server run test:api` | 房间接口测试，需要运行中的本地 API，当前地址固定为 `http://localhost:80/api` |
| `pnpm --filter @workspace/api-server run test:auth` | 认证回归，需要独立测试数据库和本地 API，包含数据库读写 |
| `pnpm --filter @workspace/api-server run test:retention` | 到期清理回归，需要独立测试数据库和本地 API，包含数据库读写 |
| `pnpm --filter @workspace/duoxing run test:browser` | Playwright 浏览器测试，需要 Chromium 和前后端均可访问的本地应用 |
| `pnpm --filter @workspace/api-spec run codegen` | 重新生成接口代码，会修改生成文件 |

浏览器测试默认地址为 `http://localhost:80`。准备好本地前后端后，可使用 CMD 设置 `DUOXING_TEST_BASE_URL=http://127.0.0.1:5173`；部分后端集成测试仍写死 80 端口，需要另行适配后再运行，不会随前端端口自动改变。

所有集成测试仅使用独立开发数据库。应用和测试进程需要连接同一个本地库，测试会创建房间、参与者与偏好记录。

## Replit 兼容说明

存在 `REPL_ID` 时，开发配置继续使用 Replit 提供的 `PORT`、`BASE_PATH` 和数据库连接，保留原有监听方式及路由，不启用本地 API 代理。Windows 本机无需设置 `REPL_ID`。

本地迁移不等于生产迁移。修改本地文件或创建 Git 提交不会自动发布；推送、生产数据库迁移和部署分别处理。

## 进一步阅读

- [原有 Replit 运行说明](replit.md)
- [匹配算法说明](docs/matching-v1.2.md)
- [v1.2.1 验收记录](docs/acceptance-v1.2.1.md)
- [v1.2.2 验收记录](docs/acceptance-v1.2.2.md)
- [v1.2.3 实现说明](docs/implementation-v1.2.3.md)
- [认证、数据库迁移与生产切换方案](docs/auth-v1.2.3-operations.md)
- [Windows 本地开发实施计划](docs/plans/2026-10-22-windows-local-development.md)

生产操作文档是方案，不表示已经执行，也不构成发布授权。
