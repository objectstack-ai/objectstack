---
"@objectstack/spec": patch
---

fix(spec): 参考页给「元素是联合类型」的数组补上括号 —— `(string | number)[]`,不再是 `string | number[]` (#5338)

参考页类型单元格由 `packages/spec/scripts/lib/format-type.ts` 渲染,数组分支此前直接把
`[]` 拼在元素渲染结果之后。TypeScript 里 `[]` 的结合优先级高于 `|`,所以
`string | number[]` 表达的是「一个 string,**或者**一个 number 数组」,而 schema 说的是
「一个数组,元素是 string 或 number」—— **单元格印出的类型和 schema 声明的不是同一个**。
参考页的类型单元格正是元数据作者(尤其是 AI 作者)直接照抄的那一行:照着
`string | number[]` 写下一个裸 string,schema 会当场拒绝,而页面看起来是允许的。

修法只有一处:#4912 为交叉类型引入的深度扫描 `hasTopLevelIntersection` 放宽成
`hasTopLevelUnionOrIntersection`,同时识别顶层 `&` 与 `|`。两者本来就是同一条规则——
`[]` 对这两个运算符都不分配律(`A & B[]` 是 `A & (B[])`,`A | B[]` 是 `A | (B[])`)——
所以合用一次扫描。深度扫描原本就正确忽略 `{}` / `< >` / `[]` / `()` 内部的运算符,
因此 `Enum<'a' | 'b'>[]`、`Record<string, string | number>[]`、`{ k?: string | number }[]`
以及 markdown 链接都保持原样,不会多出括号。

重新生成 `content/docs/references/**` 后共 19 个参考页、42 行单元格得到修正
(47 处补括号),没有新增页,也没有页面被复活;`check:docs` 报告 240 个生成文件全部同步。

#4912 的交叉类型侧行为不变:`({ label: string; value: … } & Record<string, any>)[]`
仍然带括号,该 PR 的全部 pin 用例保持绿。
