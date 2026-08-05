---
'@objectstack/service-automation': patch
---

自动化引擎:嵌入式 host 从未调用 `sealNodeTypeVocabulary()` 时,首次执行 flow 会告警一次(#4792)

#4771 把 ADR-0018 的节点类型校验从 `registerFlow` 挪到了 `sealNodeTypeVocabulary()`。`AutomationServicePlugin` 在 `kernel:bootstrapped` 自动 seal,插件路径不受影响;但自己 `new AutomationEngine()` 且从不 seal 的嵌入式 host 就彻底拿不到这项校验,而且完全静默 —— 只有读过 changeset 的人才知道要补一行调用。现在这类 host 在第一次真正执行 flow 时会得到一条 `warn`,说明丢了什么、以及要调用哪个方法。

- 首次执行是最早既安全又必然到达的时点:正在跑 flow 的 host 显然已经装配完毕(否则这次执行本身就会 `NO_EXECUTOR` 失败)。
- **每个引擎实例一次**,不是每进程一次 —— 一个 host 建了多个引擎(按租户/环境各一个是常见形态)就是在每个上都漏了这次调用。
- 告警只报「缺了这次调用」这个关于 host 的事实,**不报**未知节点类型的审计结果:未 seal 的引擎其词汇表按契约仍可增长,在那里断言「某类型没有执行器」正是 #4771 删掉的那种会被本次启动反驳的判断。需要审计结果又不想封闭词汇表的 host 用只读的 `getUnknownNodeTypeAudit()`。
- 也**不会**顺带自动 seal:「谁决定词汇表封闭」只能有一个答案(host)。而且 seal 之后 `registerFlow` 会转为即时校验,自动 seal 会让「先执行、后注册插件执行器」(ADR-0018 允许)的嵌入式 host 开始收到 #4771 那种误报。

走 `AutomationServicePlugin` 的部署与已显式调用过 `sealNodeTypeVocabulary()` 的 host 都不会多打任何日志(两条哨兵测试守着)。
