---
"@objectstack/cli": patch
---

fix(cli): `os doctor` 按 `os serve` 的顺序读 `.env*`,并逐值注明来源(#5387)

`serve` / `dev` / `start` 三条命令都在读第一个 `OS_*` 变量之前用 dotenv-flow 载入
`.env*`(`serve.ts:520`、`dev.ts`、`start.ts`);`doctor` **一个都不载入** ——
`grep -n dotenv packages/cli/src/commands/doctor.ts` 此前只匹配到一句「我不载入」的注释。
于是被诊断的环境和诊断者看到的环境,不是同一个环境:

```
# .env,提交进仓库、团队共享
OS_TENANCY_POSTURE=isolatd

$ os doctor      # 看不到 .env,posture 解析成 single,报绿,exit 0
$ os serve       # 载入 .env,读到 isolatd,FATAL 拒绝启动(PR #5381 的闸门)
```

`.env` 恰恰是这个变量最常见的来源 —— PR #5381 把 serve 的闸门刻意放在 dotenv 载入
**之后**,理由正是这个。在 #5382 之前 doctor 没有任何 env 派生检查,这条不一致不产生
可观察差异;#5382 加了第一项(posture),它才有了落点,也才成为「诊断面与运行时不一致」
(#4801 / cloud#1020 家族)在 `.env` 这条来源上的残留。

**现在的行为。** doctor 用 dotenv-flow 自己的 `listFiles()` 取到 `os serve` 会载入的
同一份文件清单(`node_env` 按 serve 同款推导:`NODE_ENV || production`;doctor 没有
`--dev`,serve 表达式里的 `'test'` 分支在 `flags.dev` 为假时是恒等的),逐个文件解析,
让每个变量记住它是在**哪个文件**里胜出的。两条约束是这次改动的实质:

- **不静默合并进 `process.env`。** 文件里的值只在需要它的那一次读取周围套上(
  `withDotenvOverlay`),`finally` 里再摘掉 —— 用的是 dotenv-flow 自己 `unload()` 的判定
  (只删掉仍然等于写入值的那些),所以回调故意改写的值不会被误删。运行中后续的一切
  (config 打包、外部命令)不会莫名其妙继承一个跟昨天不一样的环境。
- **逐值注明来源。** 报告新增一行常驻体检项,说明载入了哪些文件、以及每个 env 输入来自
  shell 还是哪个文件:

```
  ✓ Environment files    .env, .env.production (node_env=production), the cascade `os serve` loads — OS_TENANCY_POSTURE from .env.production, OS_MULTI_ORG_ENABLED from .env
```

只静默合并、不注明来源,只是把盲区从「doctor 没读我的 `.env`」平移成「doctor 到底信了我
四个 `.env*` 里的哪一个」—— 同一类缺陷往前挪一层。该行**只报来源、从不报值**,所以
`DOCTOR_ENV_INPUTS` 将来加入带密钥的变量也不会因此泄露(唯一被打印的值是**非法**的
`OS_TENANCY_POSTURE`,由 posture 那条 finding 原样引回给作者看自己的拼写)。

**posture 那条 finding 的文案随之改写。** #5382 写的是「unlike `os serve`, `os doctor`
does not load `.env*` files」—— 在当时如实,也正是 #5387 被开出来的原因。现在同一个位置
说的是它**读到了什么**:

```
      Read from .env.production — `os doctor` loaded the same `.env*` cascade
      `os serve` does (node_env=production: .env, .env.production).
```

优先级与 serve 一致:shell 里已存在的变量胜过所有文件(dotenv-flow 用 `hasOwnProperty`
判定,所以 shell 里显式写空 `OS_TENANCY_POSTURE=` 也胜过 `.env` 里的值),cascade 里靠后
的文件胜过靠前的。

**一个如实说明的影响面:** 本改动改变的是 doctor **每一项 env 派生检查**的输入。今天落在
两处 —— posture 报告,以及 ADR-0120 D5e 的 unique-scope 建议(它只在 posture 为
`isolated` 时运行,所以一个只写在 `.env` 里的 `isolated` 现在会让它在 doctor 里跑起来,
和 `os serve` 一致)。这正是本单要修的东西,不是副作用。用户配置文件(
`objectstack.config.ts`)自身读 `process.env` 的那条路径**没有**套上 overlay,以免改变既有
config 检查的判定,另行记录。
