---
"@objectstack/spec": major
---

fix(spec)!: `composeStacks` 不再静默丢弃顶层键 —— 同值放行、冲突报错、未声明规则必警 (#5005)

`composeStacks` 从一个空对象开始逐项填充:`manifest`、`i18n`、`objects`,再加一份
手工维护的数组白名单。**不在白名单里的顶层键不是"原样保留",而是被删除** ——
不报错、不告警,消费方看到的 `undefined` 与"作者从没写过"完全无法区分。

组合栈是平台的应用打包/安装承载,所以这份静默一路蔓延到了安全配置:

| 顶层键 | 谁消费 | 组合后(修复前) |
|:--|:--|:--|
| `api`(含 `enforceProjectMembership` 每环境成员 403 闸门) | `objectstack serve` → REST + dispatcher | **丢** |
| `server`(`security.rateLimit` / `trustProxy`,#4910) | `objectstack serve` → 入站限流器 | **丢** |
| `functions`(声明式 hook / action / script 节点按名解析的 handler) | `AppPlugin` 启动绑定 | **丢** |
| `datasourceMapping`、`datasets`、`jobs`、`emailTemplates`、`docs`、`books`、`tiers` | 各自运行时 | **丢**(声明为数组,却漏进白名单) |
| `runtimeModule` | 构建产物的 ESM handler bundle | **丢** |

`stacks.length === 1` 时 `composeStacks` 原样返回,所以单栈一切正常 —— 只有真正
≥2 个栈才丢,这是它至今没被发现的原因。ADR-0109 当年也只是给 `tools` 单独补了
一行白名单,并没有堵住这一类。

## 新语义(维护者 2026-08-04 裁决)

1. **同值放行** —— 多个栈声明同一个非数组顶层键且值深相等,照常合成。
2. **冲突报错**,错误信息点名冲突键、两个来源栈(manifest id,无 manifest 时用
   `stack #N`)与两条出路(改一致 / 只在应当拥有它的那个栈里保留)。
   ⛔ **不做 last-wins** —— 后组合的包无声关掉前一个栈的 403 闸门或收紧过的限流
   预算,正是本单要消灭的静默安全降级;⛔ **不做 deep-merge** —— 那会造出一个两
   位作者都没写过的第三种值。
3. **未声明规则的顶层键必警** —— 按默认规则合成(数组拼接,其余按单值规则)**并**
   点名告警指向 #5005,而不是消失。

数组键的拼接语义一字不变。`functions` 按名合并(组合 CRM + Todo 必须两边的
handler 都在),重名报错而非择一;两种书写形态(map / array)不互转(array 条目
带 `packageId`,map 条目没有位置放它),混用报错。`i18n` 保留既有 last-wins ——
它是这里唯一本来就有明确策略的键,本单主题是"被丢掉的键",不动它。

## 结构性保证

顶层键的处置表类型是 `Record< keyof ObjectStackDefinition, ComposeDisposition >`,
**新增一个顶层键而没说清它怎么合成,`tsc --noEmit` 直接不过**。白名单让"忘记"成为
默认,处置表让它成为编译错误;运行时那条 warn 兜住类型看不见的入口
(`strict: false`、手搓 stack 对象)。

## 破坏性

组合两个对 `api` / `server` / `runtimeModule` 声明了**不同**值的栈,过去静默丢弃、
现在抛错;`functions` 重名同理。这正是要的:过去"成功"的那次组合,产出的是一个
少了闸门或少了 handler 的栈。改法见错误信息里的处方。
