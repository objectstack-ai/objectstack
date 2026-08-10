---
'@objectstack/lint': patch
---

`visibility-predicate-syntax`: an over-budget predicate is a SIZE fault, not "not valid CEL" (#7217)

view / page `visibleWhen` 的门禁把两类拒绝合成了一类。`parseCelToAst` 对"不是 CEL"
和"是 CEL、但超过平台解析预算"返回同一个 `null`（生产侧刻意如此），于是一条
80 项合取的谓词——完全合法的 bare CEL，只是超过 `maxAstNodes` 256——被报成
`visibility predicate is not valid CEL`，并附上方言处方（"写 `==` 不是 `===`、
`&&` 不是 `and` …"）。标题是假的，处方在这条源码上根本不可能成功：作者（尤其是
照着最后一句话执行的 LLM 作者）会去改一堆本来就没错的运算符，然后带着同一条超预算
谓词回来。#7073 / PR #7209 在 ADR-0032 的共享生产者上修的是同一个缺陷，而本门禁
按其自身 docblock 刻意不走 `validateExpression`，所以生产侧的修复到不了这里。

**判定不变**：拒绝的输入集合、严重级别、每条坏谓词一个 finding，全部与修复前一致。
红绿边界仍然是规范前端接受什么——`celRefusal` 改问 `parseCelToAstWithReason`，而
`parseCelToAst` 本身就是"它把 reason 丢掉"（同一个 env、同一套 limits），所以没有
任何一条源码换了颜色。变的只有解释。

新增第三个 error 级 id **`visibility-predicate-over-budget`**（与
`visibility-predicate-syntax` / `visibility-bare-identifier` 并列导出），理由与
#6778 / PR #6831 在 RLS 侧把 `rls-predicate-over-budget` 从
`rls-predicate-unparseable` 拆出来时相同：后果相同，**修法不同**，而 `--json`
消费者与抑制清单都按 id 取值。超预算谓词现在报：

> visibility predicate is syntactically valid CEL but overruns the `maxAstNodes`
> budget (platform limit 256) (Exceeded maxAstNodes (256)) (predicate: …) …
>
> hint: There is no syntax or dialect error to correct here — this is a SIZE
> fault, not a dialect mistake, so re-spelling the predicate will not fix it.
> Make it smaller, or move the work off the predicate: (1) collapse a long
> `record.f == 'a' || record.f == 'b' || …` chain into a single
> `record.f in ['a', 'b', …]` …; (2) precompute the heavy part into a
> formula/rollup field on the object and test that one field instead. …

越界的那条界（`maxAstNodes` / `maxDepth` / `maxListElements` / …）与平台取值来自
前端自己的结构化 `overrun`，不是硬编码，也不是二次解析它的散文（#6223）；提示里的
绑定根随 layer 走（runtime 用 `record`，`*.form.ts` 元数据表单用 `data`），否则处方
本身又会是一句照做不了的话。真正的方言/语法错误保持 #6253 的 id、message 与 hint
逐字不变——两个方向都有 pin。

**兼容性**：这是新增 id，不是改名。抑制 `visibility-predicate-syntax` 的配置从此不再
抑制超预算这一类——与 #6778 接受的代价相同，而且本来就是抑制错了对象（抑制的是
"语法"，命中的是"太大"）。仓库内除 `packages/lint` 自身与 changelog 外，没有任何
配置、文档或示例引用这些 id。
