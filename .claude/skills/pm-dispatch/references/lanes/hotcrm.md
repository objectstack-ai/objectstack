# 车道岗位说明:repo:hotcrm

见 SKILL.md 〈多仓协调〉;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本席为姊妹仓执行座位:在 hotcrm 仓认领、派发、复核、落地。
- ⛔ 不产 `domain:*`、type 与定级,纪律全文在 SKILL.md 多仓协调规则 4。

## 范围

- `objectstack-ai/hotcrm` 全仓:元数据优先的 CRM 样板工程,不入 spec 依赖链。
- 应用即展品,不是功能实验场 —— 收卡第一问恒为这张卡展现哪项平台能力。
- 边界:平台相关的功能在平台中实现。
- 建设 hotcrm 时发现的平台能力缺口,立普通平台卡到 objectstack 或 objectui。
- 那是 file-at-destination、非缝卡、待分诊;hotcrm 侧同笔挂 `pm:blocked` 加 `Blocked-by:` 回链。
- ⛔ 永不在 hotcrm 内绕行:绕行把平台缺口藏进样板,展品从此示范错误写法。
- `repo:hotcrm` 缝标签只给真协调卡,跨仓次序即卡的实质。
- 纯 hotcrm 修复住 hotcrm 仓:issue 住在修复落地的仓。

## 常设承诺

- 半状态巡查在本仓无载体:无 `half-state-patrol.yml`,无 workflow 即无锚 issue。
- ⇒ SKILL.md 执行座位职责的读锚第一步在此恒空,代之以手工半边。
- 手工半边:开新派发前整车道全交集读 open 卡。
- 逐张核 `pm:dispatched` 与 `pm:in-review` 的交付 PR 是否已合并或关闭,先处置半状态。
- ⛔ 无锚不等于免检。
- 展现平台能力:样板演示的能力必须真实兑现,declared 等于 enforced 在展品里双倍重要。
- 展品撒谎等于教每个照抄的 AI 撒谎。
- 发现 declared 不等于 enforced 先问生产者在哪;生产者在平台 ⇒ 上游卡。
- 不扩散需求:创业阶段聚焦原则全额适用,四维框架的不扩散那一轴是本车道首要过滤器。
- 框架单源在 SKILL.md 〈升级与决策〉,⛔ 不另抄。
- 投机功能形状不入队:走决策箱或关 not planned;定级归分诊或维护者,本席只供证据。
- 双版本兼容:hotcrm 必须在 objectstack 社区版可运行,部署到 objectos 企业版时获得企业能力。
- 操作判据:hotcrm 元数据只可依赖社区能力面,企业特性恒为增强,⛔ 永不硬依赖。
- 会 break 社区版运行的卡定义上是错范围,回分诊。
- 该仓有 changeset 流:`changeset-check.yml` 门住每个到 main 或 develop 的 PR。
- 判据是本 PR 新增的 `.changeset/*.md`,对 base sha 求 diff,存量不算。
- 两条法定豁免任选:`skip-changeset` 标签,或空 frontmatter 的 changeset 声明本 PR 零发布。
- ⛔ 判据不是包的发布状态:该仓 `private: true`,门照设不误。
- 无发版板:标签清单无 `target:*`。
- 发版 = `changeset version` 一次消化存量,加 `v*.*.*` tag 触发 release.yml。
- 依赖是已发布的 `@objectstack/*` 包,逐包定版号,非 git pin。
- ⇒ 平台侧修复必须先发版、再在此升版号才到得了展品。
- 上游卡对本道的解锁判据是已发布,不是已合并。
- pm 状态机词表五仓统一,幂等创建在 `scripts/pm/ensure-pm-labels.sh`,对 hotcrm 实跑是落地步骤。

## 席内判断

- 平台缺口卡是本席最常见的联动产出:立卡在平台仓、无 assignee、普通卡待分诊。
- `domain:*` 与 type 留给分诊;催办不代裁。
- 展品价值判据:一张卡若既不展现平台能力、也不修真实缺陷,默认不做。
- 拿不准升决策箱,⛔ 不自裁。
