# 各仓「真绿」跑法索引(references —— 按需加载)

出处:主文件「复核 / 入队与落地」的入队资格条款(全 check 绿,非 required 子集)。
每仓一节:正典测试跑法、CI 日志 grep 看不见的门禁、本地 preflight —— 一行一事实。
与编译面清单同一维护纪律:**这张表由 PR 维护**,踩到新形态的那个 PR 顺手改这里;
⛔ 不引用 issue 编号。

## objectstack(后端主仓)

- 重活(build/test)一律走共享验证锁入口 `bash scripts/pm/os-verify-lock.sh -c '<cmd>'`
  —— 结论读它印的 VERDICT 行,⛔ 不读裸 `$?`(排队语义与预算见 os-dev 定义)。
- 该锁 **Linux-only**:宿主无可用 `flock` 时入口点不拒绝,改跑声明式 unlocked 模式 ——
  降级写进 VERDICT 行,并印出 PR 正文该照抄的申报原文(⛔ 别另写一套措辞)。
- 门禁族派生:`node scripts/pm/dispatch-gates.mjs` **不传路径**,脚本自己从 merge-base
  取变更集;⛔ 不自己 `git diff` 喂清单 —— 两点差按此刻的 `origin/main` 求值,姊妹
  PR 的文件会被算进来,而退出码照样 0。
- 该脚本只住本仓,答案只关于它所在的树:喂姊妹仓路径得到的是**本仓**的门禁族 ——
  形态完整、退出码 0、全错;`--repo <owner>/<name>` 申报归属可机械拒错。

## objectui(前端)

- 正典跑法:**仅仓根 `pnpm test`**。vitest 守卫拒绝 package 目录内的运行 —— 那种跑法
  曾假绿(无关 console 文件通过、目标用例 0 个在跑,被计为通过);守卫的拒绝是保护,
  ⛔ 不绕。
- typecheck 脚本拼作 `type-check`(连字符);拼错脚本名的 `pnpm --filter` 匹配零脚本、
  **退出码 0**、静默假绿 —— 核对输出确实回显了脚本名再信绿。

## cloud

- 本地 preflight:`preflight-workspace-dist`(workspace 依赖的 dist 新鲜度守卫)——
  按其自身输出的提示跑,先建再测。
- 严格区 `check-test-typecheck` 的失败**不以 `error TS` 行出现在 CI 日志**:turbo 汇总
  只写 `#typecheck` failed —— 要看到台账消息必须本地跑该包自己的 `typecheck` 脚本;对 CI 日志
  grep `error TS` 的阴性读数在这一族上不成立。
