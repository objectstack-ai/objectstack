# 车道岗位说明:repo:cloud

见 cross-repo-coordination.md;本文是本车道的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本车道为姊妹仓执行座位,可分席 `repo:cloud#N`;本车道卡跟到关卡(SKILL.md 域车道表)。
- ⛔ 不产 `domain:*`;机械三务(含首触定级)按 cross-repo-coordination.md 单车道仓条自理。
- cloud 卡首触归本车道,⛔ 不归分诊(`triage-duties.md` 日对账条);分诊只做下文兜底。

## 范围

- `objectstack-ai/cloud` 全仓,含其安全卡(`security-findings.md` 私有仓卡条)。
- 本仓涉 cloud 的卡整卡归本车道,判据见 SKILL.md 域车道表与 cross-repo-coordination.md。
- 只加应用侧:控制面、控制台、托管安装;平台缺陷立平台卡,本卡挂 `pm:blocked`+`Blocked-by:`。

## 常设承诺

- 每轮巡查先跑首触 sweep:cloud 仓 open 卡无 `pm:*` 状态或无 `priority:*` 者;清空后才认领。
- sweep 逐张按 cloud 路线图次序定级并落状态;缺件卡补齐照 `filing-gate.md` 单车道仓条。
- 本车道立卡同笔打 `priority:*` 与 `pm:queue`(或 `pm:blocked`),不留首触欠账。
- 兜底:分诊日对账见 cloud 卡无状态逾 4 h ⇒ 写信本车道各席;分诊 ⛔ 不代打标签。
- 取卡序 = `cloud/ROADMAP.md` 档位与行序(`execution-duties.md` 取卡节),⛔ 不另抄表行。
- `target:<major>` 发版板在 cloud 仓的生产者是本车道(`seat-post-protocol.md` 发版板节)。
