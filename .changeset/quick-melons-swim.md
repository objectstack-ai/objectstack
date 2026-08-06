---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 保存成功的回执不再一律自称 "customization overlay"

`saveMetaItem` 的成功 `message` 原本只有两种句式,都写死了 "customization
overlay"。但 `DEFAULT_METADATA_TYPE_REGISTRY` 里有一批类型声明
`supportsOverlay: false` 而按设计可以运行时写入(`object` / `field` / `hook` /
`seed` / `mapping` / `flow` / `action`),对它们的一次全新创建并没有覆盖任何
artifact,却也被回执成 "saved a customization overlay"。

判据不是 `supportsOverlay`,也不是 `allowOrgOverride`(spec 的 TSDoc 把这两件事
分得很清楚:前者是 loader 的合并能力,后者是运行时写入的许可),而是写路径**早已
算出**的 `isArtifactBacked` —— 也就是 `intent: 'override-artifact' |
'runtime-only'` 的来源。回执现在只说这条已知事实,不新增任何读路径查询。

| | FROM | TO |
|:---|:---|:---|
| 覆盖了 code package 的 artifact | `Saved customization overlay (org=…, state=…) — type=…, name=… [seq=N]` | 逐字不变 |
| 无 artifact 的运行时写入 | `Saved customization overlay (env-wide, state=…) — type=…, name=… [seq=N]` | `Saved <type> '<name>' (env-wide, state=…) [seq=N]` |

org 维度照旧在括号里(`org=<id>` / `env-wide`),`state=` 与 `[seq=N]` 两个分支都
保留,所以读取 `seq`(HMR 游标)或 `state` 的消费方不受影响;`message` 本身没有
任何消费方解析,仅作 toast 展示。

回执不区分「新建」与「更新既有 DB-only 行」:唯一可用的事实 `parentVersion ===
null` 的作用域是 `(state, packageId)`,一个已有 active 行的首个 draft 也会读成
"没有父版本",据此写 `Created …` 只是把一句假话换成另一句假话。中性动词
"Saved" 如实,且不为一句文案发明新的查询。
