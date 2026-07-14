# 权限模型测试清单(Permission Model Test Checklist)

> 依据:[docs/design/permission-model.md](../../../../docs/design/permission-model.md)(ADR-0090 目标模型)。
> 被测环境:`examples/app-showcase`(`objectstack dev --seed-admin`,端口 3777)。
> 可复跑示例:[e2e/permission-model.spec.ts](../../e2e/permission-model.spec.ts)。
> 实测报告:[permission-model-test-report.md](./permission-model-test-report.md)。

## 测试角色矩阵

| 用户 | 岗位(position) | 权限集(经岗位) | 业务单元 | 用途 |
|---|---|---|---|---|
| admin@objectos.ai | (首用户) | admin_full_access(超管通配) | — | 环境管理、对照组 |
| ada@example.com | contributor | showcase_contributor + everyone 基线 | — | CRUD/FLS/RLS(种子数据的任务/发票属主) |
| mia@example.com | manager | showcase_manager + 基线 | — | 深度 readScope:org / writeScope:own |
| max@example.com | exec | showcase_executive + 基线 | — | 深度 org 读(对比 VAMA) |
| audrey@example.com | auditor | showcase_auditor + 基线 | — | viewAllRecords(VAMA 只读旁路) |
| oskar@example.com | ops | showcase_ops + 基线 | — | modifyAllRecords + systemPermissions |
| dana@example.com | field_ops_delegate | showcase_field_ops_delegate + 基线 | bu_field_ops | 委托管理(adminScope) |
| wes@example.com | (无岗位) | 仅 everyone 基线 | bu_west_coast | BU 子树共享规则接收方 |
| newbie@example.com | (无岗位) | 仅 everyone 基线 | — | everyone 基线 / OWD 基线 |

种子记录对照(`src/data/seed/index.ts`):任务 assignee、发票 owner 使用 ada/linus/grace/sam 的邮箱;
项目 `Compliance Audit` 为 red/预算 9 万;询价单 3 条(new/contacted/closed),OWD `private`。

## A. 能力门(§2 ①:并集、只加不减)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| A1 | 未授予即拒绝 | ada(contributor)POST /api/v1/data/showcase_project | 403(allowCreate:false) |
| A2 | 授予即放行 | ada POST showcase_task(合法体) | 201/200 创建成功 |
| A3 | 并集(多集叠加) | ada GET showcase_product(contributor 集未授予,everyone 基线授予 read) | 200,能读 |
| A4 | 无人授予的操作 | ada DELETE 自己创建的 showcase_task | 403(无任何集给 delete) |
| A5 | 超管通配对照 | admin 读/写任意对象 | 200(admin_full_access 通配) |

## B. 字段级安全 FLS(§2 ②)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| B1 | readable 字段可读 | ada GET showcase_project 记录 | 响应含 budget/spent |
| B2 | editable:false 拒写 | ada PATCH project.budget | 被拒绝或字段被剥离(budget 不变) |
| B3 | 无 FLS 限制者可写 | admin PATCH project.budget | 生效 |

## C. OWD 记录基线(§3)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| C1 | private:非属主不可见 | newbie 建一条 showcase_private_note;ada GET 列表 | ada 看不到 newbie 的 note;newbie 看得到自己的 |
| C2 | private:授 read ≠ 读他人 | newbie GET showcase_inquiry(基线有 read+create) | 只看到自己创建的(种子 3 条不可见) |
| C3 | public_read:人人可读 | newbie GET showcase_announcement | 200 可读全部 |
| C4 | public_read:仅属主可写 | newbie PATCH 他人 announcement | 403 |
| C5 | public_read_write:显式全开 | newbie PATCH 任一 showcase_account | 200(OWD 即基线) |
| C6 | controlled_by_parent | ada GET showcase_invoice_line | 只见 INV-1001/1002 的行(跟随主发票 RLS),见不到 INV-1003/1004 的行 |

## D. 深度 scope(§2 ③,开放版 own/org 两档)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| D1 | readScope:org 越过 private 基线 | mia GET showcase_inquiry | 看到全部询价单(含种子 3 条) |
| D2 | 读写不对称 writeScope:own | mia PATCH 种子询价单(他人属主) | 403;PATCH 自己创建的询价单 → 200 |
| D3 | 对照:无深度者 | newbie GET showcase_inquiry | 仅自己的(同 C2) |
| D4 | exec org 读 private_note | max GET showcase_private_note | 看到所有人的 note(depth 越过 OWD) |

## E. 共享 sharing(§2 ③:只放宽;ADR-0058)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| E1 | 条件规则物化 | admin 查 sys_record_share(share_red_projects_with_execs) | 存在 red 项目→exec 岗位的 share 行(project 本身 public_read_write,读可见性不变,验证物化机制) |
| E2 | 复合条件(&&) | admin 查 share_high_value_red_projects_with_managers 的 share 行 | red 且 budget>100000 才共享;`Compliance Audit`(red、9 万)不产生 share 行 |
| E3 | BU 子树接收方 | wes(bu_west_coast∈bu_field_ops 子树)GET showcase_inquiry | 看到 status=new 的询价单(共享放宽);看不到 contacted/closed |
| E4 | 子树外不放宽 | newbie(无 BU)GET showcase_inquiry | 看不到任何种子询价单(对照 E3) |
| E5 | owner 型规则不静默过享 | 检查启动日志/行为 | owner 型规则被跳过(实验性,记录日志),manager 不因它获得任务可见性 |

## F. VAMA 记录级旁路(§2 ③)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| F1 | viewAllRecords 越过 OWD | audrey GET showcase_private_note / showcase_inquiry | 看到全部(含他人) |
| F2 | VAMA 只读不带写 | audrey PATCH 任一 private_note | 403(无 allowEdit) |
| F3 | modifyAllRecords 修他人记录 | oskar PATCH 他人 announcement | 200(对照 C4) |
| F4 | 深度 vs VAMA 语义差 | audrey GET showcase_invoice(viewAll) vs ada(RLS 属主) | audrey 全量;ada 只见自己的 |

## G. RLS 硬边界(§2 ④:只收窄)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| G1 | RLS 收窄 public 基线 | ada GET showcase_task(OWD public_read_write + RLS assignee==me) | 只见 assignee=ada 的任务(种子 10 条中 3 条) |
| G2 | 无 RLS 岗位不受影响 | newbie GET showcase_task | 全量可见(RLS 只挂 contributor 岗位) |
| G3 | 发票属主 RLS | ada GET showcase_invoice | 只见 INV-1001/1002 |
| G4 | 写时 check(ADR-0058 D4) | ada PATCH INV-1001 owner→linus@example.com | 403(post-image 校验 fail-closed) |
| G5 | check 允许合法更新 | ada PATCH INV-1001 status(owner 不变) | 200 |

## H. everyone 基线(§5)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| H1 | 新用户即时生效 | newbie(注册后未配任何岗位)GET showcase_product/announcement | 200(isDefault 集绑到 everyone) |
| H2 | 无回退悬崖 | ada(已有显式授予)读 product(仅基线授予) | 200(基线叠加,不因显式授予丢失) |
| H3 | 锚点高危拦截 | admin 尝试 sys_position_permission_set 绑 showcase_auditor→everyone 岗位 | 被拒(anchor gate:VAMA 禁绑 everyone) |

## I. guest 匿名(§5/§9)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| I1 | 匿名数据 API 拒绝 | 不带凭证 GET /api/v1/data/showcase_announcement | 401 unauthenticated |
| I2 | 公共表单通道 | 匿名 POST /api/v1/data/forms/<inquiry表单slug>/submit | 200,询价单创建成功(guest_portal 授权) |
| I3 | 锚点门:guest 禁高危 | admin 尝试绑 showcase_ops(systemPermissions)→guest | 被拒 |

## J. 委托管理(§10,ADR-0090 D12)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| J1 | 子树内+白名单 → 允许 | dana POST sys_user_position {user: wes, position: contributor, business_unit_id: bu_west_coast} | 200,granted_by 自动=dana |
| J2 | 白名单外权限集 → 拒绝 | dana 给 wes 指派 auditor 岗位(其集不在 allowlist) | 403 |
| J3 | 子树外锚定 → 拒绝 | dana 指派 anchor=bu_hq_finance | 403 |
| J4 | 无锚定指派 → 拒绝 | dana POST 不带 business_unit_id | 403(必须锚定在子树内) |
| J5 | 纯 CRUD 无 scope → 拒绝 | (对照)给某用户 RBAC 表 CRUD 但无 adminScope,尝试指派 | 403 |
| J6 | 管理员对照 | admin 做同样指派 | 200 |

## K. explain 引擎(§2/§6)

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| K1 | 自解释 | ada GET /api/v1/security/explain?object=showcase_task&operation=read | 逐层输出:哪个集/岗位/OWD/RLS 参与决策 |
| K2 | 越权他人解释 | ada explain?userId=<admin> | 403;admin 查 ada → 200 |

## L. UI 实测(console,截图留证)

| # | 用例 | 预期(截图) |
|---|---|---|
| L1 | ada 登录 → 任务列表 | 只显示自己 3 条任务(RLS) |
| L2 | ada → 发票列表 | 只显示 INV-1001/1002(RLS+controlled_by_parent) |
| L3 | audrey 登录 → 询价/私密笔记 | 全量可见(VAMA) |
| L4 | newbie 登录 → 询价列表 | 空(private OWD) |
| L5 | ada 编辑项目 → budget 字段 | 不可编辑(FLS editable:false) |

## M. 范围外(设计文档标注 planned / 企业版,不在本轮)

- 外部受众 `externalSharingModel` 运行时分支(#2696 planned,当前无请求按 external 评估)。
- agent 主体交集规则(需 MCP OAuth 通道;运行时已实施,showcase REST 无法直接构造)。
- 层级深度 `own_and_reports/unit/unit_and_below`(企业版 hierarchy-security;开放版 fail-closed)。
- 到期授权/职责分离/环境晋升(文档 §10 明确"planned")。
- Access-matrix 快照门(已由 `os compile` 与仓库 CI 覆盖,见 access-matrix.json)。
