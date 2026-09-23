# 外部贡献:fork PR 是提案,不是交付

见 landing-operations.md 的 fork PR 行;本文是 fork PR(head 仓 ≠ base 仓)进场到落地的四步。
席位永不翻 ready、入队、挂 auto-merge 或批准它;席位复审是必需输入,⛔ 永不是放行许可。

- ① 先立卡:分诊 fire 扫 open PR 中 head 仓 ≠ base 仓者;无卡的按 PR 正文立卡,常规定级。
- 无卡的 fork PR 在板上不存在;PR 上只贴一条固定评论,原文:
  `this repository works card-first; filed as #N; this PR stays a draft until the card is graded`
- ② 人裁的是问题不是代码:普通可复现缺陷路由到席位,不经维护者。
- 地板项(安全/权限边界、契约、功能)作业务问题进决策箱,与任何卡同批裁。
- ③ 席位采纳 diff,永不落地 fork PR:内部分支 cherry-pick 或重写,`Co-authored-by:` 贡献者。
- 门禁推导、达档复核与队列同内部工作;对贡献者的要求只作 fork PR 上的 review 评论。
- 内部 PR 落地后关闭 fork PR,附致谢与落地链接;席位在 fork PR 上只写这两种评论。
- ④ fork 的 CI 席位永不代批准运行;head 上 0 条 check run 读作 NOT MEASURED,⛔ 永不读作绿。
- 机器面:`check-governed-merges.mjs --pr <n>` 对 head 仓 ≠ base 仓走 H(人合)出口;head.repo 为空同。
- 供应链条款(fork 带来的依赖、lockfile、workflow、scripts)延后:第一张此类 fork PR 出现时再立。
