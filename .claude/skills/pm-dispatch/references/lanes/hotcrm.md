# 车道岗位说明:repo:hotcrm(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。本席为姊
妹仓执行座位:在 hotcrm 仓认领/派发/复核/落地,⛔ 不产 `domain:*`/type/定级(纪律
全文在 SKILL.md 多仓协调规则 4)。

## 宪章出处(维护者裁决 2026-08-20,逐字未译 —— 本席一切判断锚定于此)

> 「新增了 hotcrm 仓库的席位,这个仓库作为 objectstack 的样板工程,使用元数据开发crm应用,平台相关的功能应该在平台中实现,hotcrm 主要是展现平台能力,并且不扩散需求。」

> 「hotcrm 部署到objectos企业版时,就会有企业版的能力,但是在 objectstack 社区版中也可以运行。」

## 范围

- `objectstack-ai/hotcrm` 全仓:元数据优先的 CRM 样板工程(exemplar app),不入
  spec 依赖链(同 objectos)。应用即展品,不是功能实验场 —— 收卡第一问恒为「这张
  卡展现哪项平台能力?」。
- 边界(宪章的牙齿):**平台相关的功能在平台中实现** —— 建设 hotcrm 时发现的平台
  能力缺口,立**普通平台卡**到 objectstack/objectui(file-at-destination,非缝卡,
  待分诊;hotcrm 侧同笔 `pm:blocked` + `Blocked-by: <owner/repo>#N` 回链),⛔ 永
  不在 hotcrm 内绕行 —— 绕行把平台缺口藏进样板,展品从此示范错误写法。
- `repo:hotcrm` 缝标签只给真协调卡(跨仓次序即卡的实质);纯 hotcrm 修复住 hotcrm
  仓(issue 住在修复落地的仓,多仓协调规则 1)。

## 常设承诺

- **每轮巡检第一判据**:先读半状态巡查锚(`half-state-patrol.yml` 置顶 issue)点名本道卡/PR/座位贴的 H 行,逐行认领或处置,再做其余判据;锚行未处置 ⛔ 不开新派发。
- **展现平台能力**:样板演示的能力必须真实兑现(declared = enforced 在展品里双倍
  重要 —— 展品撒谎等于教每个照抄的 AI 撒谎);发现 declared≠enforced 先问「生产者
  在哪」,生产者在平台 ⇒ 上游卡。
- **不扩散需求**:创业阶段聚焦原则全额适用,四维框架轴④是本车道首要过滤器(框架
  单源在 SKILL.md「升级与决策」,⛔ 不另抄);投机功能形状不入队 —— 走决策箱或关
  not planned(定级归分诊/维护者,本席只供证据)。
- **双版本兼容**:hotcrm 必须在 objectstack 社区版可运行;部署到 objectos 企业版
  时获得企业能力。操作判据:hotcrm 元数据只可依赖社区能力面,企业特性恒为增强
  (enhancement-only)⛔ 永不硬依赖;会 break 社区版运行的卡定义上是错范围,回分诊。
- 该仓无 changeset 流、无发版板(除非另裁);pm 状态机词表五仓统一(幂等创建在
  `scripts/pm/ensure-pm-labels.sh`,对 hotcrm 实跑是落地步骤)。

## 席内判断

- 平台缺口卡是本席最常见的联动产出 —— 立卡在平台仓、无 assignee、普通卡待分诊,
  `domain:*`/type 留给分诊;催办不代裁。
- 展品价值判据:一张卡若既不展现平台能力、也不修真实缺陷,默认不做(轴④);拿不
  准升决策箱,⛔ 不自裁。
