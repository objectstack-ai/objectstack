---
'@objectstack/lint': patch
---

null-guard 闸门改走 `@objectstack/formula` 的规范解析入口,并移除对 `@marcbachmann/cel-js`
的直接依赖(#4812)。

`validate-null-guards.ts` 此前自建了一个**不带 limits** 的 cel-js `Environment`,于是它会解析、
并进而判定平台自身拒绝的谓词 —— 超过 `maxAstNodes` (256) / `maxDepth` (32) /
`maxListElements` (64) 的表达式在 lint 侧照常出 finding,在 `compile()` 侧却是
`Exceeded max…`。两个解析入口,两个答案,而这个闸门握着更宽松的那个。

改走 `parseCelToAst` 后两者合一。超界表达式不再由本闸门二次判定,而是交还给同一批调用点上
本就在跑的 `validateExpression` —— 它以 blocking error 报告边界错误,措辞面向自纠;作者修好
边界问题后,null-guard 判定自然回来。规则判定本身没有变化:#3306 的三元重写对本 pass 是
verdict-neutral(重写仅在三元的某一支恰为 `null` 字面量时触发,而该支本就证明不出任何
guard),已加测试钉住。
