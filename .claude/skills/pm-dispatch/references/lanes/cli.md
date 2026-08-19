# 车道岗位说明:domain:cli(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。

## 范围

- `packages/cli`、`runtime`、`verify`、`qa`、`types`、`packages/rest`、
  `packages/mcp`、`packages/observability`、`packages/client*`、
  `cloud-connection`、`create-objectstack`、`packages/adapters/*`、
  `plugin-hono-server`、`plugin-dev`。
- 红线:按落点判归属 —— 标题挂 cli 而落点在别包的卡只上报误标不改签;
  `packages/spec` 恒归 spec 座位;`/meta` 路由**本体**归本席,元数据格式/接受面归
  `domain:spec`。

## 常设承诺

- **Required checks 六个**:`TypeScript Type Check` · `Lint & Repo Gates` ·
  `Test Core` · `Dogfood Regression Gate` · `Build Core` ·
  `Temporal Conformance (live PG + MySQL)` —— 逐 job 读各自 `conclusion`,⛔ 不认
  聚合,`in_progress` 不是过;advisory 门禁红进 main 是共享损伤,照样止血立单。
- **PR 侧绿 ≠ 队列侧绿**;队列成员资格直接可读:
  `git ls-remote origin 'refs/heads/gh-readonly-queue/*'`(条目名
  `main/pr-{number}-{parent sha}`,parent sha 可重建队序;⚠️ ref 在出队后滞留、入
  队瞬间滞后)。
- `dispatch-gates.mjs` 只报**路径推导**的地板 —— 条款②从卡**内容**判且优先于它;
  已知盲区:它不点名 `pnpm lint` 族 ⇒ 本车道派发令恒补一句「跑 `pnpm lint`」。
- ⛔ 永不削弱门禁 —— 棘轮上跳是门禁在报你的改动有缺陷;规则文案里自带的逃生舱只用
  于它描述的那种情形。

## 席内判断

- **探针的 baseline 也是测量**,而且是没人复查的那个 —— 判据恒读命中行本身,⛔ 不
  读命中数;断言「文本被删」的探针要锚在消失的那段上(被删串的前缀在删除后仍然幸
  存是构造使然)。
- 静默时长是**发探针**的门槛,永不是判死的(本车道实测基线:派发 → draft PR ≈
  35–50 分钟);分支无提交 + SendMessage 探针便宜,且实测能复活假死的 dev —— ⛔ 永
  不往可能活着的 worktree 派第二个 agent。
