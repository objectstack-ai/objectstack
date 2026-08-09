---
"@objectstack/mcp": patch
---

docs(mcp): `diagnoseEmptyRead` 的 TSDoc 更正一句被证伪的事实 (#6724)

`packages/mcp/src/mcp-server-runtime.ts` 里 `diagnoseEmptyRead` 的 TSDoc(#6055
由 PR #6051 落地)为"在空答案之后再跑一次仅取结论的探针,而不是把
`getObject` 换成 `getDiagnosed('object', name)`"这个设计选择给出了两条理由。
其中一条是事实陈述,而它是**错的**:

> `MetadataFacade.getObject`(objectql)返回 `registry.getObject(name)` —— a
> different shape from its own `get()`,因此等价关系在一般情况下不成立。

`SchemaRegistry.getItem` 对 `'object'` / `'objects'` 类型直接特判回
`getObject`,所以 facade 的 `get('object', n)` 走的是同一次查找;其后的
`item?.content ?? item` 解包是空操作 —— 合并后的 `ServiceObject` 根本没有
`content` 键。实测:命中时两个成员交回**同一个对象引用**,未命中时双方都是
`undefined`。三个已发布实现由 `packages/objectql/src/
metadata-service-getobject-equivalence.test.ts`(PR #6839)钉住,契约侧的
`IMetadataService.getObject` 自 PR #6723(#6505)起也写明了这条等价关系。

同一句话在 `mcp-server-runtime.metadata-outage.test.ts` 里被复述过一次,一并
更正。

仍然成立的那半条理由被保留:`getObject` 是 `IMetadataService` 自己的成员,
#6055 当时它并**没有**被文档化的等价关系,在消费端擅自假定一条正是 Prime
Directive #12 禁止的私有方言 —— 所以解析器当初没有被换掉。

**纯注释,零行为变化。** 这次更正**不**主张把解析器换成
`getDiagnosed('object', name)`:那是一次独立的判断,由接手的人按其自身利弊
去做,本次改动既不作出也不预设。
