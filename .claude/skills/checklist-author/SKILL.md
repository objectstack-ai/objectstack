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

## 编排契约 —— 只写 SWEEP 没有的

六步流程照 `SWEEP.md`「How to run it」执行,⛔ 这里不复述。它没有、而这一轮必须成
立的三条:

1. **Worktree 先行**(PD#11):`git fetch origin main && git worktree add --no-track
   ../objectstack-<task> -b <branch> origin/main`。全部编辑落在那里;派发任何 agent
   之前先读清单现状。
2. **只有编排者碰 `coverage.json` 与 `scripts/`。** hunter 一个文件都不写,writer 一
   个区文件一人 —— 这是并行 agent 之间唯一的串行化依据。
3. **本技能的简报是假设,源码才是真相** —— 每个测试项按 README.md「Item anatomy」
   的契约写;缺 fixture 记 `blocked`/`knownGaps`,永不伪造覆盖。

## 规模指引

一轮全量 sweep ≈ 5 个 hunter + 8 个 writer agent。范围化的问题(「X 有测试吗?」)
只在相关角度跑**一个** hunter,对清单核验后只补缺的 —— 契约相同,舰队更小。

**没有子代理工具时,按角度顺序跑 —— 并在交付里声明这一轮是顺序执行的。** 会话里不
存在 Task/子代理工具是允许的退化路径,不是阻塞;五个角度仍要逐个走完,一个都不省。
但 SWEEP.md 的全部主张是「不同角度捕获不同的遗漏类,**因为读者彼此独立**」:塌缩成
一个读者后,补上的测试项依然成立,**「没有别的遗漏」这个结论不再成立** —— 不声明,就
没人分得清一轮降级的 sweep 和一轮完整的 sweep。
