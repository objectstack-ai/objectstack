---
'@objectstack/service-automation': major
'@objectstack/spec': major
'@objectstack/runtime': patch
---

feat(automation)!: 未声明 `resumeAuthority` 的暂停节点改为 fail-closed —— 通用 resume 路由从「默认开门」变成「显式 `'any'` 才开门」(#5561 第二步)

<!-- adr-0087: registered action-descriptor-resume-authority-default-flip -->

**BREAKING**(仅影响注册了暂停型节点、且描述符未声明 `resumeAuthority` 的执行器 ——
本仓内为零)。`AutomationEngine.resolveResumeAuthority` 对缺省值的解析由 `'any'` 翻成
`'service'`:一个从未声明「谁可以续跑它产生的暂停」的节点类型,其暂停在通用路由
`POST /automation/:name/runs/:runId/resume` 上被拒绝(`PERMISSION_DENIED` / 403),
直到它的描述符把话说出来。通用 resume 门从此是描述符**主动 opt-in** 的一扇门,不是每个
暂停节点**继承**来的默认。

这是 ADR-0044 2026-07-28 修正案里「记录但刻意不在此建造」的第一项,分两步落地。
第一步(#5561 / PR #5725,非 breaking)把 `ActionDescriptorSchema.resumeAuthority`
的 Zod `.default('any')` 摘成 `.optional()`。那个默认值的问题不只是取值不对,而是它
**抹掉了事实**:`defineActionDescriptor` 在任何消费者看到对象之前就把 key 填上了,于是
「作者选了 `'any'`」和「作者从没考虑过」parse 出逐字节相同的描述符,遗漏根本无法被观测。
默认值摘掉之后「缺省」才重新可见,注册告警与 `check:resume-authority-declared` CI 门也
才写得出来。第二步就是本次改动:让缺省真正意味着 fail-closed。

### 为什么往「拒绝」这个方向猜

两种猜错的代价不对称,这就是全部理由。猜 `'any'`,会让一次 resume 走过一个**没有任何
记录的决策**,而且悄无声息 —— #3823 就是这么发生的:ADR-0044 把审批的 `revise` 边指向
了通用 `wait`,`wait` 本身声明 `'any'` 完全正确,而站在「服务持有」位置上的那个暂停
继承了一个没人选过的 fail-open 值;实测代价是一次未经审计的重新提交,外加一个被销毁的
远程 run。猜 `'service'`,则是返回一次拒绝,并把修好它的那一行原样交回作者手里。
两种错误里只有一种能被犯错的人自己发现。

### 迁移:`resumeAuthority` 未声明 → 显式声明(一行)

只有**注册暂停型节点的插件作者**需要动手,处方是在描述符上加一行:

```ts
// FROM —— 依赖旧默认值,暂停可被通用路由续跑
defineActionDescriptor({
  type: 'my_pause', version: '1.0.0', name: 'My Pause',
  supportsPause: true,
});

// TO —— 通用路由确实是这个暂停的正门时(screen 式收集输入、signal wait 式外部生产者)
defineActionDescriptor({
  type: 'my_pause', version: '1.0.0', name: 'My Pause',
  supportsPause: true, resumeAuthority: 'any',
});

// TO —— 续跑是「某个服务必须先授权并记录的决策」的尾巴时
defineActionDescriptor({
  type: 'my_pause', version: '1.0.0', name: 'My Pause',
  supportsPause: true, resumeAuthority: 'service',
});
```

两个值都被接受,**只有沉默改变了含义**。三条运行时通道会指着同一件事说话:注册时按类型
去重的一次告警、resume 被拒时那条点名缺省字段并给出处方的错误消息,以及本仓自有执行器的
`check:resume-authority-declared` CI 门。

⚠️ `supportsPause` 本身是一个没有任何执行路径强制的声明(#5703)—— run 会暂停是因为
`execute()` 返回了 `suspend: true`。所以一个「会暂停但把 `supportsPause` 留成 false」
的执行器,注册告警与 CI 门**都看不见它**,只有 resume 时的拒绝消息会带上同一份处方。
请按同一条规则手工核一遍这类执行器。

### 仓内零行为变化

在册的六个暂停类型全部已显式声明:`screen` / `wait` / `subflow` / `map` 声明 `'any'`
(第一步补齐),`approval` / `approval_revise` 声明 `'service'`。解析器测试与端到端测试
都把这份清单和它们的解析结果一起断言 —— 一个只靠「什么都没注册」而变绿的零点名,和真的
零点名是两回事。

`@objectstack/runtime` 只是注释与路由账本(`route-ledger`)的记述同步,无行为改动。
