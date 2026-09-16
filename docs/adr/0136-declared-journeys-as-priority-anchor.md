# ADR-0136: Declared journeys as the priority anchor — 维护者声明的 ≤10 条端到端路径,各带 runner,是分诊的第一问

**Status**: Proposed (2026-09-16) — awaiting the maintainer's hand-merge, which is the acceptance act for a
governed surface (Prime Directive #14). 本记录是维护者的**优先级法**:旅程表是维护者的胃口,评审时**按删除与替换编辑**;
席位只能带着 runner 提新行,⛔ 不能自行加行。
**Deciders**: ObjectStack maintainer, 2026-09-16, on the direct channel, verbatim and untranslated:
「我觉得一个创业项目核心应该放在怎么解决实际业务需求上,你再帮我综合评估我们最近的开发还有哪些跑偏了」·
「我们是一个开发平台,也是创业项目,用的人少,你也不会知道『谁今天撞上』」·「路的清单 是否建议重新讨论,专门立文档」—
reply to the ADR proposal: 「立」. Filed as [#18477](https://github.com/objectstack-ai/objectstack/issues/18477).
**Supersedes**: [PRIORITIZATION.md](./PRIORITIZATION.md) as the priority anchor — 那是一份 2026-06 的 ADR 状态复核,
2026-07-16 自标 STALE;它保留自己的方法与 status-hygiene 规则,不再回答「先做什么」。
**Sources**: 全部取自 `origin/main` 上已有文件与已有卡片,⛔ 无一行发明 — cloud ADR-0111 验收行、cloud
`scripts/dev-local/MAGIC-FLOW-TEST-RUNBOOK.md` §7、cloud#1521、cloud#1653、hotcrm `docs/requirements/`、
objectstack `docs/qa/platform-checklist/`。各源行数与归并见 Consequences。
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
- 没有用户拉力时,**维护者自己声明的端到端路径**就是锚。本记录把这些路写成一张表,每行带一个能变红的 runner,
  然后规定:卡片先问「在哪条路上」,再问「违背哪条契约」。

## Decision

### D1 — 旅程表(≤10 行;维护者按删除与替换编辑)

列:谁走 · 入口 → 完成时用户看到什么 · runner(能机械变红的证明;`none yet` = 缺口)· 最近读数(🟢/🔴 + 日期 +
红时的卡号;`unknown` = 无读数)· 来源。读数是 2026-09-16 写下时的快照,不是活数据。

| # | 谁走 | 入口 → 完成时用户看到什么 | runner | 最近读数 | 来源 |
|---|---|---|---|---|---|
| J1 | 租户管理员(新用户) | 在 cloud.objectos.ai 注册 → 建组织 → 自带 production 环境 → 以 admin 进入环境控制台 | cloud `scripts/dev-local/LOCAL-E2E-CHECKLIST.md` A2–A3 · B2(手动);`golden-journey.mjs` 每晚在 rig 上以新用户注册(只覆盖注册腿,不覆盖 prod 姿态) | 🔴 2026-09-16 [cloud#1653](https://github.com/objectstack-ai/cloud/issues/1653)(P0 open,`pm:awaiting-maintainer`;prod `tenancyPosture` 读数待人工取) | cloud#1653;cloud ADR-0111 R5.2 |
| J2 | 平台运营者 / 所有用户 | 已登录打开 cloud.objectos.ai → 首页 ≤2.5 s、单个 DB 请求 ≤200 ms、20 并发不过拐点 | none yet(六项发布门槛只能在 prod 人工重测,树上无脚本) | 🔴 2026-08-21 读数 ~1.5 s/请求、home load 3,669 ms;2026-09-16 子卡全关、待 prod 重测 [cloud#1521](https://github.com/objectstack-ai/cloud/issues/1521) | cloud#1521 |
| J3 | AI 应用构建者 | 发一句中文提示 → Proposed plan → Build it → Publish → 我的应用里出现应用,列表有行、仪表盘按状态出数;再说「加张表」直接进导航 | cloud `scripts/dev-local/golden-journey.mjs`(nightly `golden-journey.yml`)+ `verify-magic-flow.mjs --v1`;runbook §7 行 Build / Publish / Dashboard / Iterate add-table | 🟢 2026-09-15 nightly [run #17](https://github.com/objectstack-ai/cloud/actions/runs/35008107007) success(#14 于 09-12 失败) | cloud `MAGIC-FLOW-TEST-RUNBOOK.md` §7;cloud#1955 / cloud#1957 |
| J4 | AI 应用构建者 | 再说「加个自动化」→ 流程绑定 → 改一条记录 / 到期前 3 天 → 目标表真的多出一行 | runbook §7 行 Iterate add-automation / add-time-relative / Time-relative EXECUTION / Flow execution(手动;v1 面之外,cloud ADR-0112);LOCAL-E2E B8 | 🟢 2026-08-01(time-relative 腿,runbook 自述);record-change 腿无带日期的读数 | cloud `MAGIC-FLOW-TEST-RUNBOOK.md` §7 |
| J5 | 租户管理员(HotCRM 托管) | 打开托管实例 → cloud 登录直通 → 落在本组织的 CRM,带示例数据;组织 B 看不见、探不到 | cloud `scripts/dev-local/verify-hotcrm-saas.mjs`(DB 真值,R3 隔离半边)+ `apps/objectos-ee/test/hotcrm-multitenant.acceptance.ts`(HTTP 半边);R1/R2 登录与首登建空间:`HOTCRM-SAAS-TEST-RUNBOOK.md` §3 手动 | 🟢 2026-08-16 rig 硬检查全绿(hotcrm@`d4ddee09`),3 项 ⚑ pinned 发现(平台表 `organization_id = NULL`、hierarchy 惰性、contact hook 租户盲) | cloud ADR-0111 R1.1–1.3 · R2.1–2.4 · R3.1–3.4 |
| J6 | 应用作者(标准产品) | 客户原话进 `docs/requirements/NNNN` → 分诊 A/B/C/D → 元数据落 `src/` 或 overlay → `pnpm verify` + changeset → 发版 → CRM 用户看到字段 / 审批 | none yet(hotcrm `pnpm verify` 与 `e2e/*.spec.ts` 证明产品能启动、hook 会触发,不证明某条 REQ 已落地) | 🔴 2026-09-16:六条记录零条过 `Triaged`,REQ-0002–0006 的 Traceability 仍是「to be filled in when built」(hotcrm@`087b7c5`);无卡号 | hotcrm `docs/requirements/README.md` + REQ-0001–0006 |
| J7 | 应用作者(零代码) | 脚手架 / 启动 → 建 package → object → 记录 → app → publish → 终端用户看到;零代码、零重启 | `studio-authoring.first-run-loop`(P0,手动)· `cli.scaffold-first-run`(`.github/workflows/scaffold-e2e.yml`,每日) | 🟢 2026-09-16 scaffold-e2e [run #3082](https://github.com/objectstack-ai/objectstack/actions/runs/35052312706) success(脚手架腿);first-run-loop:unknown(run record 只落 `qa-run` issue,不在树上) | objectstack `docs/qa/platform-checklist/areas/studio-authoring.json` · `cli.json` |
| J8 | 租户管理员 | 市场浏览 → 安装包(本地 / 离线 inline)→ 导航出现应用 → 记录可读写 | `platform-core.marketplace-install-local-lifecycle`(P1,手动)· `platform-core.marketplace-console-honesty`(P2,手动) | unknown | objectstack `areas/platform-core.json` |
| J9 | 租户管理员 / 终端用户 | 种子 admin 从控制台登录 → 在 UI 里增删改查一条记录 → 数据落库;受限成员只看到自己的行 | `records-forms.crud-roundtrip`(P0,手动)· `platform-core.console-login`(P0,手动)· `packages/qa/dogfood/test/showcase-crud-persona-matrix.dogfood.test.ts`(CI `Dogfood Regression Gate`) | 🟢 2026-09-16 Dogfood Regression Gate success on `main@85c6d76e`(API 半边);浏览器半边 unknown | objectstack `areas/records-forms.json` · `platform-core.json` · `access-security.json` |

**未入选**(源里有、本表未收;维护者可换入):

- 发布者飞轮:`os plugin build` → `sign` → `publish` → 云端审核副签 → 装进第二个环境 — runner cloud
  `LOCAL-E2E-CHECKLIST.md` D1–D6(手动);读数 unknown;源不在本卡点名的四份文件里。
- 运营者按组织启停一个 Service(cloud ADR-0111 R4.1–4.2)— 后台操作,无 UI,无 runner。
- 托管实例宕机而控制面与客户环境照常(cloud ADR-0111 R6.1)— 无 runner。
- 非管理员从账户应用进入审批收件箱(`approvals.account-app-entry`,P0,手动)— 读数 unknown。
- `os dev` 启动到健康、种子 admin 可登录(`cli.dev-boot-contract` · `platform-core.boot-health`,P0)— 已并入 J7 / J9 的入口。

### D2 — 三条裁决(PM 协议引用的规则)

1. **旅程锚定优先级。** 每张分诊过的卡带一行 `Journey:`,值是本表行号(J1–J9)或 `none`。
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

- **清单即胃口。** 维护者删行、换行;席位提新行必须附 runner;十行是上限。表中 9 行,7 行有 runner,
  2 行 `none yet`(J2、J6)。`none yet` 的行变不了红,就喂不了队列(D2.3):要么补 runner,要么删行。
- **源与归并。** cloud ADR-0111 共 17 条验收行(R1–R6;本卡点名 1.1–5.x 计 15)→ J5 收 R1–R3 共 11 条,
  R5.2 进 J1,R4、R6.1、R6.2 进未入选,R5.1 归顶带;runbook §7 共 8 个检查点 → J3 收 4、J4 收 4;
  cloud#1521 六项门槛 → J2 一行;cloud#1653 → J1 一行;hotcrm 六条 REQ 记录(0001 为示例,0002–0006 是同一客户
  的 Track A)→ J6 一行;platform-checklist 264 项 / 15 区 / 19 项 P0 → J7、J8、J9 引 7 项,未入选再引 3 项。
- **读数会腐烂。** 「最近读数」列是写下当天的快照;活数据住 runner 自己的记录(nightly run、`qa-run` issue、
  CI check)。引用本表某行的读数时带日期,过期即重取。
- **执行是另一张卡。** D2 三条落进 `SKILL.md` 分诊行与取卡全序,由接受后立的 skills-lane 卡承担;本记录是法,
  技能编辑是执法。
- **代价。** 锚是维护者的声明,不是用户的拉力;真实用户到来后,本表按他们走的路重排。跨 lane 规则(D2.2)会让
  契约卫生卡在产品仓有 P0/P1 时整批停摆 — 这是有意的。
