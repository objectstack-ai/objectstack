---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(integration): 连接器动作可以声明它在上游做了什么，`connector_action` 因此能被计数 (#4395)

#4354 给每次流程运行加上了 `selected` / `acted` 汇总，断扫告警是
`selected > 0 AND acted = 0 AND unmeasured = 0`。`connector_action` 当时只能给出三个
答案里最诚实的那个：`ConnectorActionSchema` 只描述动作的**形状**（`key` / `label` /
`inputSchema` / `outputSchema`），对它究竟读还是写只字未提，所以 `crm.push_opportunity`
和 `crm.lookup_account` 在运行时完全无法区分。`acted: 0` 会低报一次 Salesforce 创建，
让每一条健康的连接器扫描都触发告警，操作员很快学会忽略它；`acted: 1` 会高报一次查询，
让告警永不触发——那正是 #4354 要修的原始 bug 换个楼层重演。于是执行器报
`metrics: { unmeasuredEffect: true }`，运行汇总记一笔 `unmeasured`。

诚实，但也是盲区：**任何走连接器的自动化流程都贡献不出任何信号**——既无法证明自己
干过活，也无法在停止干活时被标记出来。

**现在动作可以自己声明。** `ConnectorActionSchema` 新增可选的 `effect`：

```ts
actions: [
  { key: 'push_opportunity', label: 'Push Opportunity', effect: 'write' },
  { key: 'lookup_account',   label: 'Lookup Account',   effect: 'read'  },
  { key: 'legacy_action',    label: 'Legacy' },  // 不声明 —— 行为完全不变
]
```

`connector_action` 执行器据此计数：声明 `write` 且派发成功 → `acted: 1`；声明 `read`
→ `acted: 0`（这是一个**真实测得的零**，不是耸肩，所以只做查询的流程重新落入断扫告警
的射程）；不声明 → 维持原样 `unmeasuredEffect`。派发失败时，声明 `write` 的动作回落为
不可计数而非零——处理器抛错时上游可能已经写成了，这与 `http` 节点对被拒绝的写请求做的
判断一致；声明 `read` 的动作则仍报 `acted: 0`，它无论如何都不可能改动任何东西。

声明是可选的，这是有意为之：**已有的连接器一个字都不用改，报告的内容与之前逐字相同**，
声明它是纯增益而不是一次迁移。`unmeasuredEffect` 的含义和消费者一个都没变，它现在是
兜底而不是唯一答案。

同一个声明也随 `ConnectorActionDescriptor` 一路送到设计器：`GET /api/v1/automation/connectors`
现在会带上 `effect`，作者在流程设计器里挑动作时，"这个会写" 是关于这次选择的事实。

`effect` 落在**可作者化的** `ConnectorActionSchema` 上，而不只是描述符接口上，因为那是
唯一可能的产地：`AutomationEngine.registerConnector` 存的是 `ConnectorSchema.parse(def)`
的结果，描述符是从这份 def 投影出来的。插件注册路径和 ADR-0097 声明式 materialization
路径都经过这一次 parse，所以两条路都能声明；只加在描述符上则永远无法被任何东西填充
（`ConnectorSchema` 是非 strict 的 `z.object`，改动前作者写下的 `effect` 会被静默丢弃）。

bulk 场景的**计数型**效果（一次动作报告它在上游碰了多少条记录）暂不做，等真实需求。
读/写这一刀才是解开告警的那一刀。
