---
"@objectstack/rest": major
"@objectstack/spec": minor
---

refactor(rest)!: 按 ADR-0049 退役 `ExportFieldMeta` 的八个约束键 —— 唯一的读者已随导入 dry run 的镜像一起退役 (#6536)

**BREAKING.** `@objectstack/rest` 导出的 `ExportFieldMeta` 不再声明
`required` / `system` / `readonly` / `hasDefault` / `min` / `max` /
`minLength` / `maxLength`，`buildFieldMetaMap` 也不再计算它们。
`ExportFieldMeta` 本身、以及全部展示类键（`name` / `type` / `label` /
`options` / `reference` / `displayField` / `multiple`）原样保留。

这是一次**休眠代码清扫，不是缺陷修复** —— 今天没有任何用户会撞上它。

## 为什么这八个键留不住

它们只为一个消费者存在：导入 dry run 手抄的前置校验镜像
（`firstMissingRequiredField` / `firstConstraintViolation`，framework#3956）。
#4633 ruling D 已经退役了那份镜像（PR #6532）—— dry run 改为通过
`DataProtocol.validateData` 向引擎要判决，而引擎读的是对象自己的 schema。
于是 `buildFieldMetaMap` 每次导入照算不误、却**没有任何代码再读**，正是
ADR-0049 enforce-or-remove 针对的「已声明、无人读」形状。PR #6532 当时重写了
注释、把键留在原地，并写明退役是一次独立的清扫 —— 本 PR 就是它承诺的那次。

关键在于：这八个键**从来不是事实来源**。`buildFieldMetaMap(schema)` 是从调用方
自己传进来的那个 `schema` 上**派生**出它们的，所以这张表只是把调用方手里已有的
事实抄了第二份。约束词表旁边没有执行者，却和展示词表并排站着 —— 这恰恰是
AI 生成的消费端最容易误当成契约的形状。

## 迁移：FROM → TO

只有一类代码受影响：直接调用 `buildFieldMetaMap`（或通过
`prepareImportRequest` 拿到 `PreparedImport.metaMap`）并读取这八个键的外部消费者。
仓内、以及 `objectui` 同级仓，逐键逐类型核查后**读者为零**。

```ts
// FROM
const meta = buildFieldMetaMap(schema).get('amount');
if (meta?.required && !meta.hasDefault) reject();
if (meta?.max != null && value > meta.max) reject();

// TO —— 从你本来就持有的那个 schema 上读，也就是引擎读的同一份
const field = schema.fields['amount'];
if (field?.required && field.defaultValue == null) reject();
if (field?.max != null && value > field.max) reject();
```

一行版：**把读取点从派生副本移回 `schema.fields[name]`。**

`hasDefault` 没有一对一的替代键 —— 它本身就是派生谓词
`defaultValue != null`，镜像的是引擎 `applyFieldDefaults` 的判断
（`packages/objectql/src/engine.ts`，`if (f.defaultValue == null) continue;`）。
那条事实仍然成立，只是它的权威出处一直在引擎里，不在这份副本里；所以请读
`field.defaultValue` 并自己套用同一个 `!= null` 判断。

⚠️ **请对着一次真实运行验证，而不是只看 tsc 变绿**：这八个是**可选**键，挂在一个
本身继续存在的接口上，所以 JS 消费者（或任何 `any` 类型的读取）升级后读到的是
`undefined`，编译期一个字都不会说。TypeScript 消费者才会在读取处收到编译错误。

字段定义上的 `required` / `min` / `maxLength` 等**照旧完全可写、且照旧由引擎强制** ——
本次没有任何可编写或已存储的元数据形状发生变化。

<!-- adr-0087: registered export-field-meta-constraints-retired -->
