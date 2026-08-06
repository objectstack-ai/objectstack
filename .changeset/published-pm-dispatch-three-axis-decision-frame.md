---
---

docs(skills): 已发布 skill `objectstack-pm-dispatch` 的决策框架由两轴升为三轴 —— 新增「实际业务需求」轴,内核泛化后搬 (#5451)

#5130 把内部 agent 协议的决策评估轴由两条扩为三条,但同一套框架在**已发布目录**里还有
一份镜像 —— `skills/objectstack-pm-dispatch/SKILL.md`(#4607 发布,`metadata.domain:
process`,无 `metadata.internal`,第三方 ObjectStack 项目可 `npx skills add` 安装),
它仍是两轴。#5130 刻意把范围钉在 `.claude/`(改发布内容是用户可见变更),本单补齐,
两份文本重新同构。

维护者 2026-08-06 在 #5451 裁决 **B(泛化内核后搬)**,而不是原样搬或不搬:

- **新增 Axis ①「real business need」,排在两条原有轴之前**——每个方案先问它服务的是
  真实存在的业务场景还是投机性能力面;判据要求**实测而非推断**(谁在写这个键、谁在读
  这个能力、示例应用与真实部署里的用法),「读起来像有用」不作数;无拉动的声明面按
  **implementation-first** 处置(收窄声明使 `declared = enforced`,或让词表随未来实现
  回归),而不是为声明补实现;**已发布但零消费的能力不因沉没成本获得豁免**。并写明这条
  轴会**改变结论**:技术形状相同的两个发现可以仅凭这条轴得出相反裁决(一个因无业务拉动
  退役,另一个因真实应用自证方向而裁「响亮拒绝而非退役」),只看后两条轴会得出同一个
  答案。原两轴(项目长远合理性、防 AI 写代码/写元数据 app 犯错)**原文保留**,仅编号后
  移为 Axis ② / ③。
- **泛化纪律**:去掉内部版绑定的「我们是一个创业项目」自我描述,也不带入本仓专属先例
  单号 —— 发布版是 project-agnostic 的,把我们的处境写进别人的决策机器,会让安装方的
  PM agent 按错误前提做决策。**扩张姿态改由安装方项目自己的 conventions 文件声明**
  (核心面尚在成形时从紧、平台面稳定后放宽),接进该 skill 既有的 config-over-hardcoding
  机制:`conventionsFile` 配置项说明与「Adapting this loop to your project」表格各加
  一处,与分支命名、release-note 产物、测试命令走同一条覆写路径。
- 全文 7 处两轴措辞逐处升三轴:分诊一节的 `the deep two-axis`、升级流程的
  `the two fixed axes below`、`#### The two-axis decision frame (binding)` 标题、
  框架首句与收尾句的 `**both** axes`,以及**嵌入的 dev-agent 模板**里的
  `Analyze every option on two fixed axes:` 与 `Justify your recommendation on both
  axes`。模板那两处是关键:PM 按三轴呈报而开发 agent 按两轴上报,业务轴每次都要 PM 事后
  补。文中仅保留一处 `the other two axes`,指的是 Axis ② / ③ 这「另外两条」,是三轴语境
  下的正确表述。
- `metadata.version` 1.0 → 1.1:已安装 1.0 的第三方据此看到这是一次内容修订。

**空 frontmatter 是刻意的,不是遗漏**,沿 #4607 发布 PR 与 #5130 的同一先例:`skills/`
不随任何 npm 包发布(没有 package 的 `files` 含它,分发路径是 `npx skills add` 直读
仓库),因此没有包可署名 —— 署一个包会凭空造出一条其发布物未变更的 release 记录,并把
PM skill 的说明塞进那个包的 CHANGELOG。本次变更对**装这份 skill 的人**可见,但不发布
任何包。
