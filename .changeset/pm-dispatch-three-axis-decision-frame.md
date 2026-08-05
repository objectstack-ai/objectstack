---
---

docs(pm-dispatch,os-dev): 决策分析轴由两条扩为三条 —— 新增「实际业务需求」轴与创业阶段聚焦原则 (#5130)

维护者 2026-08-04 在 #5021 裁决现场的指示(「我们是一个创业项目,应该先专注于核心
能力,这个也应该写入项目经理 skills」)落到 agent 协议文本。当天起的实操已按三轴呈报,
skill 文本落后于实践。

- `.claude/skills/pm-dispatch/SKILL.md` 第 8 步(Escalate):「两条固定评估轴」→
  **三条**,新轴「实际业务需求」列第一位 —— 判据要求**实测**(谁在写这个键 / 谁在读
  这个能力 / showcase 与真实部署里的用法),不接受「读起来像有用」;**创业阶段聚焦
  原则**:能力扩张默认从紧,新能力 / 新词表 / 新配置面要有真实业务拉动才立项,无拉动
  的声明面按 implementation-first 处置(退役或停车),已发布但零消费的能力不因沉没
  成本获得豁免(先例 #5021 / #4988 / #4834)。原两轴(项目长远合理性、防 AI 写代码与
  写元数据 app 犯错)**原文保留**,仅顺序后移;收尾句「这两条轴 / 两轴冲突」→ 三条 /
  三轴;分诊一节的 `the deep two-axis analysis` → `three-axis`。
- `.claude/agents/os-dev.md` 的 `needs_decision` 升级段同步(`two fixed axes` →
  `three fixed axes`、`both axes` → `all three axes`)。两处本就是同一套框架的两半:
  不同步,开发 agent 会按两轴上报、PM 按三轴呈报,业务轴每次都要 PM 事后补。

为什么值一条独立的轴而不是一句提醒:#4936 与 #5021 是业务轴**改变结论**的正反两例 ——
前者因 showcase 自证了业务方向而裁「响亮拒绝而非退役」,后者因无业务拉动裁退役;
只看原来的两条轴,这两单会得出同一个答案。

仅改 `.claude/` 内部 agent 协议文本,不发布任何包;空 frontmatter 仅为满足 changeset
门禁。已发布目录 `skills/objectstack-pm-dispatch/SKILL.md` 里的两轴镜像本次**刻意未动**
(那是发布内容,另单处理),`docs/adr/0121-*.md` 记述的是当时按两轴做出的裁决,属历史
记录,同样不动。
