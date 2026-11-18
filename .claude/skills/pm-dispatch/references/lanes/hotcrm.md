# 车道岗位说明:repo:hotcrm

见 cross-repo-coordination.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本席为姊妹仓执行座位:在 hotcrm 仓认领、派发、L1 审核、落地。
- ⛔ 不产 `domain:*`;机械三务(含首触定级)按 cross-repo-coordination.md 单车道仓条自理。

## 范围

- `objectstack-ai/hotcrm` 全仓:元数据优先的 CRM 产品(早期是样板,现是产品),不入 spec 依赖链。
- 建设 hotcrm 时发现的平台能力缺口,立普通平台卡到 objectstack(渲染器在其 `ui/`)。
- 那是 file-at-destination、非缝卡、待分诊;hotcrm 侧同笔挂 `pm:blocked` 加 `Blocked-by:` 回链。
- ⛔ 永不在 hotcrm 内绕行:平台缺口在 objectstack 修。
- `repo:hotcrm` 缝标签只给真协调卡,跨仓次序即卡的实质。
- hotcrm 自己的卡(含决策卡)都住 hotcrm 仓:issue 住在修复落地的仓,决策入本仓收件箱。

## 简化分诊(单车道元数据应用仓)

- 适用 hotcrm 与只写元数据的应用仓;本节胜 `triage-duties.md`、`filing-gate.md` 同题条,余照旧。
- 首触一条评论:`Triage: repo <仓> · req REQ-NNNN · area:<专题> · <类型> · p<级>; why: <一句>`。
- 非 Feature 省 req;⛔ 不写 `reach:`、`Path:` 行,不跑五析取 sweep;专题、核心功能与定级表
  住应用仓 `docs/PRIORITIES.md`,⛔ 本文不抄。
- 哪个仓:缺陷问坏的代码在哪,新能力照 `app-platform-boundary.md`;属平台 ⇒ 本仓卡级不降。
- 平台卡写明所挡的 hotcrm 卡并照 `filing-gate.md` 跨仓条取级,同笔知会 objectstack 席。
- 要不要做:Feature 引处置为 B 的需求记录(`docs/requirements/NNNN-*.md`),无 ⇒ 决策箱;Bug 不用。
- 解锁看已发布进本仓 pin,不看已合并;每次升 `@objectstack/*` 的 PR 合并后扫一遍等平台的卡。

## 常设承诺

- 半状态巡查在本仓无载体:无 `half-state-patrol.yml`,无 workflow 即无锚 issue。
- ⇒ SKILL.md 执行座位职责的读锚第一步在此恒空,代之以手工半边。
- 手工半边:开新派发前整车道全交集读 open 卡。
- 逐张核 `pm:dispatched` 与 `pm:in-review` 的交付 PR 是否已合并或关闭,先处置半状态。
- ⛔ 无锚不等于免检。
- 不扩散需求:创业阶段聚焦原则全额适用,四维框架的不扩散那一轴是本车道首要过滤器。
- 框架单源在 SKILL.md 〈升级与决策〉,⛔ 不另抄。
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
- pm 状态机词表各仓统一,幂等创建在 `scripts/pm/ensure-pm-labels.sh`,对 hotcrm 实跑是落地步骤。

## 席内判断

- 平台仓卡的 `domain:*` 与 type 归分诊;本仓卡 type 随机械三务自打;催办不代裁。
