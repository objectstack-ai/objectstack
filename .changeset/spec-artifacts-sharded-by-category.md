---
"@objectstack/spec": patch
---

refactor(spec): 三个热点生成物按 category / entrypoint 分片,合并队列的串行税消失 (#5837)

`merge=os-regen`(#4675)只在**本地** git 生效。合并队列在服务端重建 PR 时不跑自定义
merge driver,所以两个都动过 `authorable-surface.json`(310KB、7941 行排序数组,每个
spec PR 都会重写)的 PR 在队列里是纯文本冲突,第二个必然被踢——spec 车道一次只能放行
一单。driver 自己的注释里记着这笔税的形状:一个下午 4 次合并 9 处冲突,**零**真语义
冲突,全部是集合并集。付的是「单体文件」这个形状的钱,不是分歧的钱。

**布局变化(发布产物路径,见下方档位说明)**

| 之前 | 现在 | 分片键 |
|:---|:---|:---|
| `packages/spec/authorable-surface.json` | `packages/spec/authorable-surface/< category >.json` | def key 的 category 段 |
| `packages/spec/json-schema.manifest.json` | `packages/spec/json-schema.manifest/< category >.json` | 同上 |
| `packages/spec/api-surface.json` | `packages/spec/api-surface/< entry >.json` | 已发布入口(`.` → `root.json`) |

有意维持单体:`spec-changes.json`(按版本键控)、`api-surface-signatures.json`(1.3KB)、
`authorable-surface.base.json`(只有显式 `--update-base` 会写,从不在 churn 路径上,且
它的 `baseRev` 是整个 surface 的**一个** commit——分片会让不同分片镜像不同 revision,
那是任何上游 commit 都没有过的状态)。

**ratchet 语义逐条不变。** 所有门禁读**整个目录**当作一个集合,而不是「这次构建会写的
那些分片」:删掉一整个分片文件 = 删掉它的 key,checks (a)/(c) 看到的缺失 key 与从前删
单体文件里的行时一模一样;没人重生成的分片报**陈旧**而不是被跳过;#4662 的逐字节规范
形式比对现在是逐分片做的,手改因此还能被**指名到文件**。#5976 的 def key 撞名守卫不受
影响——它按剥后缀的 schema 名判定(`shared/HttpMethod`),与输出路径无关,且仍在两个
ratchet 之前运行。

**对消费者的可见影响,以及为什么是 patch。** `@objectstack/spec` 的 `files` 里
`api-surface.json` 改成了 `api-surface`,所以 npm 包内该快照的路径变了(它不在
`exports` 里,不是可 import 的子路径,是给工具读的文件)。导出面本身**零变化**
(`check:api-surface` 实测 0 breaking / 0 added),运行时行为、类型、schema 一律未动,
因此不是 major;仓内唯一的读点(release 工作流的 surface diff)随之更新,并且会按上游
tarball 实际携带的形状读取——`api-surface/` 目录(本次起)、`api-surface.json` 单文件
(protocol 15 起至本次)、两者皆无(protocol 15 之前)。外部若有直接读
`node_modules/@objectstack/spec/api-surface.json` 的工具,改读 `api-surface/` 目录并把
各分片的 `exports` 按 `entry` 合并即可,内容逐条相同。
