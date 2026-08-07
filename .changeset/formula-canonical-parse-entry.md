---
'@objectstack/formula': minor
---

新增规范 parse-to-AST 入口 `parseCelToAst(source)`,并 re-export AST 节点类型 `CelAstNode`(#4812)。

`parseCelToAst` 与 `compile` / `evaluate` / `collectCelRootIdentifiers` 共用同一条前端链路
——#3306 的 `rewriteNullableTernary` 重写、`DEFAULT_LIMITS` 边界、以及注册了 stdlib 的
`unlistedVariablesAreDyn: true` 环境 —— 因此全仓对「什么能解析」只有一个答案。此前消费方
若自建 `new Environment(...)`,拿到的是一份**不带 limits** 的答案:它会解析、并进而推理
`compile()` 直接拒绝的表达式。

`parseCelToAst` 只做 parse,不做 check(后者是 `compile()` 的职责):解析成功但类型检查失败的
表达式(大量 `dyn` 操作数的谓词即是)仍然会拿到 AST。解析失败返回 `null` 而不抛错。

`CelAstNode` 的 re-export 补上了一个既有缺口:`lowerCelAst` 一直接收 cel-js 的 `ASTNode`,
而该类型从未导出,消费方只能越过本包直接依赖 `@marcbachmann/cel-js` —— 这正是第二个解析入口
的成因。
