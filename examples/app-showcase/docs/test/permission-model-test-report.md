# 权限模型实测报告(ADR-0090)

> 测试清单:[permission-model-test-checklist.md](./permission-model-test-checklist.md)
> 设计文档:[docs/design/permission-model.md](../../../../docs/design/permission-model.md)
> 可复跑示例:[e2e/permission-model.spec.ts](../../e2e/permission-model.spec.ts) + [scripts/](./scripts/)
> 测试日期:2026-07-14 · 环境:examples/app-showcase,`objectstack serve --dev`(:3777),SQLite(file DB)

## 1. 结论摘要

- **REST 全量套件:49/49 断言通过**([scripts/perm-test.sh](./scripts/perm-test.sh),覆盖清单 A~K 节)。
- **Playwright 套件:11/11 通过**([e2e/permission-model.spec.ts](../../e2e/permission-model.spec.ts):REST 代表用例 6 条 + console UI 实测 5 条,UI 全部留证截图)。
- 实测发现并修复 **2 个引擎级缺陷**(见 §3):写时 RLS check 漏判岗位适用域;`/auth/me/permissions` 身份解析漂移导致 console 假只读。修复后全套件复验通过。
- 另有 6 项行为观察 / 测试注意事项(见 §4),均为符合设计或可解释的行为,记录备查。

## 2. 执行结果(按清单分节)

| 节 | 主题 | 结果 | 备注 |
|---|---|---|---|
| A | 能力门(并集、只加不减) | ✅ 5/5 | A3 验证 everyone 基线与显式集叠加 |
| B | 字段级安全 FLS | ✅ 3/3 | budget `editable:false` 写被剥离,值不变 |
| C | OWD 记录基线 | ✅ 6/6 | 含 controlled_by_parent 跟随主发票 RLS |
| D | 深度 scope(own/org) | ✅ 4/4 | 读写不对称(readScope:org + writeScope:own)成立 |
| E | 共享 sharing | ✅ 5/5 | 条件规则物化为 sys_record_share 行;复合条件不满足不产行 |
| F | VAMA 记录级旁路 | ✅ 4/4 | viewAllRecords 只读、modifyAllRecords 可写他人 |
| G | RLS 硬边界 | ✅ 5/5 | **G4 首测失败 → 引擎缺陷①,修复后通过** |
| H | everyone 基线 | ✅ 3/3 | 锚点门拦截 VAMA 集绑 everyone |
| I | guest 匿名 | ✅ 3/3 | 匿名数据 API 401;公共表单通道可提交 |
| J | 委托管理(D12) | ✅ 6/6 | 子树 + 白名单 + 锚定三重校验全部生效 |
| K | explain 引擎 | ✅ 2/2 | 逐层解释;查他人需管理员 |
| L | console UI 实测 | ✅ 5/5 | **L5 首测失败 → 引擎缺陷②,修复后通过**;截图见 §5 |
| M | 范围外 | — | 按设计文档标注跳过(planned / 企业版) |

## 3. 实测发现的引擎缺陷(均已修复)

### 缺陷① 写时 RLS check 漏判岗位适用域(清单 G4)

- **现象**:ada(contributor)PATCH 自己发票的 `owner` 转移给他人,预期被 `check` 策略拒绝(ADR-0058 D4 post-image 校验),实测却放行。
- **根因**:`packages/plugins/plugin-security/src/security-plugin.ts` 的 `computeWriteCheckFilter` 调用 `collectRLSPolicies` 时**未传调用者持有的 positions**,导致声明了 `positions` 适用域的 `check` 策略对岗位持有者不收集、不评估 —— 与读路径(`using`)行为不一致。
- **修复**:补传 `context?.positions ?? []`,并在 `security-plugin.test.ts` 增加 3 条回归测试(岗位命中触发 check、无岗位不触发、check/using 一致性)。
- **复验**:G4 owner 转移 → 403;G5 同 owner 合法更新 → 200。

### 缺陷② `/auth/me/permissions` 身份解析漂移 → console 假只读(清单 L5)

- **现象**:ada 在 console 打开项目编辑弹窗,**全部字段**渲染为禁用(包括 FLS 允许编辑的 name/status);而同一用户走数据面 REST(`PATCH /api/v1/data/...`)写入正常。两个面对同一用户给出矛盾的权限答案。
- **根因**:`packages/plugins/plugin-hono-server/src/hono-plugin.ts` 的 `resolveCtx` 手搓身份解析,只读 `sys_member` + `sys_user_permission_set`,**漏读 `sys_user_position` 与 `sys_position_permission_set`** —— 岗位授予的全部能力在 `/auth/me/permissions` 端点丢失(ada 返回 `positions:[]`、只剩 `showcase_member_default` 基线、`allowEdit:false`),console 前端据此把表单整体置灰。这违反了 `packages/core/src/security/resolve-authz-context.ts` 声明的强制不变式(“每个 HTTP 入口必须经共享解析器解析授权,禁止自行重读 sys_* 表”);`@objectstack/rest` 已迁移,hono 入口漏迁。
- **修复**:`resolveCtx` 整体替换为委托 `resolveAuthzContext`(与 REST 服务器、runtime 调度器同源),返回 shape 对齐 rest-server;`hono-plugin.test.ts` 增加 2 条回归测试(岗位授予进入权限集解析、匿名返回 `authenticated:false`)。
- **复验**:ada `/auth/me/permissions` 返回 `positions:[org_member, contributor, everyone]`、`showcase_contributor` 权限集、`showcase_project.allowEdit:true` 且 budget FLS 仍锁定;L5 编辑弹窗 name/status/日期可编辑、budget/spent 灰显禁用(截图 L5)。

## 4. 行为观察与测试注意事项

1. **共享规则是写时物化**:条件 sharing 在记录写入/更新时物化到 `sys_record_share` 并重算;改规则后需 touch 记录才生效。测试共享用例要先写一次记录。
2. **岗位↔权限集绑定是管理员显式配置**:岗位本身不携带权限,必须有 `sys_position_permission_set` 绑定行;漏绑时用户静默落到 everyone 基线(无报错)。
3. **能力门先于记录范围**:对象级能力未授予时直接 403,OWD/sharing/VAMA 完全不参与 —— 与设计文档 §2 的层序一致。
4. **guest 孤儿行**:公共表单通道创建的记录 `owner_id=null`,private OWD 下无深度/VAMA 的用户(包括提交者)都不可见、不可改删,只有 org 深度或 VAMA 持有者能处理 —— 询价场景正好合理,但建业务对象时要留意。
5. **scope 层拒绝的响应形态**:记录范围层拒写返回 **HTTP 400 + body `code:FORBIDDEN`**(非 403);能力门层才是 403。断言时按层区分。
6. **审批锁与权限测试相互作用**:`budget>100000 && changed` 的审批规则会锁记录(RECORD_LOCKED),**管理员恢复现场的写入同样触发**,需由待批人 reject/approve 解锁后再继续。权限用例应避开会触发审批的字段组合,或测试后显式清理审批请求。

## 5. UI 实测截图索引([screenshots/](./screenshots/))

| 截图 | 用例 | 证明 |
|---|---|---|
| [L1-ada-tasks-rls.png](./screenshots/L1-ada-tasks-rls.png) | L1 | ada 任务列表仅 3 条自己的(RLS assignee==me 收窄 public OWD) |
| [L2-ada-invoices-rls.png](./screenshots/L2-ada-invoices-rls.png) | L2 | ada 发票列表仅 INV-1001/1002(属主 RLS) |
| [L3a-audrey-inquiries-vama.png](./screenshots/L3a-audrey-inquiries-vama.png) | L3 | audrey 全量询价单可见(viewAllRecords) |
| [L3b-audrey-private-notes-vama.png](./screenshots/L3b-audrey-private-notes-vama.png) | L3 | audrey 可见他人 private_note(VAMA 越过 private OWD) |
| [L4-newbie-inquiries-empty.png](./screenshots/L4-newbie-inquiries-empty.png) | L4 | newbie 询价列表为空(private OWD,无深度/共享/VAMA) |
| [L5-ada-project-budget-fls-locked.png](./screenshots/L5-ada-project-budget-fls-locked.png) | L5 | ada 编辑弹窗:budget/spent 灰显禁用(FLS),status/日期可编辑 |

## 6. 复跑方法

```bash
# 1. 启动 showcase(dev,自动种子 + seed admin)
cd examples/app-showcase && pnpm build
OS_DATABASE_URL=file:/tmp/showcase-perm/data.db \
  node node_modules/@objectstack/cli/bin/run.js serve --dev --port 3777 --ui

# 2. 准备 8 个测试用户/岗位/BU(幂等,可重复执行)
docs/test/scripts/perm-setup.sh   # BASE 默认 http://localhost:3777

# 3. REST 全量套件(49 断言)
docs/test/scripts/perm-test.sh

# 4. Playwright(REST 代表用例 + UI 截图;spec 自我供给,亦可独立于 2/3 运行)
PERM_BASE_URL=http://localhost:3777 \
  pnpm exec playwright test --config playwright.permission.config.ts
```

Playwright 配置不设 `PERM_BASE_URL` 时会自行拉起 :3000 后端(CI 模式)。该 spec 已从默认 smoke 配置排除(`playwright.config.ts` 的 `testIgnore`),仅经上述专用配置显式运行。
