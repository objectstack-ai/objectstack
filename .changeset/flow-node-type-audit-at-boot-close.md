---
"@objectstack/service-automation": minor
"@objectstack/plugin-approvals": patch
---

fix(automation,approvals): 节点类型校验推迟到插件贡献完成之后 —— approval flow 不再被误报"运行时会失败" (#4771)

showcase 每次冷启都打印 8 条断言:这些 flow "will fail at execution time"。8 条全是假的。
`AutomationServicePlugin.start()` 从 ObjectQL registry 拉起 flow 并**当场**校验节点类型,而
`ApprovalsServicePlugin.start()` 在 0.8 秒后才注册 `approval` 执行器 —— 校验器在词汇表还没
成型的时候就下了结论。

真正的代价不是噪音,是信号丢失:**真的没装 approvals 插件**的部署会得到一模一样的 8 条告警,
所以这条 warn 无法区分"健康"和"坏掉",信噪比为 0。

ADR-0018 明确把节点词汇表定义为**开放、可运行时扩展**的(插件通过
`registerNodeExecutor(type)` 贡献类型)。因此校验只在词汇表**封闭**的那一刻才成立:

- `AutomationEngine.sealNodeTypeVocabulary()` —— 宣告词汇表封闭,对**所有**已注册 flow 跑一次
  权威校验,每个有问题的 flow warn 一条。`AutomationServicePlugin` 在 `kernel:bootstrapped`
  调用它(严格晚于每个插件的 `start()` 和每个 `kernel:ready` handler —— 本插件自己的
  `kernel:ready` 还会再注册一批 flow,别的插件也可能在它的 `kernel:ready` 里贡献执行器)。
- `AutomationEngine.getUnknownNodeTypeAudit(): UnknownNodeTypeAuditEntry[]` —— 同一发现的
  **状态**形态,供 host(CLI 启动摘要、健康检查)直接读,而不是去 grep 日志。与
  `getTriggerBindingAudit()` 同一套路。
- 封闭之后 `registerFlow` **恢复即时告警**:Studio 发布 / dev reload 进正在运行的服务器时,
  词汇表确实是完整的,那句断言此时为真。所以这是时序修复,不是把告警静音。

告警文案也随之改成它现在能承诺的事:"Every plugin has started, so nothing will register them
now — these nodes fail at execution time with NO_EXECUTOR",并给出补救动作。

一并修掉同一缺陷类的另一半:`ApprovalsServicePlugin` 在**拿不到 automation 引擎**时,把
"`approval` 节点没注册"记成 `info` —— 而 dev 的默认日志级别是 `warn`,于是**真降级发生时反而
看不见**(#4632:静默降级必须响亮)。现在是 `warn`,写明后果(该部署里每个 ADR-0019 approval
flow 都会以 NO_EXECUTOR 失败)和补救(装 `@objectstack/service-automation`)。`catch` 同时收窄
到"服务查找"这一步,`registerApprovalNode` 内部真出错时会以自己的身份抛出,而不再被贴上
"no automation engine" 的错误标签;`automation` 服务存在但不接受节点执行器的分支从前**一条日志
都不打**,现在同样 warn。

**嵌入式 host 注意**:直接 `new AutomationEngine()` 而不经过 `AutomationServicePlugin` 的宿主,
需要在自己的插件都装好之后调用一次 `sealNodeTypeVocabulary()`,才能拿到这条告警(以及之后的
即时校验)。
