---
"@objectstack/metadata-protocol": patch
---

refactor(metadata-protocol): 删除 `saveMetaItem` 里已不可达的 legacy raw-engine 写入分支 (#5264)

`saveMetaItem` 过去有两条持久化路径:repository 写入路径(追加
`sys_metadata_history`、发 watch 事件、带单调 `seq`),以及其后的 legacy
raw-engine 分支(直接 `engine.insert` / `engine.update` 写 `sys_metadata`,
没有 history 行、没有 watch 事件、没有 `seq`,回执形如
`Saved customization overlay (env-wide) — type=…`)。后者的进入条件是
`isOverlayAllowed(type) || isRuntimeCreateAllowed(type)` 为假。

**没有行为变化 —— 这条分支在运行时已经到不了。** #5086(PR #5263)把
code-only 类型的拒绝提到了同一方法更早的位置,并且不再以 `environmentId`
为条件:它抛错的判据与上面那个条件恰好互为反面,读的还是同一个规范化后的
类型键(`canonicalizeMetaRequestType` 在方法开头折叠单复数,两个标志读取器
内部又各自折叠一次)。`OS_METADATA_WRITABLE` 也不是缺口:在那里解锁一个
类型会让 `isOverlayAllowed` 为真,从而走回 repository 路径。因此凡是能走到
分叉点的写入,一律走 repository 路径。

保留 `useRepoPath` 的代价不是多几行代码,而是它是一份 grep 得到、读起来
像活代码的样板:照它推理会得出「`sys_metadata` 存在一个不写 history 的
合法写入口」——现在没有了。

`deleteMetaItem` 里结构对称的那条 legacy 分支**一行未动**:它在
control-plane kernel(`environmentId === undefined`)上删除 code-only 遗留行
时仍然可达且必要(#5263 特意没有收紧删除侧,因为删除是修复动作),该分支上
新增了说明它为何还活着的注释。
