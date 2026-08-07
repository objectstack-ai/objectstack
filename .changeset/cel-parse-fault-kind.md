---
'@objectstack/formula': patch
---

fix(formula): 括号/引号/转义等 parse 期错误不再被误报为 `runtime`

`celEngine` 的错误分类此前完全靠**错误文案关键词**判定,而 cel-js 8.0.0 的 parse 期错误有约 19 种措辞,只有 3 种含 `parse` / `unexpected` / `syntax`。其余整类 —— 最典型的括号/方括号/花括号不配对(`Expected RPAREN, got EOF`)、未闭合字符串、非法转义、保留字 —— 全部落到默认值 `runtime`。

`kind` 不是内部字段:它被原样拼进作者可见的写入拒绝文案(`@objectstack/objectql` 的 `rule-validator` / `cel-fault`)与 REST 错误响应体的 `reason`。少写一个右括号的校验规则,作者读到的是 `(runtime: …)` —— 指向数据与求值期,而真正该改的是表达式本身,与 ADR-0032 D1d 的"消息面向自纠"相悖。

改为按 cel-js 抛出的**错误类**判定:`ParseError` → `parse`(其中 `code: 'limit_exceeded'` 仍 → `bounds`,cel-js 的越界一律由 parser 抛出)。这一层不再读文案,因此也修掉了关键词方案无法修的一格:cel-js 会把**作者自己的源码行**嵌进 `message`(`formatErrorWithHighlight`),于是字段名能决定错误分类 —— 实测 `((record.type_id)` 这条普通的括号不配对,此前被判为 `type`,只因回显的源码里含子串 "type"。

`type` / `runtime` 两支暂仍走原关键词表:cel-js 的 `TypeChecker` 按**阶段**而非按故障选择错误类(`isEvaluating ? evaluationError : typeError`),同一个 `unknown_variable` 在 check 期是 `TypeError`、在 eval 期是 `EvaluationError`,整体结构化会改变这些既有判定。审计见 #6133。

kind 词表本身(`parse` / `type` / `runtime` / `bounds` / `dialect`)未变,消费方未改。
