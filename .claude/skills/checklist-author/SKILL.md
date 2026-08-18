---
name: checklist-author
description: >
  Re-audit the platform test checklist (docs/qa/platform-checklist/) for coverage
  gaps and author the missing items — the five-angle capability sweep. Use whenever
  the maintainer says "跑一轮 coverage sweep", "run a coverage sweep", "排查测试清单
  遗漏", "审计测试覆盖", or asks whether some platform surface "有测试吗" and the
  answer needs verifying rather than recalling. Also the right tool after a large
  platform surface lands or before a major release. NOT a customer-published skill —
  this is internal agent tooling (lives in .claude/, never in the published
  `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery — every SKILL.md outside `skills/` must carry this marker
  # (template-consistency.test.ts enforces it).
  internal: true
---

# Checklist author —— 让测试清单保持诚实的 coverage sweep

规范方法住在 **`docs/qa/platform-checklist/SWEEP.md`** —— 先读它、照它执行;本技能
只是触发器与编排契约,不是流程的第二份拷贝。

## 你要产出什么

一份对 `docs/qa/platform-checklist/` 的增量:`areas/*.json` 里新增/扩充的测试项、
对账后的 `coverage.json`、追加进 `FOLLOW-UPS.md` 的缺陷/文档漂移 —— 全部在
`node scripts/check-platform-checklist.mjs` 下校验为绿,并按 AGENTS.md
(worktree-first,PD#11)落在任务分支上。

## 编排契约

1. **Worktree 先行**(PD#11):`git worktree add ../objectstack-<task> -b <branch> main`。
   全部编辑都在那里做。派发任何 agent 之前先读清单现状。
2. **五个只读 gap hunter 并行** —— 每个 SWEEP.md 角度一个(console UI / spec 枚举 /
   路由与运行时 / 内置应用 / 文档声称)。每个拿到:当前 item-id 清单、已知的 waiver
   与 blocked 项(不重复上报),以及输出契约 `surface | evidence path | coverage
   verdict | proposed id | sketch | fixture?`。hunter 不写任何文件。
3. **去重并入一个草稿登记表**(落地前删掉)。跨角度的重复命中是高优先级信号,不是噪音。
4. **按区 writer agent** —— 每个 `areas/*.json` 文件一个 agent,writer 之间永不相
   撞;除编排者外谁都不碰 `coverage.json` 与 `scripts/`。每个测试项都遵守 README.md
   的 deep-test 契约;缺 fixture 就记 `blocked`/`knownGaps`,永不伪造覆盖。writer
   断言之前把每个 endpoint、枚举、错误码都对到源码上 —— 把本技能的简报当假设,源码
   才是真相。
5. **集中对账**:hunter 证明有现成 fixture 的种类一律解除 waiver(2026-08 那轮
   sweep 里六条 waiver 有四条已过期 —— 每次都重审全部 waiver),新项映射进
   `coverage.json`,新的 variants 矩阵钉上 `enumSource`(见 README「Variants stay
   fresh automatically」)。
6. **校验 + 落地**:校验器绿,再提交到任务分支。产品缺陷与文档漂移进
   `FOLLOW-UPS.md`;安全敏感的发现,没有维护者的决定**永不**公开立单。

## 规模指引

一轮全量 sweep ≈ 5 个 hunter + 8 个 writer agent。范围化的问题(「X 有测试吗?」)
只在相关角度跑**一个** hunter,对清单核验后只补缺的 —— 契约相同,舰队更小。

**没有子代理工具时,按角度顺序跑 —— 并在交付里声明这一轮是顺序执行的。** 会话里不
存在 Task/子代理工具是允许的退化路径,不是阻塞;五个角度仍要逐个走完,一个都不省。
但 SWEEP.md 的全部主张是「不同角度捕获不同的遗漏类,**因为读者彼此独立**」:塌缩成
一个读者后,补上的测试项依然成立,**「没有别的遗漏」这个结论不再成立** —— 不声明,
就没人分得清一轮降级的 sweep 和一轮完整的 sweep。
