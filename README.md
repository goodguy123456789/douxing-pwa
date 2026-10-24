# 都行 · Sites 版

基于原项目提交 bbbced227a63f95d24f80b5d23fe1f9363394025 迁移，现已升级 v1.3：南岸区真实餐厅推荐，保留双人决策、公平排序、匿名 Token 和 PWA。

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

## v1.3 真实餐厅

四片区：南坪6家、弹子石／南滨路5家、茶园5家、重庆邮电大学校外周边5家，共21家。资料核对日期2026-10-24，不代表当天营业确认。3家有平台参考人均，其余留空；有限预算排除价格未知门店，只有双方都不限预算才纳入。茶园、重邮当前在有限预算下没有结果，必须由用户主动修改预算，不自动放宽。

创建必须选片区，创建后不可改。D1房间JSON保存areaId、catalogVersion和完整候选快照，双方/换组沿用同一快照。未增加数据库表或迁移SQL。旧饭局保持原推荐直到到期，旧缓存页面访问新饭局返回426提示刷新。

接口：POST /api/rooms 新增必填 areaId（nanping/danzishi/chayuan/cqupt）；新客户端所有饭局请求发送 X-Duoxing-Client: restaurants-v1，继续发送 X-Duoxing-Auth: token-v1 及参与者Bearer Token。areaId/catalogVersion仅新饭局返回；新推荐priceLevel/distance/spicyLevel允许null，并增加id/address/averagePrice/priceSource/sourceUrl/checkedAt。新饭局忽略距离筛选并保存unlimited，旧饭局仍支持原距离条件。

餐厅目录：server/restaurant-directory.json；资料证据：docs/restaurant-sources.md。菜系归类沿用现有类别；匹配公式与公平排序不变，未知人均不补0，未知辣度中性处理。预算1/2/3沿用最高价格等级，分别包含≤50、≤100、全部已知价格等级；unlimited才包括未知价格。

维护时重新核对门店，更新来源和checkedAt，修改CATALOG_VERSION并发布。已经创建的饭局不追随目录变化。API的Zod校验与客户端类型为保留的生成快照，本仓库没有上游OpenAPI生成器；修改契约时须同步shared/api-zod/generated/api.ts、generated/types及shared/api-client/generated/api.schemas.ts。
