# 协调者(Coordinator)

项目会话里开席位线程与卡线程、跨车道调度的那一席读本文;项目席见 `seat-lifecycle.md`。
它不是 `domain:*` 席:不坐座位贴、不认领卡;席位线程照 SKILL.md 与 `execution-duties.md` 跑循环。
项目指令只写「按仓库规则执行;管 X、Y 车道」;规则住本仓,⛔ 不在项目指令里转贴。
本文只写 coordinator 与席位线程之间的接口,七节各注明读者。

## 一、车道归属登记在座位贴(coordinator 开席位线程前读;席位线程坐席时读)

- 项目管哪些车道只由项目指令声明;每条车道开一个席位线程,坐该车道空着的座位贴。
- 席位线程在贴的说明段写「由 X 账户的项目负责」;贴协议与互斥照 `seat-lifecycle.md`。
- 一车道归一项目:座位贴 🟢 写他账号 ⇒ 车道已有主;仲裁者是座位贴,⛔ 不是项目记忆。
- ⛔ 不坐别席,另一项目在飞卡由其席跟完;维护者指令行改写 ⇒ 按 `project-forms.md` 接管。

## 二、跨车道取卡(coordinator 每次唤醒读)

- 取卡面 = 本项目各车道 open 的 `priority:p1`/`priority:p2` 卡;候选判据照 `execution-duties.md`。
- 每张卡交其车道的席位线程;车道无席位线程而座位贴空着 ⇒ 先开席位线程再交卡。
- 维护者 ⛔ 不逐卡点名车道:车道读卡的 `domain:*`;S/M 分流见 `dispatch-runbook.md` 卡线程节。

## 三、全项目一个上限,p1 先(coordinator 调度读;席位交候选时读)

- 卡线程上限全项目一个数,由维护者按项目言明;未言明取各席 `batch` 之和。
- 席位随时交候选:卡号、优先级、派发令全文、建议 effort;⛔ 不等自己的槽位。
- coordinator 排队开线程:p1 先于 p2,同级先到先开;满即排队,线程交回或 PR 合入即释放。
- 槽位只算在建的线程:等人(授权批准、决策卡)或等席位复核的卡线程不占槽。
- S 卡的席内子代理只计该席 `batch`,不计本上限。

## 四、effort 与档位按难度(coordinator 开线程时读;席位请线程时读)

- 档位与 effort 的定法住 `execution-duties.md` 派发节:档位引 `dispatch-gates --tier`,effort 按卡难度。
- 改技能(协议语义面)的卡恒契约复审档 `CONTRACT_REVIEW_TIER`;⛔ 不抄模型名。

## 五、卡线程的 `needs_decision`(coordinator 收到时读;席位写分析时读)

- 规则一处:`lanes/director.md` 与 `dispatch-runbook.md` 卡线程节;本文只指不抄。
- 席位写四维分析加推荐,卡并入决裁批次由维护者人工裁;⛔ 无裁决线程、无代裁。
- 等裁的卡线程不占槽(见第三节);裁决记录 = 卡上裁决评论,⛔ 不落项目文件或记忆。

## 六、额度压力(coordinator 每次开线程前读)

- 账号用量墙将近(墙信号与重置读法见 `seat-lifecycle.md`)⇒ 停开新卡线程,在飞的跑完。
- 向维护者说一次即可,⛔ 不逐线程重复;墙过后照常。

## 七、语言与汇报(coordinator 与席位线程皆读)

- 项目内对维护者用维护者的语言;GitHub 内容英文,照 SKILL.md 全体座位不变量。
- 向维护者报任一 PR 状态前同轮重读:merged、draft、auto_merge、在队、reviews、`mergeable_state`。
- 无 APPROVED 也可能已被 ready 入队 ⇒ ⛔ 单读 reviews;已办即删;`dirty` ⇒ 退回线程先合 main。
