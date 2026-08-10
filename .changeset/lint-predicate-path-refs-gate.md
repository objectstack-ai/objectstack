---
"@objectstack/lint": minor
---

feat(lint): metadata 表单谓词的路径解析闸门 —— 引用不存在的路径在发布期就被拒(#7010)

新增 **error 级** 规则族 `validate-predicate-path-refs`,在 `os validate` / `os build` /
`os lint` 三条命令上判定:一个 metadata 编辑表单(数据源为 `{ provider: 'schema', schemaId }`
的 `defineForm` 形状)里的可见性谓词,其 `data.` 路径必须能在该 `schemaId` 对应的 schema 上逐段
解析。两条规则,同一个问题:

- `predicate-path-unresolved` —— `data.` 有根,但某一段不是该层 schema 声明的键
  (`data.tpye == 'formula'`)。消息点名**不可解析的那一段**,hint 给出编辑距离最近的候选。
- `predicate-path-unrooted` —— 裸标识符,而这个名字**恰好是目标 schema 的键**
  (`type == 'formula'`)。这是 #6254 的形状:名字写对了,根丢了。

## 为什么现有三道闸都放行

`validate-visibility-predicates.ts`(ADR-0089 D3b)判的是谓词的**形状**:能不能解析
(`visibility-predicate-syntax`,#6253)、有没有根(`visibility-bare-identifier`,#6128)、
根对不对层(`visibility-root-mislayered`)。三条都**不打开目标 schema**,所以
`data.tpye == 'formula'` 三条全过,而后在控制台 fail-open —— 元素无条件渲染,和完全不写谓词
像素级一致(#5149 一族)。

#6254 已经实测过这个洞的另一半:`object.form.ts` 的 16 处裸谓词写成 `type == 'formula'`,而
#6248 的裸标识符闸**按构造抓不到** —— `type` 是 CEL 自己声明的类型名标识符,到严格检查器那里
是类型 overload 错误而非未知变量。本规则不问 CEL「什么能解析」,只问**目标 schema**「这个键声明了
没有」,所以 CEL 的类型名词汇表与它无关。

## 落点:`data.*` 一层,这是决定而非省略

`error` 级闸门要求 oracle 是**封闭**的 —— 一个能枚举、且「不在其中」确实等于「解析不到」的键集。
ADR-0089 D3 的两层里只有一层满足:metadata 编辑表单的行是某个 metadata type 的实例,形状由
`getMetadataTypeSchema` 这一份规范注册表逐键给出。运行期 record 面(`record.*`)**今天不封闭**
—— lookup 穿透、authored `fields` 从不列出的系统列、formula/rollup 输出都是合法路径,在开集上架
`error` 闸只会制造误红,而误红是闸门唯一不能犯的方向。已在规则注释与 #7010 上记为待裁的开放问题。

## repeater 行重绑 `data`,规则跟着重绑(#6254)

`type: 'record'` / `repeater` / `composite` 子字段列表里,`data` 绑定的是**这一行**
(objectui 的 metadata SchemaForm 以 `{ data: row }` 求值),但根**仍然拼作 `data`**。所以
`object.form.ts` 的 `data.type` 指的是 `FieldSchema.type` 而不是并不存在的 `ObjectSchema.type`。
规则按同样的重绑下降 —— 不这么做,已发货的语料会读出 16 条误红而不是 0 条。

## 语料计数(先量再收紧)

规则通过**生产入口**跑过本仓发货的全部 metadata 表单(`METADATA_FORM_REGISTRY`,17 张表 46 条
谓词):**两条规则的命中数都是 0**,因此才落 `error`。反向验证同时钉住:把 #6254 修前的裸写法还原
到 `object.form.ts` 的深拷贝上,规则报出 **恰好 16 条** `predicate-path-unrooted` —— 正是该单
当年人工读出来的那 16 处。

## 明确不判(都是漏判方向,永远不会变成误红)

规范前端解析不了的谓词(交还 #6253);不声明键集的作用域(`z.record(z.string(), z.unknown())`
/ `z.unknown()`);record map 的**键**段(`z.record(z.string(), X)` 按构造接受任何键);推导宏
绑定的循环变量(`data.tags.all(t, …)`);下标访问(`data.x['y']`);解析不到 schema 的
`schemaId`。裸标识符里**不是** schema 键的那些也不判 —— 那是 `visibility-bare-identifier`
的判决,一条坏谓词只应产生一条 finding。

规则注册在 `AUTHORING_RULES`(`tier: 'gating'`,三条命令全覆盖),`surfaces` 保持 `cli`:它其实
只需要被写入的那一条 item,但 `views[]` 可见性谓词这一族的另外三条规则今天都是 CLI-only,单独把
三分之一的判决搬到 Studio 写入门上,比一条都不搬更难预测 —— 该族应当一次整体迁移,这是关于
`views` 写入门的决定,不该搭在本单的车上。理由已写成 `RUNTIME_VISIBILITY_FAMILY_IS_CLI_ONLY`。
