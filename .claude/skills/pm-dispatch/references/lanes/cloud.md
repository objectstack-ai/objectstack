# 车道岗位说明:repo:cloud

见 cross-repo-coordination.md;本文是本车道的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本车道为单车道仓执行座位,可分席 `repo:cloud#N`:在 cloud 仓认领、派发、L1 审核、落地。
- cloud 卡首触归本车道,⛔ 不归分诊(`triage-duties.md` 日对账条);分诊只做下文兜底。
- 卡线程派发令住项目文件的 `pm-orders/cloud/seatN/` 目录。
- 范围:cloud 全仓;本仓 `domain:cloud`+`repo:cloud` 卡认领前先转入,转法与例外照多仓协调规则 1。

## 常设承诺

- 首触、定级、取卡序、企业版与安全卡规则见 cloud 仓 `docs/strategy/triage-rules.md` 与
  `docs/strategy/core-functions.md`;⛔ 本文件不抄。
- 卡阻于 objectstack 卡 ⇒ 挂 `pm:blocked` 或认领它的本车道席敲阻塞卡车道席 `Request: assist`。
- 阻塞卡未认领或停车改敲 `triage#1`;每张阻塞卡一次,轮记列明敲了谁;不限级(维护者令)。
- 兜底:分诊日对账见 cloud 卡无状态逾 4 h ⇒ 写信本车道各席;分诊 ⛔ 不代打标签。
- 发版板(窗内升 `priority:p0`)在 cloud 仓的生产者是本车道(`seat-post-protocol.md` 发版板节)。
