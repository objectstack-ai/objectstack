---
"@objectstack/lint": minor
---

feat(lint): `flow-trigger-unroutable` 收紧到"省略"形态 —— 无 `triggerType` 的 `record_change` flow 同样报错 (#7215)

`flow-trigger-unroutable`(#6637)此前只判"矛盾"形态:`config.triggerType` **存在**但引擎路由不到
任何 trigger(如 `triggerType: 'onCreate'`)。本次按 #7215(维护者裁定,方案一:现在就收紧)扩展到
"省略"形态:`type: 'record_change'` 且**完全没有** `triggerType` 这个键。两种写法在运行期是同一个
缺陷 —— `AutomationEngine.resolveTriggerBinding` 对两者走的是同一条回退链,最终都返回
`undefined`,flow 被静默降级为手动 flow,连 `getTriggerBindingAudit` 都因为"看起来像手动/screen
flow"而跳过它,不会在任何地方点名。因此复用同一个 rule id 与同一档 severity(`error`),而不是新开
一条 —— 这是同一个缺陷的两种写法,不是两个缺陷。

## 为什么现在收紧,而不是 #6637 立规则时就收紧

#6637 立规则时,语料测出一个真实的省略实例:`examples/app-todo` 的 `TaskCompletionFlow`。当时把它
判死,等于在一个已发布的示例 app 上,对该 app 的语义意图下一个未经确认的猜测,所以判据当时要求
`triggerType` 这个 key 必须**存在**,省略形态被单独立卡搁置(#7041 item 2)。#7039 已经把那个实例
修好 —— `TaskCompletionFlow` 现在显式声明 `triggerType: 'record-after-update'` 并正确路由 ——
语料窗口转绿,#7215 因此裁定:一个零命中规则,只要缺陷类别有过真实实例(学费已经交过)、oracle 是
封闭的(能不能路由是引擎自己的硬编码链,不是猜测)、当下语料对它是绿的(收紧不产生 churn)、
severity 与危害匹配,就应当趁窗口开着落地,而不是等下一个省略实例出现、把落地成本重新推高。

## 语料计数(先测,后收紧)

用生产入口(`validateFlowTriggerReadiness`)跑过本仓 `examples/`、`apps/`、`packages/` 下按内容
搜索到的**每一个** `type: 'record_change'` 真实 flow 定义 —— 全库只有两个:
`examples/app-todo/src/flows/task.flow.ts`(`TaskCompletionFlow`)与
`examples/app-showcase/src/automation/flows/index.ts`(`UrgentTaskAlertFlow`),两者都已显式声明
`triggerType`。**省略实例命中数为 0**。收紧后的判据在整棵树上是绿的:不产生任何新的 baseline 条目,
不需要修任何示例 app。

## 判据里没有变的部分

"这条规则不判的第二种形态"维持原样:一个 `record_change` flow 若同时声明了引擎**确实**会路由的东西
(`config.schedule`、`triggerType: 'api'`、`config.timeRelative` 对象),它会按错误的 trigger 绑定
并触发 —— 这是一个不同的缺陷("绑错"而不是"没绑上"),仍然不是这条规则要判的,`routesToSomeTrigger`
分支字符对字符保持不变。

`validate-flow-trigger-readiness.test.ts` 里原先钉住"省略形态故意不判"的边界测试(其自身注释写明
"收紧是必须删掉这个测试的有意行为,不是顺手带过的副作用")已按 #7215 删除,替换为覆盖"省略形态触发"、
"省略但有其它路由 sibling 时不触发"、"非 `record_change` 类型的 flow 即使省略 `triggerType` 也不
触发"的新用例。
