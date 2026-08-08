---
'@objectstack/objectql': patch
'@objectstack/lint': patch
---

fix(objectql,lint): 服务端为 `requiredWhen` 绑定 parent 作用域,并把构建期硬闸扩到同一格

`readonlyWhen` 的 parent 作用域洞在 #4889 已经补上;同一个字段上、由同一个求值器处理的
`requiredWhen` 隔一个槽位还漏着。detail 对象上声明的
``requiredWhen: P`parent.status == 'sent'` `` ——「表头一旦 Sent,每一行都必须填写说明」——
只在内联表格里被求值,服务端从来只绑 `record` / `previous`,谓词直接 fault 走 fail-open
分支,写入带着空字段落库,API 还回 200。

注意它与 #4889 是**镜像**而不是同一种故障:`readonlyWhen` fail-open 是**写进了本该冻结的字段**,
`requiredWhen` fail-open 是**收下了本该被拒的记录**。两者都是同一处声明点上的 `declared ≠ enforced`
(PD #10)。

本次按维护者 2026-08-06 的裁决落 A + C 两条,**刻意不对称于 #4889**:

- **A —— 绑作用域,求值语义不动。** 引擎用 #4889 已经建好的
  `resolveMasterDetailParent(s)` 解析主表头行并传入求值器,insert / 单 id update /
  bulk update 三个调用点都覆盖。**不可求值仍然 fail-open**(记日志、跳过、放行):
  表头此刻读不到就 422 掉一次本来合法的写入,比 `readonlyWhen` 那边「拒掉一个字段」响得多。
  这是 issue 的 B 案,明确不做,留给 ADR-0058 D5 下一次复审。
- **C —— 改在构建期拦。** `@objectstack/lint` 的 parent 作用域闸原本只盖 `readonlyWhen`,
  现在同样判 `requiredWhen`:对象没有恰好一个 `master_detail` 关系时,`parent` 不是元数据
  陈述过的事实,声明直接判 error。两格共用同一个闸,但**报错文案不同** —— 两边运行时的失败
  方向相反(`readonlyWhen` fail-closed ⇒ 字段永远写不进;`requiredWhen` fail-open ⇒ 要求
  永远不生效),文案指错了就等于给了相反的修法。运行时敢保持 fail-open,正是因为这道闸
  拦住了那条会无声烂掉的声明。

同一次改动里补了 ADR-0113 非回归判定在 parent 作用域下的正确输入:「存量行本来就违规吗」问的是
**写入前**那一行的状态,而它挂的是**旧**表头。改挂(repoint)到另一个主表时,若把落地表头也
喂给这个前置判定,就会把「移到 Sent 表头之下」读成既有违规而放行 —— 正是本 issue 要堵的那个
收下动作,只是换了个入口。因此求值器新增 `previousParent`,仅在载荷确实改挂时由引擎解析,
其余情况沿用同一行、不多付一次读。

对象级 `script` / `cross_field` 规则共用这个求值调用点,自 #4649 起对不可求值谓词是
**fail-closed**,本次**没有**给它们绑新根 —— 绑了会把它们今天拒掉的写入翻成接受。这条由 pin
测试钉住(#4972 当初把本改动挡在范围外,就是为了这个爆炸半径)。

仓内暂无 app 声明 parent 作用域的 `requiredWhen`(showcase 的 invoice line 用的是行作用域的
`record.quantity >= 100`),所以这是补潜伏缺口,不改变任何现有 app 的写入行为。
