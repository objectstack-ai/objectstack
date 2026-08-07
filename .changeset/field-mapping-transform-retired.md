---
'@objectstack/spec': major
---

按 ADR-0049 enforce-or-remove 退役字段映射的 `transform` 键与整个 `FieldMappingTransform` 联合(#5552)

`shared/FieldMappingSchema.transform` 由一个五成员判别联合承载(`constant` / `cast` /
`lookup` / `javascript` / `map`),并被两个 `.extend()` 它的 schema 继承 ——
`integration/ConnectorFieldMapping` 与 `data/ExternalFieldMapping`。**五个成员没有一个
存在执行者**:`fieldMappings` 只在 `packages/spec` 自己的 schema 和测试里被拼写过,四个
connector 包、automation engine、REST 与 objectui 都不读它,全仓也没有任何代码对
`transform.type` 分支。这是完整意义上的 declared-but-unenforced(Prime Directive #10),
不只是报单所指的那一个成员。

`javascript` 成员是让缺口显形的那一个:它的 `.describe()` 推荐 `dialect: "js"`,而 `js`
方言早在 #3278(ADR-0058 addendum)就退役了 —— 于是文档教的信封写法被枚举直接拒收,唯一
能通过 parse 的裸字符串又被 `ExpressionInputSchema` 包成 `dialect: 'cel'`,而同一行给出的
例子 `value.toUpperCase()` 作为 CEL 并不成立。三处互相打架,且三处底下都没有实现。

## FROM → TO

| 你现在写的 | 改成 |
|:---|:---|
| `connector.fieldMappings[].transform: { type: 'cast', targetType: 'string' }` | 删除该键 |
| `connector.fieldMappings[].transform: { type: 'javascript', expression: '…' }` | 删除该键 |
| `externalLookup.fieldMappings[].transform: { … }` | 删除该键 |

**一句话修复:删掉 `transform` 键。** 没有等价替换成员 —— L3 connector 的字段映射只做
`source` → `target` 的搬运,从来没有做过值变换。真正要做值变换的地方有两个,都是活的:

- **导入映射** `mapping.fieldMapping[].transform` —— 一个扁平字符串枚举
  (`none`/`constant`/`map`/`split`/`join`/`lookup`,配置放在 `params`),由 REST 导入
  路径逐行执行。注意它对自己的 `javascript` 值是**直接 400 拒收**(服务端没有沙箱),
  而不是解析通过然后什么都不做。
- **ETL transformation 步骤**,面向多源、多阶段的复杂变换。

存量元数据无需手改:`os migrate meta --from 16` 会自动重写(ADR-0087 D2 conversion
`field-mapping-transform-removed`);`sys_metadata` 里的存量行在 rehydration 时由
`applyConversionsToStoredItem` 重放同一条转换。直接 parse 会命中 `retiredKey()` 墓碑,
错误信息本身就是上面这段处方。

## 退役套件

- **Schema**:`shared/mapping.zod.ts` 上 `transform` 改为 `retiredKey()` 墓碑(该 schema
  与两个 extender 都是普通 `z.object`,直接删键会被静默 strip —— 用另一个静默 no-op 替换
  原来的静默 no-op);`FieldMappingTransformSchema` / `FieldMappingTransform` 两个导出随键
  一起删除(无其他消费者的值 schema 会被后来者读成一项能力,#3950)。
- **D2 conversion**:`field-mapping-transform-removed`,`toMajor: 17`,
  `retiredFromLoadPath: true`,重写 `connectors[].fieldMappings[]`。
- **D3 chain step**:接入 `MIGRATIONS_BY_MAJOR[17].conversionIds` 并扩写 rationale。
- **退役登记**:`RETIRED_KEYS_BY_MAJOR[17]` 收三个键(一个墓碑 → 三处可作者化拼写,因为
  两个 extender 各自复制了该属性);`RETIRED_DEFS_BY_MAJOR[17]` 收
  `shared/FieldMappingTransform`。这是自 #4659 / #4725 建表以来两张表的首批条目。
- **生成物**:`authorable-surface.json` 三行转 `[RETIRED]`;`api-surface.json` −2;
  `json-schema.manifest.json` −1 def;spec-changes / upgrade-guide / references 重生成。

**未受影响**:`ExpressionDialect` 本体、`ExternalLookup.transform`(lookup 级
request/response 管线,与字段映射无关)、以及上面那个活着的导入映射 `transform`。
