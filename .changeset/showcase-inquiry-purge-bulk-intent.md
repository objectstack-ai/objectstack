---
---

fix(showcase): `showcase_inquiry_purge` 的谓词删除节点声明 `multi: true`（#5225）

`examples/app-showcase/src/automation/flows/index.ts` 里 `InquiryPurgeFlow` 的
`purge` 节点按谓词 `{ status: 'closed' }` 批量删除,却没有声明批量意图。数据引擎只
在 `filter` 用标量 `id` 点名一行时才接受无 `options.multi` 的写入,于是这条流的每
一次运行都在该节点失败:

```
Node 'purge' failed: delete_record(showcase_inquiry) failed:
Delete requires an ID or options.multi=true
```

`acted: 0` —— 声明式端点 `POST /api/v1/apps/showcase/inquiries/purge` 与内建触发
路由 `POST /api/v1/automation/showcase_inquiry_purge/trigger` 两条路径同一个签名。
也就是说 `src/coverage.ts` 声称由本流演示的 CRUD 四件套的 delete 半边,从写下的那
天起就是 declared ≠ enforced(PD #10),直到 #5112 的真机 boot 探针打到它才浮出来。

修法是**补一个声明**,不是改写流程:在 #5393(PR #5485)之前,节点 config 上根本
不存在任何批量意图的拼写,这正是第 3 轮分诊拒绝 get→loop→逐 id 删的原因(PD #5 的
workaround)。`multi` 落地之后,一行声明就是长期正确的形状。

⚠️ `filter` 在这里不是可有可无的修饰:`multi: true` 而 `filter` 缺失或为空 = 声明
式整表删除。本节点是「批量意图 + 谓词边界」的参考样本,也是 #5482 authoring 期
lint 规则未来的「必须零告警」验收样本。

新增 `examples/app-showcase/test/predicate-write-bulk-intent.test.ts`:把上述规则
陈述为覆盖**全部** `delete_record` / `update_record` 节点的双向不变量(谓词写必须
声明 `multi: true`;`multi: true` 必须带非空 `filter`),并深走 ADR-0031 结构化容器
——`showcase_task_crm_sync` 的 `catch` 区里就藏着一个 `update_record`,只扫顶层
`nodes` 会漏掉它。

仅改示例应用(`examples/app-showcase` 为 private 包),不发布任何包。
