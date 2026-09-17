# ADR-0136: 应用能力 × 验证,加开发者路径,作为优先级锚 — declared capabilities with their runners, and the ≤6-row developer path

**Status**: Proposed (2026-09-16;v2 rework 2026-09-16;v3 rework 2026-09-17) — awaiting the maintainer's hand-merge,
which is the acceptance act for a governed surface (Prime Directive #14). 本记录是维护者的**优先级法**:两张表都是
维护者的胃口,评审时**按删除与替换编辑**;席位只能带着 runner 提新行,⛔ 不能自行加行。
**Deciders**: ObjectStack maintainer, 2026-09-16, on the direct channel, verbatim and untranslated:
「我觉得一个创业项目核心应该放在怎么解决实际业务需求上,你再帮我综合评估我们最近的开发还有哪些跑偏了」·
「我们是一个开发平台,也是创业项目,用的人少,你也不会知道『谁今天撞上』」·「路的清单 是否建议重新讨论,专门立文档」—
reply to the ADR proposal: 「立」. Filed as [#18477](https://github.com/objectstack-ai/objectstack/issues/18477).
v1→v2 rework ruling, review 5224841038 on [#18480](https://github.com/objectstack-ai/objectstack/pull/18480), verbatim
and untranslated: 「这是云服务的旅程，不是本应用开发平台的旅程。本平台的目的是不能让第三方开发者能进入我们的元数据协议快速地开发迭代企业管理应用。」
(the director seat reads 「不能让」 as 「能让」 from context; the direction is the same either way: **锚是第三方开发者进入元数据
协议、快速开发并迭代企业管理应用**。)
v2→v3 rework ruling, 2026-09-17, direct channel, verbatim and untranslated:
「#18480(路的清单)有很大问题啊,基于元数据开发的应用到底能实现那些功能,开发好的应用是否要测试验证,这些需要进清单吗」→
「这个清单的目的到底是什么」→ on the director seat's three options: 「A(建议):」. Ruling A recorded on
[#18480 comment 5710656572](https://github.com/objectstack-ai/objectstack/pull/18480#issuecomment-5710656572):
主表重塑成**应用能力 × 验证**(每行一个能力区,行数上限按能力区,⛔ 不再硬卡十行),开发者路径缩成 ≤6 行的副表,
并加一条「做好的应用必须过验证才算做好」的规则(D2.4)。
**Supersedes**: [PRIORITIZATION.md](./PRIORITIZATION.md) as the priority anchor — 那是一份 2026-06 的 ADR 状态复核,
2026-07-16 自标 STALE;它保留自己的方法与 status-hygiene 规则,不再回答「先做什么」。
**Sources**: 全部取自 `origin/main` 上已有文件与已有卡片,⛔ 无一行发明 — objectstack `docs/qa/platform-checklist/`
(`areas/*.json` 15 区 264 项、`coverage.json` 37 个 kind、`README.md`、`RUNNER.md`、`runs/README.md`、
`scripts/checklist-select.mjs`)、`content/docs/getting-started/`、`skills/objectstack-*`、`packages/create-objectstack`、
`packages/cli`、`packages/verify`、`packages/mcp` 的 README;hotcrm `docs/requirements/` 与 `.github/tasks/new-feature.md`
(参考第三方应用);cloud `scripts/dev-local/MAGIC-FLOW-TEST-RUNBOOK.md` §7 只作「AI 从提示词建应用」这一步的 runner。
各源行数与归并见 Consequences。
**Enforcement**: 四条裁决落进 PM 协议(`SKILL.md` 分诊行)是接受后另立的 skills-lane 卡;⛔ 本记录不改任何 `SKILL.md`。

---

## Context

**本记录的目的,一句话。** 它是 PM 舰队排「**先修什么**」的锚,⛔ 不是产品能力规格,也不是测试计划;能力与验证的账本是
`docs/qa/platform-checklist/`(264 项 / 15 区,每项带 oracle 与 runner),本表**从它取行**,并把每一行折算成一个优先级刻度。

- PM 协议的分诊第一问是「违背了哪条契约」。用的人少,没有 pull 读数,「谁今天撞上」不可知;于是契约扫描
  自我喂养:四仓自 09-02 起 1,166 次合并,fix 36% · process/gates 30% · docs 16% · **feature 8%** · tests 6%
  (director 读数,2026-09-16,#18477)。objectstack 30 天 86 个 `feat` 合并,多数是契约声明、tombstone、
  拒收与门禁;用户可见能力以十计。
- 同期 cloud 六个 P0(三处凭据泄露、生产注册 22 天不通、控制面 26 天不可发布、一次 15 h 故障)停在等待态;
  hotcrm 唯一一条客户需求线(REQ-0006)被代码体量 ratchet 挡住。队列:spec 88 · devx 57 对 engine 9 ·
  services 1 · cli 3。
- 本仓是**应用开发平台**:它的用户是第三方开发者,做出来的东西是**一个企业管理应用**。所以锚有两半——
  **做出来的应用能干什么**(主表,按能力区),与**开发者怎么把它做出来**(副表,≤6 行)。
  云服务(注册、控制面、托管租户)是另一条产品线,有自己的路,见「未入选」。
- 主表的每一行都要能**变红**:没有 runner 的能力行读 `none yet`,喂不了队列(D2.3)。这是有意的缺口清单。

## Decision

### D1 主表 — 应用能力 × 验证(按能力区;维护者按删除与替换编辑)

列:`#` · **应用里能做什么**(终端客户视角:做出来的应用干什么)· **声明它的元数据**(哪些 metadata kind /
`skills/objectstack-*` 指南声明它;kind 取自 `coverage.json` 的 `metadataKinds`,一个 kind 可出现在多行 —— 本列是对
该 map 的**读取**,⛔ 不是对它的划分)· **怎么验证**(该区的 checklist 项数 / P0 数 / P0 项 id,具名 runner,
以及按 `RUNNER.md` 仍属手动的部分)· **最近读数**(🟢/🔴/`unknown` + 日期 + run 链接)· **来源**。
读数是 **2026-09-17** 取下的快照,不是活数据。行数上限**按能力区**,⛔ 不硬卡十行。

主表三个反复出现的 runner 家族,先在此定义,行内只引名字:

- **DG** = objectstack `Dogfood Regression Gate`(`packages/qa/dogfood/test/*.dogfood.test.ts`,3 shard + `Dogfood Verify CLI`)。
  读数:🟢 2026-09-17,objectstack `main@e0d05538`,CI run
  [35192708788](https://github.com/objectstack-ai/objectstack/actions/runs/35192708788)(scheduled,07:04Z)。
- **TC** = 同一次运行里的 `Test Core`(6 shard,承载全部 `unit` 类 runner)。
  读数:🔴 2026-09-17,同一 `main@e0d05538` 同一次运行,shard 2/6 失败(`packages/lint` 的 `pnpm run test` exit 1);
  其余 5 shard success。**逐项读数未取** —— 引 TC 的行因此写 `unknown`,⛔ 不写 🟢。
- **LE** = objectui `live-e2e.yml`(`e2e/live/*.spec.ts`、`apps/console/**`、`packages/app-shell/**` 的单测在 objectui `ci.yml`)。
  读数:🟢 2026-09-17,objectui `main@e896c389`,run
  [35191544195](https://github.com/objectstack-ai/objectui/actions/runs/35191544195)(nightly);`ci.yml` #18088 同 sha success。
  ⚠️ 这是 objectui **main** 的读数,不是本仓 `.objectui-sha` 所 pin 的 `53ded82b` 的读数 —— 渲染半边的 pin 与被测 sha 不同。

| # | 应用里能做什么 | 声明它的元数据 | 怎么验证 | 最近读数 | 来源 |
|---|---|---|---|---|---|
| C1 | 建业务对象并对记录增删改查:新建/查看/改/删一条客户、商机、工单,字段落库;级联删除与唯一约束按声明生效;导入一批历史数据并能撤销;启动即有种子数据与可登录的管理员 | `object` · `field` · `hook` · `validation` · `mapping` · `seed` · `crud_endpoints`;`skills/objectstack-data`(objects/fields/relationships/hooks/lifecycle)· `skills/objectstack-query` | **26 项 / P0 3**(`records-forms.crud-roundtrip` · `platform-core.boot-health` · `platform-core.seed-integrity`)。runner:DG(`package-first-authoring` · `meta-types-create-seed` · `field-zoo-roundtrip`)· TC(`packages/objectql` 的 cascade-delete / lookup-referential-integrity / autonumber、driver 唯一约束)· LE(`e2e/live/master-detail` · `record-history-display` · import-console)。**三个 P0 全手动**:`crud-roundtrip` 是 browser,`boot-health`/`seed-integrity` 无 automated 字段 | DG 🟢 2026-09-17 · TC `unknown`(见上) · LE 🟢 2026-09-17 · 三个 P0 手动项 `unknown`(手动 run record 只落 `qa-run` issue) | `areas/records-forms.json`(14 项)· `platform-core.json`(9 项)· `cli.json`(migrate 3 项)· `coverage.json` |
| C2 | 看数据的每一种方式:列表 / 看板 / 日历 / 甘特 / 详情页,筛选、排序、分组、保存视图、列个性化,导航里出现自己的应用,全局 `$search` 跨字段找记录 | `view` · `app` · `page` · `object` · `report` · `dashboard`;`skills/objectstack-ui`(Views/Apps/Pages)· `skills/objectstack-query`(`$search`、分页) | **29 项 / P0 2**(`platform-core.nav-surfaces-render` · `platform-core.builtin-apps-nav-render`)。runner:LE(`e2e/live/saved-view-filter` · `user-filters` · `detail-related-list` · `list-row-action-cel`,Gantt/Calendar 单测)· `examples/app-showcase/e2e/showcase-smoke.spec.ts`(`showcase-smoke.yml`)· DG(`showcase-search.dogfood.test.ts`,search 7 项里的 2 项)。**search 5/7 手动**(RLS 双人格、拼音、新鲜度、控制台全局搜索、命令面板) | LE 🟢 2026-09-17 · `showcase-smoke.yml` 🟢 2026-09-16 run [35068205283](https://github.com/objectstack-ai/objectstack/actions/runs/35068205283);2026-09-17 的 #91 读取时 `in_progress` · DG 🟢 2026-09-17 | `areas/records-forms.json`(10 项)· `search.json`(7 项)· `platform-core.json`(12 项) |
| C3 | 表单能用:字段类型齐全(文本/数字/日期/选项/查找/主从/公式/加密)、条件显隐与只读、级联选项、校验规则响亮拒绝、公式字段算得对、记录页上的按钮能带参数弹窗 | `field` · `validation` · `action` · `api`;`skills/objectstack-data`(字段与校验)· `skills/objectstack-formula`(CEL:公式字段、`visibleWhen`/`readonlyWhen`/`requiredWhen`、校验谓词)· `skills/objectstack-ui`(Actions) | **18 项 / P0 0**。runner:DG(`field-zoo-roundtrip` · `action-params-contract`)· TC(`rule-validator.option-visibility` · `secret-fields` · 公式 stdlib)· LE(`e2e/live/field-conditional-rules` · `grid-conditional-rules` · `cascading-options` · `required-when-submit` · `form-view-subforms`)· build 门禁 `api-backend.formula-gates` / `enforce-or-remove-authoring-gates` / `retired-def-refusal` | DG 🟢 2026-09-17 · LE 🟢 2026-09-17 · TC `unknown` · build 门禁行 `unknown`(未逐项取读数) | `areas/records-forms.json`(14 项)· `api-backend.json`(4 项) |
| C4 | 权限真的挡得住:角色与权限集、对象级 CRUD、行级安全(私有 / 只读 / 组织默认)、字段级掩码、写路径守卫、匿名拒绝、无激活组织时的语义 | `permission` · `sharing_rule` · `position` · `capability` · `flow` · `hook` · `validation` · `app`;`skills/objectstack-data`(permissions / RLS / FLS) | **27 项 / P0 6**(`rls-both-sides` · `write-path-guards` · `crud-permission-matrix` · `owd-sharing-matrix` · `anonymous-deny-surfaces` · `no-active-org-session-semantics`)。**六个 P0 全部有 automated runner** —— 本表覆盖最实的一行。runner:`objectstack verify --rls`(`packages/verify/src/verify.ts` + `rls.ts`)· DG(`showcase-crud-persona-matrix` 100 格 · `showcase-private-owd` · `showcase-fls-read-mask-strip` · `owner-anchor-and-bulk-writes` · `showcase-anonymous-deny-surfaces` · `showcase-scope-depth*`)· TC(`plugin-security` 的 packaged-permission-set-lock / no-active-organization-write-refusal)。27 项里 15 项有 runner | DG 🟢 2026-09-17 · `Dogfood Verify CLI` 🟢 同一次运行 · TC `unknown` · `no-active-org-session-semantics` 记为 `blocked(fixture, #9334)`,读数 `unknown` | `areas/access-security.json`(27 项) |
| C5 | 审批走得完:提交审批 → 会签(每组各一票)/ quorum(N 中取 M)→ 收件箱里批 / 驳回 → 记录状态随之翻转;非管理员能从账户应用进收件箱;邮件里的动作令牌有门 | `flow` · `api` · `field` · `position`;`skills/objectstack-automation`(审批链、状态机) | **18 项 / P0 1**(`approvals.account-app-entry`,**手动**,browser)。runner:仅 **2/18** 有 automated —— `status-mirror-cascade.integration.test.ts`(状态镜像级联)与 `resume-authority-gate.test.ts`(恢复权限门),都在 TC 里。`quorum-m-of-n` 与 `sla-escalation` 记为 `blocked(fixture)`(#3358 / 需时钟控制夹具) | TC `unknown`(聚合红) · 16/18 手动 → `unknown`。**本区是覆盖最薄的能力行之一** | `areas/approvals.json`(18 项) |
| C6 | 自动化真的触发:记录保存触发流程、定时触发、屏幕流、汇总字段(roll-up)自动重算、打包流程停用后不再跑、流程可持久挂起再恢复 | `flow` · `action`;`skills/objectstack-automation`(Flow / Trigger / `defineJob` / `defineWebhook`)· `skills/objectstack-formula`(流程条件) | **16 项 / P0 1**(`automation.packaged-flow-disable-durable`,**手动**)。runner:5/16 —— DG(`flow-durable-suspend` · `flow-node` · `flow-trigger-conformance`)· LE(`e2e/live/screen-flow`)· TC(`setup-packaged-automation-nav` · objectui `PackagedAutomationPage`) | DG 🟢 2026-09-17 · LE 🟢 2026-09-17 · P0 手动项 `unknown` | `areas/automation.json`(16 项) |
| C7 | 看得到经营数字:仪表盘里的图表出数、报表按维度分组与聚合、日期分桶跨驱动一致、数据集可复用 | `dashboard` · `report` · `dataset`;`skills/objectstack-ui`(Dashboards / Reports / Charts) | **11 项 / P0 0**。runner:3/11 —— DG(`dashboard-designer-roundtrip`)· `date-bucket-parity-conformance.test.ts`(跨驱动日期分桶)· TC(`plugin-reports` 的 `report-service.test.ts`)· LE 一条 e2e | DG 🟢 2026-09-17 · LE 🟢 2026-09-17 · TC `unknown` · 8/11 手动 → `unknown` | `areas/dashboards.json`(11 项) |
| C8 | 人能登进来:邮箱密码登录、SSO / OIDC 授权码流、社交账号关联、手机号与验证码、邀请与委派管理员、凭据生命周期、登录后进控制台看到自己的应用 | `position` · `email_template` · `app`;`skills/objectstack-api`(auth providers)· `skills/objectstack-platform`(运行时配置) | **23 项 / P0 1**(`platform-core.console-login`,**手动**,browser)。runner:3/22 identity-auth 项有 automated —— DG(`oidc-authorization-code-flow` · `admin-credential-lifecycle` · `admin-identity-audit-trail` · `admin-platform-admin-standing` · `admin-route-nonadmin-refusal` · `delegated-admin-invite`)。`linked-accounts-social` 记为 `blocked(fixture)`(无现成社交 IdP) | DG 🟢 2026-09-17 · `console-login` P0 手动 → `unknown` | `areas/identity-auth.json`(22 项)· `platform-core.json`(1 项) |
| C9 | 应用有一套可对外的后端:REST CRUD / 批量 / 聚合 / 过滤谓词、声明式自定义端点、错误信封统一、外部数据源与连接器(REST / MCP)、Webhook、定时任务、邮件模板 | `api` · `datasource` · `webhook` · `job` · `object` · `query` · `batch_endpoints` · `crud_endpoints` · `metadata_endpoints` · `route_generation` · `dataset` · `email_template`;`skills/objectstack-api`(endpoints / auth / realtime / batch)· `skills/objectstack-query` · `skills/objectstack-data`(外部 / 联邦数据源) | **38 项 / P0 3**(`api-backend.query-contract-matrix` · `api-backend.packaged-action-disabled-dispatch` · `integration-system.datasource-credential-refusal-matrix`;前两个有 runner,第三个**手动**)。runner:18/38 —— DG(`showcase-declarative-endpoints` · `showcase-declarative-mcp` · `webhook-materialization` · `email-template-materialization` · `packaged-activation-ledger-reach`)· TC(`packages/rest` 的 batch-size-cap / mount-table pin / sub-config-parse、`packages/objectql` engine、connector-rest / connector-mcp、external-validation) | DG 🟢 2026-09-17 · TC `unknown` · `datasource-credential-refusal-matrix` P0 手动 → `unknown` | `areas/api-backend.json`(19 项)· `integration-system.json`(18 项)· `cli.json`(1 项) |
| C10 | 能传文件:记录上传附件(预签名 / 分块)、按签名 URL 下载、附件权限由父记录推导、删除时 `sys_file` 生命周期收尾、公开读 ACL 有门 | `field`(file 类型);`skills/objectstack-data`(字段类型) | **10 项 / P0 0**。runner:**9/9 attachments 项全部有 automated** —— DG(`attachments-permission-matrix` · `attachments-parent-rls-count-parity` · `attachments-parent-rls-scan-cap` · `attachments-public-read-acl` · `attachments-unscoped-delete-gate`)· TC(`service-storage` 的 `attachment-access-hooks` · `file-reference-lifecycle`)· LE(`e2e/live/grid-file-upload`)。第 10 项 `records-forms.upload-guard-blocks-confirm` 手动 | DG 🟢 2026-09-17 · LE 🟢 2026-09-17 · TC `unknown` | `areas/attachments-storage.json`(9 项)· `records-forms.json`(1 项) |
| C11 | 应用会说客户的语言:对象 / 字段标签、视图文案、导航、自动化通知按 locale 出;缺翻译按 fallback 链回落;错拼的翻译 key 被拒 | `translation`;`skills/objectstack-i18n`(`*.translation.ts`、locale fallback、coverage) | **5 项 / P0 0**。runner:**`none yet` —— 5 项全部手动,本区零 automated**。构建期另有 `pnpm check:i18n` / `check:i18n-coverage`(九个包的 bundle 与未翻译标签棘轮),但清单未把它们绑到任一项上 | `none yet` → 全区 `unknown`。**这是主表里唯一一个整区无 runner 的能力行**(D2.3:变不了红就喂不了队列) | `areas/i18n.json`(5 项) |
| C12 | 应用带 AI:声明 agent / tool / skill 元数据并在运行时兑现,MCP 面把对象与动作暴露给外部 AI 客户端,开放版对未实现的 `/ai/**` 诚实返回 501 而不是假装 | `agent` · `tool` · `skill` · `action` · `capability`;`skills/objectstack-ai`(skills / tools / knowledge / MCP 面) | **8 项 / P0 1**(`ai.mcp-stdio-fail-closed`,**有 runner**)。runner:4/8 —— DG(`showcase-mcp-http-identity`)· TC(`packages/mcp` 的 `plugin.test.ts` · `skill-prompts.test.ts` · `mcp-validate-expression.test.ts`)。⚠️ 边界:产品内 agent 运行时(`@objectstack/service-ai`)是 Cloud/EE,住 cloud 仓;本区只断言开放框架真正跑的东西(`ai.json` `$comment`) | DG 🟢 2026-09-17 · TC `unknown` · 4/8 手动 → `unknown` | `areas/ai.json`(8 项) |
| C13 | 不写代码也能改应用:在**运行中的**应用里建 package → object → 记录 → app → publish,终端用户随即看到;草稿不外泄、publish 原子翻转;对象设计器 / 记录页设计器 / 权限矩阵编辑器 / CEL 表达式编辑器可用 | `object` · `view` · `page` · `dashboard` · `flow`(经 Studio 写入,`allowOrgOverride` 决定哪些可覆盖);`skills/objectstack-platform` · `skills/objectstack-ui` | **15 项 / P0 1**(`studio-authoring.first-run-loop`,**手动**,这一行的整条首跑闭环没有 runner)。runner:7/15 —— DG(`dashboard-designer-roundtrip`,draft→publish 腿)· LE(`e2e/live/studio-object-designer` · `studio-record-page`)· TC(`overlay-precedence` · objectui 的 `celAuthoring` / `PermissionMatrixEditor`) | DG 🟢 2026-09-17 · LE 🟢 2026-09-17 · TC `unknown` · **P0 `first-run-loop` `unknown`** | `areas/studio-authoring.json`(15 项) |

### D1 副表 — 开发者路径(≤6 行,P1…P6;维护者同样按删除与替换编辑)

列:`#` · **这一步做什么** · **runner** · **最近读数** · **来源**。v2 的 J1–J9 折进这六行;v2 的 J10(终端用户作为证明)
不再是行,它成了 **D2.4** 的规则。

| # | 这一步做什么 | runner | 最近读数 | 来源 |
|---|---|---|---|---|
| P1 | **进入。** 读 getting-started(`how-ai-development-works` → `build-with-claude-code` → `your-first-project`)→ `npm create objectstack@latest my-app` → 10 个 `skills/objectstack-*` 随脚手架装入 → `os validate` / `os build` / 启动 → `/api/v1/health` 200 | `cli.scaffold-first-run`(`.github/workflows/scaffold-e2e.yml`,每日)· `cli.scaffold-console-first-paint`(P1,**手动**)· 文档链接可达:`.github/workflows/check-links.yml` | 🟢 2026-09-17 scaffold-e2e #3088 [run](https://github.com/objectstack-ai/objectstack/actions/runs/35178688408) success(`main@a55646b0`)· check-links #9950 success 2026-09-17 —— ⚠️ 该 workflow 只在 `pull_request` 上跑,`main` 上最后一次运行是 2026-08-30 的 `cancelled`;此读数取自一次 PR 运行 · `scaffold-console-first-paint` `unknown` | `content/docs/getting-started/meta.json`(8 页)· `skills/README.md`(10 技能)· `packages/create-objectstack/README.md`(1 模板 `blank`)· `areas/cli.json`(2 项) |
| P2 | **写元数据。** 三条并行的写法:① 手写 —— 在 `src/` 里以类型化元数据写 objects / fields / views / flows / permissions;② AI 辅助 —— Claude Code + 已装技能,或对 build agent 说一句中文提示,写完 Build → Publish → 应用出现、列表有行、仪表盘出数;③ Studio 零代码 —— 见 C13。每一种元数据都要在运行时**兑现**,而不是声明了却不生效 | 手写腿:DG(`package-first-authoring` · `field-zoo-roundtrip`)· 覆盖棘轮 `coverage.json`(`pnpm check:platform-checklist`,手动节奏,由 `platform-checklist-watchdog.yml` 每日在 `main` 上跑)。AI 腿:cloud `golden-journey.yml`(nightly)+ `verify-magic-flow.mjs --v1`(runbook §7 的 Build / Publish / Dashboard / Iterate add-table);自动化四行手动(runbook §7,v1 面之外,cloud ADR-0112);平台侧 `ai.skill-instructions-mcp-prompts`(`packages/mcp/src/skill-prompts.test.ts`)· `ai.mcp-http-surface`(`showcase-mcp-http-identity.dogfood.test.ts`) | 手写腿 DG 🟢 2026-09-17 · watchdog #14 🟢 2026-09-17 [run](https://github.com/objectstack-ai/objectstack/actions/runs/35176243573)(`main@879b5127`,清单结构与覆盖棘轮双绿)· AI 腿 🟢 2026-09-16 cloud golden-journey #18 [run](https://github.com/objectstack-ai/cloud/actions/runs/35135196616) success(#14 于 09-12 失败;2026-09-17 的一次在 18:3xZ 之后才跑,读取时未出)· 自动化四行 🟢 2026-08-01(runbook 自述,time-relative) | `skills/README.md` · `content/docs/getting-started/build-with-claude-code.mdx` · `packages/mcp/README.md` · `areas/platform-core.json` · `ai.json` · cloud `MAGIC-FLOW-TEST-RUNBOOK.md` §7 |
| P3 | **本地跑与看。** `os dev` → 健康、种子 admin 可登录、端口与陈旧提示诚实、自动迁移策略正确 → 控制台(objectui 渲染半边,`.objectui-sha` pin)里看到自己的导航、列表、表单;`os doctor` 报告健康与弃用 | `cli.dev-boot-contract`(P0,**手动**)· `cli.dev-automigrate-policy` / `doctor-health-report` / `doctor-deprecation-scan` / `flag-command-error-ux`(**手动**)· `platform-core.nav-surfaces-render` → `showcase-smoke.spec.ts`(`showcase-smoke.yml`)· LE(控制台渲染半边) | `showcase-smoke.yml` 🟢 2026-09-16 #90;2026-09-17 的 #91 读取时 `in_progress` · LE 🟢 2026-09-17(objectui `main@e896c389`,⚠️ 非 pin 的 `53ded82b`)· **cli 五项全手动 → `unknown`**,含 P0 `dev-boot-contract` | `packages/cli/README.md`(`os dev`)· `areas/cli.json`(5 项)· `platform-core.json` |
| P4 | **验证。** `os validate` / `os lint` / `objectstack verify`(`pnpm verify`)→ 错拼与已退役键被**响亮拒收**并附处方,不会静默落库;字段回环与跨 owner RLS 在真实 HTTP 栈上证明;退出码按裁决分档 → 判据见 **D2.4** | `cli.verify-verdict-exit-mapping`(`packages/cli/src/commands/verify-tenancy-posture.test.ts`,TC)· `cli.build-own-contract` / `qa-suite-execution` / `lint-severity-exit-contract` / `hook-body-extraction-gates`(**手动**)· `objectstack verify --rls`(`packages/verify/src/verify.ts` + `rls.ts`)· 参考应用:hotcrm `pnpm verify` 在 `ci.yml` | `Dogfood Verify CLI` 🟢 2026-09-17(DG 同一次运行)· hotcrm ci #3054 🟢 2026-09-16 [run](https://github.com/objectstack-ai/hotcrm/actions/runs/35080428154)(`main@087b7c5d`;hotcrm main 读取时仍是该 sha)· TC `unknown` · 四项手动 `unknown` | `packages/verify/README.md` · `packages/cli/README.md`(Quality)· `content/docs/deployment/validating-metadata.mdx` · `areas/cli.json`(5 项) |
| P5 | **发布与安装。** `os compile` → `dist/objectstack.json` → `os package publish`(或 hotcrm `scripts/publish-marketplace.mjs`)→ 版本出现在市场 → 装进一个环境(在线市场或离线 inline)→ 导航出现应用、记录可读写;`engines` 不兼容在安装边界被拒;启停包与激活台账有行 | hotcrm `.github/workflows/publish-staging.yml` / `publish-production.yml`(`workflow_dispatch`)· `platform-core.marketplace-install-local-lifecycle` / `manifest-install-contract` / `package-lifecycle-enable-disable` / `marketplace-console-honesty` / `activation-ledger-*`(**多为手动**;`activation-ledger-registration-home` 与 `packaged-activation-ledger-reach` 在 DG 里)· `cli.plugin-manifest-build-contract`(P2,**手动**) | 🟢 2026-09-14 hotcrm publish-staging #11 [run](https://github.com/objectstack-ai/hotcrm/actions/runs/34822081894) · publish-production #5 [run](https://github.com/objectstack-ai/hotcrm/actions/runs/34825367111) success(两次都在 hotcrm `main@590b095e`;此后未再发布)· DG 🟢 2026-09-17 · 安装侧手动项 `unknown` | `packages/cli/README.md`(Cloud — publish & install)· hotcrm `scripts/publish-marketplace.mjs` · `areas/platform-core.json`(7 项)· `cli.json`(1 项) |
| P6 | **迭代客户需求。** 客户原话进 `docs/requirements/NNNN` → 分诊 A/B/C/D → 按 `.github/tasks/new-feature.md` 写元数据到 `src/` 或 overlay → `pnpm verify` + changeset → 发版 → 客户在 CRM 里看到字段 / 审批 | **`none yet`** —— hotcrm `ci.yml` + `e2e.yml` 证明迭代后应用仍能启动、hook 仍触发,**不证明某条 REQ 已落地**;把某条 REQ 的验收折成 checklist 选定项 + 一条 run record,正是 D2.4 要的东西 | 🔴 **2026-09-17 重取**(hotcrm `main@087b7c5d`,自 2026-09-16 未移动):六条 REQ 全部 `Status: Triaged`,无一条越过;REQ-0002 的 Traceability 仍是「changesets / PRs — to be filled in per phase」,REQ-0003–0006 仍是「changeset / PR — to be filled in when built」,REQ-0001 是示例(「not yet built」)。**在途但未落地**:hotcrm PR [#1950](https://github.com/objectstack-ai/hotcrm/pull/1950)(draft,REQ-0006),其 ci #3055 **failure** / e2e #1273 success。应用本身 🟢 2026-09-16 ci #3054 / e2e #1272 | hotcrm `docs/requirements/README.md` + REQ-0001–0006 · `.github/tasks/new-feature.md` |

objectui 是开发者应用的**渲染半边**(`.objectui-sha` pin),住在 C2 / C3 / C13 与 P3 里,不单独成行。

### 区 → 行 归属(15 / 15,264 项全部有去处)

清单的 15 个区没有一个被丢下。一个区可以拆进多行(`records-forms` 39 项就横跨四行),但**每一项只落一行**;
下表的项数之和 = 264。计数取自本分支合并 `origin/main` 后的树(2026-09-17 重数,见 Consequences「源与归并」)。

| 区(`areas/*.json`) | 项数 | 落到哪些行 |
|---|---|---|
| `access-security` | 27 | C4 × 27 |
| `ai` | 8 | C12 × 8 |
| `api-backend` | 23 | C3 × 4(公式与编写期门禁)· C9 × 19 |
| `approvals` | 18 | C5 × 18 |
| `attachments-storage` | 9 | C10 × 9 |
| `automation` | 16 | C6 × 16 |
| `cli` | 17 | C1 × 3(`migrate-*`)· C9 × 1(`datasource-introspect-codegen`)· P1 × 2 · P3 × 5 · P4 × 5 · P5 × 1 |
| `dashboards` | 11 | C7 × 11 |
| `i18n` | 5 | C11 × 5 |
| `identity-auth` | 22 | C8 × 22 |
| `integration-system` | 18 | C9 × 18 |
| `platform-core` | 29 | C1 × 9(boot / seed / 元数据管线)· C2 × 12(控制台外壳与导航)· C8 × 1(`console-login`)· P5 × 7(包生命周期与市场安装) |
| `records-forms` | 39 | C1 × 14 · C2 × 10 · C3 × 14 · C10 × 1(`upload-guard-blocks-confirm`) |
| `search` | 7 | C2 × 7 |
| `studio-authoring` | 15 | C13 × 15 |
| **合计** | **264** | 主表 244 · 副表 20 |

两个被明令拆开的区,它们的 P0 去了哪里:

- `platform-core` 五个 P0 —— `boot-health` → **C1** · `seed-integrity` → **C1** · `nav-surfaces-render` → **C2** ·
  `builtin-apps-nav-render` → **C2** · `console-login` → **C8**。包生命周期与市场安装那一支(7 项,含
  `manifest-install-contract`、`marketplace-install-local-lifecycle`)不含 P0,整支去 **P5**。
- `cli` 唯一的 P0 `dev-boot-contract` → **P3**(`os dev`)。其余按命令归位:脚手架 → P1,`os doctor` 与 dev 策略 → P3,
  `verify` / `lint` / `qa` / `build` → P4,`plugin-manifest-build-contract` → P5,`migrate-*` 三项 → **C1**
  (它们改的是数据结构,属能力面而非路径面),`datasource-introspect-codegen` → **C9**。

**未入选 — cloud 服务自己的清单**(v1 收过、v2 移出、v3 原样保留;cloud 仓可按同一形状自立一张清单,本表不锚定它们):

- 新用户注册 → 建组织 → 自带环境:[cloud#1653](https://github.com/objectstack-ai/cloud/issues/1653)(🔴 P0 open,
  2026-09-16);runner cloud `scripts/dev-local/LOCAL-E2E-CHECKLIST.md` A2–A3。
- 控制面发布速度(首页 ≤2.5 s、DB 请求 ≤200 ms):[cloud#1521](https://github.com/objectstack-ai/cloud/issues/1521)
  (🔴,待 prod 人工重测);无脚本。
- 托管 HotCRM:cloud 登录直通、按组织建空间、租户隔离:cloud ADR-0111 R1.1–3.4;runner cloud
  `scripts/dev-local/verify-hotcrm-saas.mjs`(🟢 2026-08-16 rig,3 项 pinned 发现)。
- 运营者按组织启停 Service、托管实例的爆炸半径:cloud ADR-0111 R4、R6.1;无 runner。
- 计费姿态:cloud ADR-0111 D1 留的挂点,MVP 免费、未建;无 runner。
- 云端审核并副签一个发布的包(发布飞轮的云端半边):cloud `LOCAL-E2E-CHECKLIST.md` D5–D6;开发者半边住 P5。

**未入选 — 平台侧:v3 清空,两行都进了主表。** v2 把两行按「终端用户面 / 并入别行」放在未入选里;主表改成按能力区之后
它们各自有了归宿,⛔ 不再是未入选:

- `approvals.account-app-entry`(P0,手动,非管理员从账户应用进审批收件箱)→ **C5**,并且是 C5 唯一的 P0。
- `studio-authoring.custom-page-render-and-blocks` · `custom-page-source-tiers`(声明式自定义页的块组合与页源分层)
  → **C13**,随 `studio-authoring` 整区入表。

### D2 — 四条裁决(PM 协议引用的规则)

1. **两张表锚定优先级。** 每张分诊过的卡带一行 `Journey:`,值是**本表行号**:`C<n>`(能力行)/ `P<n>`(路径行)/ `none`。
   顶带恒定:**安全与数据完整性从不等旅程,永远最高一带。** 其下:**一条能力行或一条路径行断了或被挡** ⇒ P0/P1;
   能力/路径能跑但在它经过的路径上产出错误结果(含 AI 写的应用被平台静默吞掉)⇒ P2;
   不在任何已声明行上 ⇒ 默认 p3 或 `not_planned` — declared-but-unenforced 的键按发布批量退役,⛔ 不一键一卡。
2. **跨 lane 优先级。** 只要任一产品仓(cloud / hotcrm / objectui 用户可见面)还有未认领的、在表上的 P0/P1,
   任何 lane 都不派发 p2/p3 的契约卫生或工具卡。PM 协议的取卡全序引用这一句。
3. **队列由跑这两张表喂。** runner 按计划执行(既有 `checklist-test` / `dogfood-verification` 技能,以及
   nightly `golden-journey.yml`、每日 `scaffold-e2e.yml`、每日 `platform-checklist-watchdog.yml`、每 PR 的
   `Dogfood Regression Gate`);一行变红立一张带 `Journey:` 行的卡。契约扫描与顺路发现转为背景,对着本表评级。
4. **做好的应用必须过验证才算做好。** 一个建在元数据协议上的应用,只有同时满足下面两条才算「做好」:
   - (a) 它的元数据 kind 所映射到的 checklist 项,在**一条 run record 里通过**。选项用
     `node scripts/checklist-select.mjs <selector>`,选择子是 `<id>` / `area:<a>` / `capability:<kind>` /
     `priority:P0` / `surface:<s>` / `since:vN` / `file:<path>` / `all`;kind → 项的映射住 `coverage.json`
     的 `metadataKinds`(37 个 kind,其中 `realtime_subscription` 一个 WAIVED)。run record 的形状、verdict
     取值与证据要求见 [`RUNNER.md`](../qa/platform-checklist/RUNNER.md)。
   - (b) `objectstack verify`(`packages/verify`)在它上面是绿的。
   - **参考实现是 hotcrm**:`pnpm verify` 跑在它的 `ci.yml` 与 `e2e.yml` 里。
   - **一张交付了面向应用行为、却没有一条通过的 run record 的卡,不算 done。**
   - 今天有多少是手动的,说白了:**264 项里 110 项有 automated runner,154 项手动;20 个 P0 里 10 个手动**
     (`approvals.account-app-entry` · `automation.packaged-flow-disable-durable` · `cli.dev-boot-contract` ·
     `integration-system.datasource-credential-refusal-matrix` · `platform-core.boot-health` ·
     `platform-core.seed-integrity` · `platform-core.console-login` · `platform-core.builtin-apps-nav-render` ·
     `records-forms.crud-roundtrip` · `studio-authoring.first-run-loop`)。手动判决的落点是一张 `qa-run` issue
     (run record 本身 git-ignored、**永不入库**),见 [`runs/README.md`](../qa/platform-checklist/runs/README.md)。
     所以 D2.4 今天是一条**要人执行**的规则,不是一条会自己变红的门禁 —— 把这 10 个 P0 自动化,是本记录直接
     生成的工作面。

### D3 — 取代 PRIORITIZATION.md

本记录取代 [`docs/adr/PRIORITIZATION.md`](./PRIORITIZATION.md) 作为优先级锚;该文件顶部加一行指针,⛔ 不重写。

## Consequences

- **清单即胃口。** 维护者删行、换行;席位提新行必须附 runner。**行数上限按能力区**(v2 的硬十行上限由 v3 裁决取消):
  主表 13 行覆盖 15 个区,副表 6 行(上限)。主表 12 行有 runner,**1 行整区无 runner(C11 多语言,`none yet`)**;
  副表 5 行有 runner,**1 行 `none yet`(P6 迭代客户需求)**。`none yet` 的行变不了红,就喂不了队列(D2.3):
  要么补 runner,要么删行。
- **源与归并。** objectstack `docs/qa/platform-checklist/`:**15 区 · 264 项 · 20 项 P0**(2026-09-17 在本分支合并
  `origin/main` 后重数;v2 的 Consequences 写的 19 是**错的**,`priority === "P0"` 的项是 20 —— 更正记在此处,
  ⛔ 不改清单文件)。**本记录引的是全部 264 项**,按上面的「区 → 行 归属」表分派:主表 244 项、副表 20 项、
  未入选 0 项 —— v2 的「十行引 22 项」是抽样,v3 是全量,这是两版最大的账目差别。其余源:
  `content/docs/getting-started/` 8 页 → P1、P2;`skills/objectstack-*` 10 个技能 → 主表 13 行的「声明它的元数据」
  列与 P1、P2;`packages/create-objectstack/README.md`(1 个模板)→ P1;`packages/cli/README.md` 命令表 → P3、P4、P5;
  `packages/verify/README.md` → C4、P4、D2.4;`packages/mcp/README.md` → C12、P2;`coverage.json` 37 个 kind
  (1 个 WAIVED)→ 主表「声明它的元数据」列与 D2.4(a);`scripts/checklist-select.mjs` 的 8 种选择子 → D2.4(a);
  `RUNNER.md` / `runs/README.md` → D2.4 的 run-record 形状;hotcrm `docs/requirements/` 6 条记录
  (0001 为示例,0002–0006 是同一客户的 Track A)+ `.github/tasks/new-feature.md` + 4 个 workflow → P4、P5、P6;
  cloud runbook §7 的 8 个检查点只作 P2 的 AI 腿 runner。**移出**:v1 的 cloud ADR-0111 17 条验收行、cloud#1521、
  cloud#1653、cloud `LOCAL-E2E-CHECKLIST.md` 的 A / D 段 → 「未入选 — cloud 服务自己的清单」6 行,v3 原样留存。
- **读数会腐烂。** 「最近读数」列是 2026-09-17 写下当天的快照;活数据住 runner 自己的记录(nightly run、
  `qa-run` issue、CI check)。引用本表某行的读数时带日期,过期即重取。本轮取读数时 objectstack `main@e0d05538`
  的 `Test Core` 是**红**的(shard 2/6,`packages/lint`),所以全部依赖 TC 的行只能写 `unknown` —— 这正是
  「读数不是标签」的样子。
- **执行是另一张卡。** D2 四条落进 `SKILL.md` 分诊行与取卡全序,由接受后立的 skills-lane 卡承担
  ([#18489](https://github.com/objectstack-ai/objectstack/issues/18489),接受后按 `C<n>` / `P<n>` / `none`
  三种取值重新划范围);本记录是法,技能编辑是执法。
- **代价。** 锚是维护者替第三方开发者与他们的终端客户做的声明,不是真实拉力;真实开发者到来后,本表按他们
  用到的能力重排。跨 lane 规则(D2.2)会让契约卫生卡在产品仓有 P0/P1 时整批停摆 — 这是有意的。云服务的路不在
  表里,不等于不重要:它们在 cloud 仓自己的清单里排,本表只管开发者平台。
- **锚现在点名能力,于是缺口自己浮出来。** 一个没有 runner 的能力行读 `none yet`,喂不了队列 —— 这不是瑕疵,
  是**给 `checklist-author` 技能的缺口清单**:C11(多语言,5 项全手动、整区零 automated)· C5(审批,18 项里
  只有 2 项有 runner)· C13 的 P0 `studio-authoring.first-run-loop`(整条零代码首跑闭环无 runner)· P6
  (客户需求端到端落地,`none yet`),以及 D2.4 点名的那 10 个手动 P0。它们是本记录直接生成的下一批工作面。
