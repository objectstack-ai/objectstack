---
"@objectstack/lint": patch
---

fix(lint): 七个规则 id 常量补进 barrel —— 消费者不必再对字面量,并加一条测试面门禁 (#5648)

规则把自己的 id 写进每条 finding 的 `f.rule`,而那个字符串就是 `os lint --json` / `os validate` 递到消费者手上的东西:Studio 的 finding 渲染、下游按规则过滤/抑制、以及被授权元数据里的 `suppressWarnings: ['<rule-id>']`。规则文件为此导出同名常量,消费者本该比对常量而不是重敲 slug。

但 `packages/lint` 的 `package.json#exports` 只开 `"."` 与 `"./runtime"`(`tsup.config.ts` 的 entry 也只有这两个),所以**没进 barrel 就不是「不好取」,而是完全取不到** —— 没有深路径可绕,消费者唯一的退路正是那个常量本来要消灭的字符串字面量。

#5648 报的是其中一个(`FLOW_TRIGGER_UNKNOWN_EVENT`,#3427/#3457/#3481 三条规则共用的 id)。它要求的全量清查又翻出**六个**,散在五个规则文件、成因都远早于它:`APPROVAL_APPROVER_TYPE_UNSUPPORTED`、`SECURITY_FLS_UNQUALIFIED_KEY`、`FIELD_GROUP_SHADOWED`、`WIDGET_LEGACY_ANALYTICS_SHAPE`、`WIDGET_LEGACY_ANALYTICS_UNRENDERABLE`、`REACT_CHART_DRILLDOWN_INVALID`。其中 `WIDGET_LEGACY_ANALYTICS_SHAPE` 最能说明代价:规则打给用户的提示原话就是 `Suppress with suppressWarnings: ['widget-legacy-analytics-shape']`,即它主动教消费者用这个 id,却不让消费者拿到承载它的常量。

漏项之所以能一路静默:规则照常工作,它自己的单测**从规则文件直接 import 常量**(不经 barrel),于是唯一会发现的时刻是有人从包外去消费它。同一种一行漏项独立发生七次,不是「下次记牢」能解决的记性问题,而是缺一条判定。

**因此判定权移进 `packages/lint` 测试面**(`src/rule-id-barrel-exports.test.ts`):新增规则时忘了 barrel 那行,会在新规则自己的测试转绿的同一次 run 里失败。分层理由是这条不变量完全是包内的 —— 没有别处定义 lint 规则 id —— 且它要**真的 import** barrel 来核验取值,vitest 天然给得到;换成 `scripts/` 门禁则要么自己写一个 ES 解析器,要么先构建 dist,还会把反馈挪到另一个 job。

门禁按两类假绿反向设计:发现面是对 `src/` 的**文件系统读取**而非手写清单(新规则文件一存在即被枚举),并对 id 条数压一条下限,避免将来改坏提取式后在空集上「全绿」;两个 entry 虽是静态列出(全动态 import 无法可靠打包),但另有一条用例从 `package.json#exports` 与 `tsup.config.ts` **各自独立**推导出同一集合并比对,新增第三个 entry 若不登记就会红,而不是悄悄不被检查。

分类按**取值形状**而非发射位置判定:早先一版靠「定义旁边有 `rule: NAME`」来认,结果漏掉了经辅助函数参数发射的四个 `REACT_CHART_*` —— 恰好包含本次真实漏项之一。

仅新增导出面,无行为变化:任何既有 `f.rule` 字符串都没有改动,原先对字面量的消费者继续可用。
