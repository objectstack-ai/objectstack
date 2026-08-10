---
"@objectstack/plugin-audit": patch
---

perf(plugin-audit): 审计跳过名单上到注册面,平台内部表不再为白读买单 (#5860)

plugin-audit 的五个写入注册(`captureBefore` 的 `beforeUpdate`/`beforeDelete`,
`writeAudit` 的 `afterInsert`/`afterUpdate`/`afterDelete`)此前**不带任何对象范围**,
因而在引擎眼里全部是全局 hook。"哪些对象要审计"这个知识一直存在 —— `SKIP_OBJECTS`
—— 但它停在 handler 内部的早退里,注册面上看不见。于是按对象计算需求的两道门只能保守
判真:#5284 的单 id `update()` 前置行门、#5038 的批量门,对 `sys_job_queue`、
`sys_job_run`、`sys_upload_session`、`ai_traces` 这些表同样判"需要",每次写入白读一遍
行集,而 handler 的第一行就返回了。放大倍数最刺眼的是 `sys_job_queue`:每条队列消息
至少三次写入(publish / lease / terminal),自 #5160 起每封邮件都走它。

现在这五个注册带上 `excludeObjects`(#5928 / PR #6575 落地的声明式排除面),名单由
`SKIP_OBJECTS` **派生**而非重抄,两个面不可能各自漂移。handler 内的早退**保留**为纵深
防御 —— 它护住的是每一个非 hook 调用方 —— 所以审计写入的行为逐位守恒,变的只是引擎
能看见的范围。

**为什么是减法而不是允许列表**:对象全集在运行期是开放的。`/meta` PUT 会把新对象注册进
运行中的引擎,而 `SchemaRegistry.registerObject` 不发任何事件,插件侧没有可订阅的通道去
追平一份枚举出来的名单 —— 那样的名单会在启动时冻结,此后新建的对象**静默**不被审计,对
合规插件是无声的倒退。排除面没有这个失败模式:安装时没人听说过的对象默认被审计。这条性质
已单独钉在测试里。

顺带,`writeCommentMentions` 收为 `{ object: 'sys_comment' }` —— 它的 handler 第一行本就
拒绝其他对象,这是一个封闭的单名允许列表,现有契约一直表达得了。行为不变,但它不再出现在
其他任何对象的 `afterInsert` 需求里。
