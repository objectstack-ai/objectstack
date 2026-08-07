---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 删除回执不再对 runtime-only 项谎称"已重置为 artifact 默认值"

`deleteMetaItem` 的四句成功回执(repository 路径两句 + legacy raw-engine 路径两
句)原本无条件把每一次删除都叙述成"摘掉一层 overlay、回落到 artifact 默认值"。
但对一个 **runtime-only** 项 —— 管理员在 Studio 里新建的 `object` / `flow` /
`hook`,没有任何 code package 提供同名 artifact —— 底下根本没有默认值可回落:那
一行就是这个项的全部,删掉之后它在任何层都不复存在。回执却把管理员指向一个从未
存在过的基线。

判据与 #5265 / PR #5926 在 save 侧用的是同一个:`isArtifactBacked` —— 也就是
`intent: 'override-artifact' | 'runtime-only'` 的来源,本方法内早已算出。新增的
方法级绑定**替换**了 `intent` 原来的那次 inline 调用,所以分句后 registry 读取次
数不增反减。

| | FROM | TO |
|:---|:---|:---|
| 覆盖了 artifact,删除即回落 | `Customization overlay deleted — <t>/<n> reset to artifact default. [seq=N]` | 逐字不变 |
| runtime-only,删除即消失 | 同上 | `Deleted <type> '<name>' — it no longer exists. [seq=N]` |
| 覆盖了 artifact,本就没有 overlay 行 | `No customization overlay found for <t>/<n> — already at artifact default.` | 逐字不变 |
| runtime-only,本就不存在 | 同上 | `No <type> '<name>' found — nothing to delete.` |

`success` / `reset` / `seq` 三个字段一字未动 —— `message` 没有任何消费方解析,仅
作展示。草稿两句(`Draft discarded — …` / `No pending draft for …`)本来就没有声
称过 overlay 或 reset,对两类项都为真,故逐字保留。legacy raw-engine 路径不写
history、不发 watch 事件,两句因此本就不带 `[seq=…]`,该差异为既有设计,分句未
触碰。
