---
"@objectstack/objectql": patch
---

perf(objectql): `update()` 的单 id 前置行读取改为按对象判定需求(#5284)

单记录 `update()` 在写入前会读一次「前置行」(`driver.findOne`),用于对象校验规则、
`readonlyWhen` 剥离、`hookContext.previous`,以及 roll-up 汇总的旧父记录重算。这道门
以前问的是 `this.hooks.get('afterUpdate').length > 0` —— **全部对象汇总在一起**的注册
列表。于是只要有**任意一个**对象被观察,平台上**每一个**对象的**每一次**单 id update 都
要多付一次数据库往返。同文件的批量路径早就按对象问同一个问题(`hasHooksFor`,#5038),
一个文件里存在两种精度。

现在按对象问,需求项恰好三条,全部是 `priorRecord` 在这条分支上的真实消费方:

- `needsPriorRecord(schema)` —— 对象校验规则(ADR-0020 的 state_machine / cross_field /
  script;PATCH 只带变更字段)以及它涵盖的 `readonlyWhen` / `requiredWhen` / 选项可见性;
- **本对象**存在 `afterUpdate` hook(`'*'` / 全局注册照样算,`hasHooksFor` 与
  `triggerHooks` 的过滤逻辑一致)—— 它的 handler 与声明式 `condition` 都读 `previous`;
- 本对象被某个 roll-up `summary` 聚合 —— `previous` 携带**旧的**父记录 id,子记录改挂父
  记录时要同时重算两个父。

**省下多少取决于 hook 怎么注册,不取决于有多少个。** 按对象注册的那些(record-change flow
trigger、plugin-sharing 的按规则重算、plugin-auth 的 `sys_user` 快照刷新、所有元数据编写的
hook)从此不再向邻居收税;而**完全不带 `object`** 的注册(plugin-audit 的 `writeAudit`、
service-storage 的文件引用回收)本来就会在每个对象上真的执行,所以在装了它们的部署里这道门
依然恒真、省不下读 —— 让这两处在注册面上表达它们 handler 里已经在做的过滤,是 #5846,不在
本次改动内。

**正确性保证不变。** `previous` 的语义、fail-loud 的形态(#4775:求不出值即拒绝,绝不
伪造 `{}`/`null`)、after-hook 的分发都与之前完全一致;有 `afterUpdate` 的对象付的读一次
不少。变的只是**没有任何消费方**的对象不再替别人付账。

顺带修掉一个此前只是**偶然**成立的行为:子记录改挂父记录时的「旧父重算」依赖的正是这次
读,而在一个没有任何 `afterUpdate` hook 的部署里它本来就不会发生(旧父的汇总值静默过期)。
roll-up 现在自己声明这项需求,不再靠别的对象的 hook 捎带。

`beforeUpdate` **不**计入这道门,这是它与 `delete()`(#5272)唯一不对称的地方,原因是两条
路径的读取时机不同:`delete()` 在派发 `beforeDelete` **之前**读前置行并绑定,before 阶段
因此是真实读者;`update()` 先派发 `beforeUpdate`(它还可能改写这次读要比对的 payload),
`hookContext.previous` 要到写入之后才绑定 —— 所以在这条路径上 `beforeUpdate` 无论门怎么
判都看不到 `previous`,计入它只会买一次没有读者的读。这一点由测试直接测量钉住。
