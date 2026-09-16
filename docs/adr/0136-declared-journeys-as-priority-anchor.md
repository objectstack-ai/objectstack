# ADR-0136: Declared journeys as the priority anchor — 维护者声明的 ≤10 条端到端路径,各带 runner,是分诊的第一问

**Status**: Proposed (2026-09-16) — awaiting the maintainer's hand-merge, which is the acceptance act for a
governed surface (Prime Directive #14). 本记录是维护者的**优先级法**:旅程表是维护者的胃口,评审时**按删除与替换编辑**;
席位只能带着 runner 提新行,⛔ 不能自行加行。Rework 2026-09-16:首稿的表是云服务的旅程,维护者驳回后重写为
**开发者平台**的旅程(裁决见下)。
**Deciders**: ObjectStack maintainer, 2026-09-16, on the direct channel, verbatim and untranslated:
「我觉得一个创业项目核心应该放在怎么解决实际业务需求上,你再帮我综合评估我们最近的开发还有哪些跑偏了」·
「我们是一个开发平台,也是创业项目,用的人少,你也不会知道『谁今天撞上』」·「路的清单 是否建议重新讨论,专门立文档」—
reply to the ADR proposal: 「立」. Filed as [#18477](https://github.com/objectstack-ai/objectstack/issues/18477).
Rework ruling, review 5224841038 on [#18480](https://github.com/objectstack-ai/objectstack/pull/18480), verbatim
and untranslated: 「这是云服务的旅程，不是本应用开发平台的旅程。本平台的目的是不能让第三方开发者能进入我们的元数据协议快速地开发迭代企业管理应用。」
(the director seat reads 「不能让」 as 「能让」 from context; the direction is the same either way: **锚是第三方开发者进入元数据
协议、快速开发并迭代企业管理应用**。)
**Supersedes**: [PRIORITIZATION.md](./PRIORITIZATION.md) as the priority anchor — 那是一份 2026-06 的 ADR 状态复核,
2026-07-16 自标 STALE;它保留自己的方法与 status-hygiene 规则,不再回答「先做什么」。
**Sources**: 全部取自 `origin/main` 上已有文件与已有卡片,⛔ 无一行发明 — objectstack `docs/qa/platform-checklist/`
(`areas/*.json`、`coverage.json`)、`content/docs/getting-started/`、`skills/objectstack-*`、`packages/create-objectstack`、
`packages/cli`、`packages/verify`、`packages/mcp` 的 README;hotcrm `docs/requirements/` 与 `.github/tasks/new-feature.md`
(参考第三方应用);cloud `scripts/dev-local/MAGIC-FLOW-TEST-RUNBOOK.md` §7 只作「AI 从提示词建应用」这一步的 runner。
各源行数与归并见 Consequences。
**Enforcement**: 三条裁决落进 PM 协议(`SKILL.md` 分诊行)是接受后另立的 skills-lane 卡;⛔ 本记录不改任何 `SKILL.md`。

---

## Context

- PM 协议的分诊第一问是「违背了哪条契约」。用的人少,没有 pull 读数,「谁今天撞上」不可知;于是契约扫描
  自我喂养:四仓自 09-02 起 1,166 次合并,fix 36% · process/gates 30% · docs 16% · **feature 8%** · tests 6%
  (director 读数,2026-09-16,#18477)。objectstack 30 天 86 个 `feat` 合并,多数是契约声明、tombstone、
  拒收与门禁;用户可见能力以十计。
- 同期 cloud 六个 P0(三处凭据泄露、生产注册 22 天不通、控制面 26 天不可发布、一次 15 h 故障)停在等待态;
  hotcrm 唯一一条客户需求线(REQ-0006)被代码体量 ratchet 挡住。队列:spec 88 · devx 57 对 engine 9 ·
  services 1 · cli 3。
- 本仓是**应用开发平台**:它的用户是第三方开发者,路是「进入元数据协议 → 快速开发 → 迭代一个企业管理应用」;
  云服务(注册、控制面、托管租户)是另一条产品线,有自己的路。没有用户拉力时,**维护者替开发者声明的端到端路径**
  就是锚。本记录把这条路切成 ≤10 段,每段带一个能变红的 runner,然后规定:卡片先问「在哪一段上」,再问「违背哪条契约」。

## Decision

### D1 — 旅程表(≤10 行;维护者按删除与替换编辑)

列:谁走 · 入口 → 完成时用户看到什么 · runner(能机械变红的证明;`none yet` = 缺口)· 最近读数(🟢/🔴 + 日期 +
红时的卡号;`unknown` = 无读数)· 来源。读数是 2026-09-16 写下时的快照,不是活数据。主角是**第三方开发者**;
应用的终端用户只在最后一行出现,作为「做出来的应用能用」的证明,不是锚。

| # | 谁走 | 入口 → 完成时用户看到什么 | runner | 最近读数 | 来源 |
|---|---|---|---|---|---|
| J1 | 第三方开发者(首次进入) | 读 getting-started(`how-ai-development-works` → `build-with-claude-code` → `your-first-project`)→ `npm create objectstack@latest my-app` → 10 个 `skills/objectstack-*` 随脚手架装入 → `os validate` / `os build` / 启动 → `/api/v1/health` 200 | `cli.scaffold-first-run`(`.github/workflows/scaffold-e2e.yml`,每日)· 文档链接可达:`.github/workflows/check-links.yml`(每 PR) | 🟢 2026-09-16 scaffold-e2e [run #3082](https://github.com/objectstack-ai/objectstack/actions/runs/35052312706) success;check-links run #9879 success 同日 | `content/docs/getting-started/meta.json`(8 页)· `skills/README.md`(10 技能)· `packages/create-objectstack/README.md`(1 模板 `blank`)· checklist `cli.json` |
| J2 | 第三方开发者(手写元数据) | 在 `src/` 里以类型化元数据写 objects / fields / views / flows / permissions(`*.object.ts`、`*.view.ts`、`*.flow.ts`、access-matrix)→ 每一种元数据在运行时兑现,而不是声明了却不生效 | `platform-core.metadata-authoring-roundtrip`(`packages/qa/dogfood/test/package-first-authoring.dogfood.test.ts`)· `records-forms.field-type-matrix`(`packages/qa/dogfood/test/field-zoo-roundtrip.dogfood.test.ts`)· 每种元数据 kind 的覆盖棘轮 `docs/qa/platform-checklist/coverage.json`(`pnpm check:platform-checklist`,手动节奏) | 🟢 2026-09-16 `Dogfood Regression Gate` success on `main@85c6d76e`;覆盖棘轮 unknown(手动节奏,run record 只落 `qa-run` issue) | checklist `platform-core.json` · `records-forms.json` · `coverage.json`;`skills/objectstack-{data,ui,automation,platform}` |
| J3 | 第三方开发者(AI 辅助) | 用 Claude Code + 已装技能,或对 build agent 说一句中文提示 → AI 写出元数据 → Build → Publish → 应用出现、列表有行、仪表盘出数;再说「加张表」「加个自动化」→ 直接进导航、流程绑定并真的触发 | cloud `scripts/dev-local/golden-journey.mjs`(nightly `golden-journey.yml`)+ `verify-magic-flow.mjs --v1`(runbook §7 行 Build / Publish / Dashboard / Iterate add-table);自动化四行手动(runbook §7,v1 面之外,cloud ADR-0112);平台侧 `ai.skill-instructions-mcp-prompts`(`packages/mcp/src/skill-prompts.test.ts`)· `ai.mcp-http-surface`(`packages/qa/dogfood/test/showcase-mcp-http-identity.dogfood.test.ts`) | 🟢 2026-09-15 nightly [run #17](https://github.com/objectstack-ai/cloud/actions/runs/35008107007) success(#14 于 09-12 失败);自动化腿 🟢 2026-08-01(runbook 自述,time-relative) | `content/docs/getting-started/build-with-claude-code.mdx` · `skills/README.md` · `packages/mcp/README.md` · checklist `ai.json`;runner 取自 cloud `MAGIC-FLOW-TEST-RUNBOOK.md` §7 |
| J4 | 第三方开发者 / 其管理员(Studio 零代码) | 在运行中的应用里零代码:建 package → object → 记录 → app → publish → 终端用户看到;零重启;草稿不外泄、publish 原子翻转 | `studio-authoring.first-run-loop`(P0,手动)· `studio-authoring.draft-publish-lifecycle`(`packages/qa/dogfood/test/dashboard-designer-roundtrip.dogfood.test.ts`) | first-run-loop unknown;draft-publish 腿 🟢 2026-09-16(Dogfood gate 同上) | checklist `studio-authoring.json`(15 项) |
| J5 | 第三方开发者(本地跑) | `os dev` → 健康、种子 admin 可登录、端口与陈旧提示诚实 → 控制台(objectui 渲染半边,`.objectui-sha` pin)里看到自己的导航、列表、表单 | `cli.dev-boot-contract`(P0,手动)· `platform-core.boot-health`(P0,手动)· `platform-core.nav-surfaces-render`(`examples/app-showcase/e2e/showcase-smoke.spec.ts`)· `cli.scaffold-console-first-paint`(P1,手动) | unknown(手动项的 run record 只落 `qa-run` issue;showcase-smoke 无独立读数) | checklist `cli.json` · `platform-core.json`;`packages/cli/README.md`(`os dev`) |
| J6 | 第三方开发者(验证) | `os validate` / `os lint` / `objectstack verify`(`pnpm verify`)→ 错拼与已退役键被**响亮拒收**并附处方,不会静默落库;字段回环与跨 owner RLS 在真实 HTTP 栈上证明 | `cli.verify-verdict-exit-mapping`(`packages/cli/src/commands/verify-tenancy-posture.test.ts`)· `access-security.crud-permission-matrix`(`objectstack verify --rls`:`packages/verify/src/verify.ts` + `rls.ts`;dogfood `showcase-crud-persona-matrix`)· `studio-authoring.authoring-validation-not-persisted`(P1,手动)· `cli.build-own-contract`(P1,手动);参考应用:hotcrm `pnpm verify` 在 `ci.yml` | 🟢 2026-09-16 hotcrm ci run #3054 success(`087b7c5`);Dogfood gate 🟢 同日 | `packages/verify/README.md` · `packages/cli/README.md`(Quality)· `content/docs/deployment/validating-metadata.mdx` · checklist `cli.json` · `access-security.json` |
| J7 | 第三方开发者(发布) | `os compile` → `dist/objectstack.json` → `os package publish`(或 hotcrm `scripts/publish-marketplace.mjs`)→ 版本出现在市场 | hotcrm `.github/workflows/publish-staging.yml` / `publish-production.yml`(workflow_dispatch)· `cli.plugin-manifest-build-contract`(P2,手动) | 🟢 2026-09-14 hotcrm publish-staging [run #11](https://github.com/objectstack-ai/hotcrm/actions/runs/34822081894) · publish-production run #5 success | `packages/cli/README.md`(Cloud — publish & install)· hotcrm `scripts/publish-marketplace.mjs` |
| J8 | 第三方开发者 / 其客户的管理员(安装) | 把发布的包装进一个环境(在线市场或离线 inline)→ 导航出现应用 → 记录可读写;`engines` 不兼容在安装边界被拒 | `platform-core.marketplace-install-local-lifecycle`(P1,手动)· `platform-core.manifest-install-contract`(P1,手动)· `platform-core.package-lifecycle-enable-disable`(P1,手动) | unknown | checklist `platform-core.json` |
| J9 | 第三方开发者(迭代) | 客户原话进 `docs/requirements/NNNN` → 分诊 A/B/C/D → 按 `.github/tasks/new-feature.md` 写元数据到 `src/` 或 overlay → `pnpm verify` + changeset → 发版 → 客户在 CRM 里看到字段 / 审批 | none yet(hotcrm `ci.yml` + `e2e.yml` 证明迭代后应用仍能启动、hook 仍触发,不证明某条 REQ 已落地) | 🔴 2026-09-16:六条 REQ 零条过 `Triaged`,0002–0006 的 Traceability 仍是「to be filled in when built」(hotcrm@`087b7c5`);应用本身 🟢 同日 ci #3054 / e2e #1272 | hotcrm `docs/requirements/README.md` + REQ-0001–0006 · `.github/tasks/new-feature.md` |
| J10 | 终端用户(作为证明) | 开发者做出的应用里:登录 → 增删改查一条记录 → 数据落库;受限成员只看到自己的行、字段级掩码生效 | `records-forms.crud-roundtrip`(P0,手动)· `platform-core.console-login`(P0,手动)· `access-security.rls-both-sides`(`packages/verify/src/rls.ts` + `packages/qa/dogfood/test/showcase-private-owd.dogfood.test.ts`)· `access-security.crud-permission-matrix`(dogfood `showcase-crud-persona-matrix`) | 🟢 2026-09-16 Dogfood Regression Gate success on `main@85c6d76e`(API 半边);浏览器半边 unknown | checklist `records-forms.json` · `platform-core.json` · `access-security.json` |

objectui 是开发者应用的**渲染半边**(`.objectui-sha` pin),住在 J4 / J5 / J10 里,不单独成行。

**未入选 — cloud 服务自己的清单**(首稿收过、本轮移出;cloud 仓可按同一形状自立一张清单,本表不锚定它们):

- 新用户注册 → 建组织 → 自带环境:[cloud#1653](https://github.com/objectstack-ai/cloud/issues/1653)(🔴 P0 open,
  2026-09-16);runner cloud `scripts/dev-local/LOCAL-E2E-CHECKLIST.md` A2–A3。
- 控制面发布速度(首页 ≤2.5 s、DB 请求 ≤200 ms):[cloud#1521](https://github.com/objectstack-ai/cloud/issues/1521)
  (🔴,待 prod 人工重测);无脚本。
- 托管 HotCRM:cloud 登录直通、按组织建空间、租户隔离:cloud ADR-0111 R1.1–3.4;runner cloud
  `scripts/dev-local/verify-hotcrm-saas.mjs`(🟢 2026-08-16 rig,3 项 pinned 发现)。
- 运营者按组织启停 Service、托管实例的爆炸半径:cloud ADR-0111 R4、R6.1;无 runner。
- 计费姿态:cloud ADR-0111 D1 留的挂点,MVP 免费、未建;无 runner。
- 云端审核并副签一个发布的包(发布飞轮的云端半边):cloud `LOCAL-E2E-CHECKLIST.md` D5–D6;开发者半边住 J7。

**未入选 — 平台侧**:

- 非管理员从账户应用进入审批收件箱(`approvals.account-app-entry`,P0,手动)— 终端用户面,J10 之外。
- 声明式自定义页的块组合与页源分层(`studio-authoring.custom-page-render-and-blocks` · `custom-page-source-tiers`)—
  并入 J2 / J4 的元数据种类,不单独成行。

### D2 — 三条裁决(PM 协议引用的规则)

1. **旅程锚定优先级。** 每张分诊过的卡带一行 `Journey:`,值是本表行号(J1–J10)或 `none`。
   顶带恒定:**安全与数据完整性从不等旅程,永远最高一带。** 其下:旅程断了或被挡 ⇒ P0/P1;
   旅程能跑但在它经过的路径上产出错误结果(含 AI 写的应用被平台静默吞掉)⇒ P2;
   不在任何已声明旅程上 ⇒ 默认 p3 或 `not_planned` — declared-but-unenforced 的键按发布批量退役,⛔ 不一键一卡。
2. **跨 lane 优先级。** 只要任一产品仓(cloud / hotcrm / objectui 用户可见面)还有未认领的、在旅程上的 P0/P1,
   任何 lane 都不派发 p2/p3 的契约卫生或工具卡。PM 协议的取卡全序引用这一句。
3. **队列由跑旅程喂。** runner 按计划执行(既有 `checklist-test` / `dogfood-verification` 技能,以及
   nightly `golden-journey.yml`、每日 `scaffold-e2e.yml`、每 PR 的 `Dogfood Regression Gate`);
   一条变红的旅程立一张带 `Journey:` 行的卡。契约扫描与顺路发现转为背景,对着本表评级。

### D3 — 取代 PRIORITIZATION.md

本记录取代 [`docs/adr/PRIORITIZATION.md`](./PRIORITIZATION.md) 作为优先级锚;该文件顶部加一行指针,⛔ 不重写。

## Consequences

- **清单即胃口。** 维护者删行、换行;席位提新行必须附 runner;十行是上限。表中 10 行(已到上限),9 行有 runner,
  1 行 `none yet`(J9)。`none yet` 的行变不了红,就喂不了队列(D2.3):要么补 runner,要么删行。
- **源与归并。** objectstack `docs/qa/platform-checklist/` 264 项 / 15 区 / 19 项 P0 → 十行引 22 项,未入选再引 3 项;
  `content/docs/getting-started/` 8 页 → J1、J3;`skills/objectstack-*` 10 个技能 → J1、J2、J3;
  `packages/create-objectstack/README.md`(1 个模板)→ J1;`packages/cli/README.md` 命令表 → J5、J6、J7;
  `packages/verify/README.md` → J6、J10;`packages/mcp/README.md` → J3;hotcrm `docs/requirements/` 6 条记录
  (0001 为示例,0002–0006 是同一客户的 Track A)+ `.github/tasks/new-feature.md` + 4 个 workflow → J6、J7、J9;
  cloud runbook §7 的 8 个检查点只作 J3 的 runner。**移出**:首稿的 cloud ADR-0111 17 条验收行、cloud#1521、
  cloud#1653、cloud `LOCAL-E2E-CHECKLIST.md` 的 A / D 段 → 「未入选 — cloud 服务自己的清单」6 行。
- **读数会腐烂。** 「最近读数」列是写下当天的快照;活数据住 runner 自己的记录(nightly run、`qa-run` issue、
  CI check)。引用本表某行的读数时带日期,过期即重取。
- **执行是另一张卡。** D2 三条落进 `SKILL.md` 分诊行与取卡全序,由接受后立的 skills-lane 卡承担;本记录是法,
  技能编辑是执法。
- **代价。** 锚是维护者替第三方开发者做的声明,不是开发者的拉力;真实开发者到来后,本表按他们走的路重排。
  跨 lane 规则(D2.2)会让契约卫生卡在产品仓有 P0/P1 时整批停摆 — 这是有意的。云服务的路不在表里,不等于不重要:
  它们在 cloud 仓自己的清单里排,本表只管开发者平台。
