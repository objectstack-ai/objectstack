# 协调者(Coordinator;维护者本机的专题负责人 epic lead 另是一席,⛔ 不用本文)

它不是 `domain:*` 席:不坐座位贴、不认领卡;席位线程照 SKILL.md 与 `execution-duties.md` 跑循环。

## 一、车道归属登记在座位贴(coordinator 开席位线程前读;席位线程坐席时读)

- 项目管哪些车道只由项目指令声明;每条车道开一个席位线程,坐该车道空着的座位贴。
- 席位线程在贴的说明段写「由 X 账户的项目负责」;贴协议与互斥照 `seat-lifecycle.md`。
- 一车道归一项目:座位贴 🟢 写他账号 ⇒ 车道已有主;仲裁者是座位贴,⛔ 不是项目记忆。
- ⛔ 不坐别席,另一项目在飞卡由其席跟完;维护者指令行改写 ⇒ 按 `project-forms.md` 接管。
- L2 积压 ⇒ 自开一条 `l2-review` 席位线程,⛔ 不先问维护者,开后在项目聊天说一句。
- 积压 = 就绪 head 等 L2 记录逾约 30 分钟,或在座审核席人均排队逾约 3 个 head。
- 新席坐空座、开信箱、按认领分行;队列排空即签退加开席,⛔ 不留闲席;用量墙照第六节。

## 二、跨车道取卡(coordinator 每次唤醒读)

- 取卡面 = 各车道 open 卡:p0/p1 先,再点名 area 或子专题的下一张;判据照 `execution-duties.md`。
- 维护者只说改级 ⇒ 只落级,评论照 `filing-gate.md` 引原话;⛔ 不借此开线程,照取卡全序。
- 每张卡交其车道的席位线程;车道无席位线程而座位贴空着 ⇒ 先开席位线程再交卡。
- 维护者 ⛔ 不逐卡点名车道:车道读卡的 `domain:*`;S/M 分流见 `dispatch-runbook.md` 卡线程节。

## 三、全项目一个上限,p1 先(coordinator 调度读;席位交候选时读)

- 卡线程上限全项目一个数,由维护者按项目言明;未言明取各席 `batch` 之和。
- 席位攒批交候选,一线程一行:卡/PR、标题、级别、effort、汇报区、要读文件、续做分支。
- 派发令全文随行;⛔ 不等自己的槽位;区与卡线程 ⛔ 不直找 coordinator,经席位。
- coordinator 一批开完、一次回全部 id:p0/p1 先,余照点名次序;满即排队,交回或合入即释放。
- 有空槽即开;先后只认卡上 `Blocked-by:` 与席位串行队,⛔ 不自排、不逐张等。
- 槽位只算在建的线程:等人(授权批准、决策卡)或等席位 L1/L2 审核的卡线程不占槽。
- S 卡的席内子代理只计该席 `batch`,不计本上限。

## 四、effort 与档位按难度(coordinator 开线程时读;席位请线程时读)

- 档位与 effort 的定法住 `execution-duties.md` 派发节:档位引 `dispatch-gates --tier`,effort 按卡难度。
- 改协议语义面卡恒 `CONTRACT_REVIEW_TIER`,⛔ 不抄模型名;隔离子代理照 `--brief-template` L2 审核。

## 五、卡线程的 `needs_decision`(coordinator 收到时读;席位写分析时读)

- 规则一处:`lanes/director.md` 与 `dispatch-runbook.md` 卡线程节;本文只指不抄。
- 等裁的卡线程不占槽(见第三节);裁决记录 = 卡上裁决评论,⛔ 不落项目文件或记忆。

## 六、额度压力(coordinator 每次开线程前读)

- 账号用量墙将近(墙信号与重置读法见 `seat-lifecycle.md`)⇒ 停开新卡线程,在飞的跑完。
- 向维护者说一次即可,⛔ 不逐线程重复;墙过后照常。

## 七、语言与汇报(coordinator 与席位线程皆读)

- 项目内对维护者用维护者的语言;GitHub 内容英文,照 SKILL.md 全体座位不变量。
- 向维护者报任一 PR 状态前同轮重读:merged、draft、auto_merge、在队、reviews、`mergeable_state`。
- 无 APPROVED 也可能已被 ready 入队 ⇒ ⛔ 单读 reviews;已办即删;`dirty` ⇒ 退回线程先合 main。
