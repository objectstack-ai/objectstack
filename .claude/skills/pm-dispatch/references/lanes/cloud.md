# 车道岗位说明:repo:cloud

见 cross-repo-coordination.md;本文是本车道的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本车道为单车道仓执行座位,可分席 `repo:cloud#N`:在 cloud 仓认领、派发、复核、落地。
- cloud 卡首触归本车道,⛔ 不归分诊(`triage-duties.md` 日对账条);分诊只做下文兜底。
- 卡线程派发令住项目文件的 `pm-orders/cloud/seatN/` 目录。

## 范围

- `objectstack-ai/cloud` 全仓,加本仓同挂 `domain:cloud`+`repo:cloud` 的卡(SKILL.md 域车道表)。

## 常设承诺

- 首触先行:每轮巡查先清 cloud 仓 open 卡中无 `pm:*` 状态或无 `priority:*` 者,清空后才认领。
- 逐张定级(判据照 `filing-gate.md`),并落 `pm:queue` 或 `pm:blocked`+`Blocked-by:`,或附理由关卡。
- 排除同 `triage-duties.md` 析取排除行与决策卡;缺件卡补齐照 `filing-gate.md` 单车道仓条。
- 立卡即完整:本车道立的每张卡建卡同笔带 `priority:*` 与 pm 状态,不留首触欠账。
- 取卡序:企业版卡按 `cloud/ROADMAP.md` 档位与行序(`execution-duties.md` 取卡节),⛔ 不抄表行。
- 企业版卡一律挂作 cloud 仓企业版父单的 sub-issue(该父单上的维护者裁决)。
- 优先级:新派发先取 p1/p2,再取 p3(维护者令)。
- 安全卡照常按级入队派修落地,⛔ 无常设停派(维护者令);余照 `security-findings.md` §6、§9。
- 卡阻于 objectstack 卡 ⇒ 挂 `pm:blocked` 或认领它的本车道席敲阻塞卡车道席 `Request: assist`。
- 阻塞卡未认领或停车改敲 `triage#1`;每张阻塞卡一次,轮记列明敲了谁;不限级(维护者令)。
- 兜底:分诊日对账见 cloud 卡无状态逾 4 h ⇒ 写信本车道各席;分诊 ⛔ 不代打标签。
- `target:<major>` 发版板在 cloud 仓的生产者是本车道(`seat-post-protocol.md` 发版板节)。
