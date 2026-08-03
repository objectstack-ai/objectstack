---
---

chore(spec): 把 DTS 构建的堆上限从 12288 降到 8192(#4845)

发布面零变化 —— 改的是 `packages/spec` 的 `build` 脚本里 DTS 那一趟的
`--max-old-space-size`,不影响任何产物内容,故为空 changeset。

`--max-old-space-size` 是**允许 V8 涨到多少的上限,不是预留**。设成 12288 时,
V8 在逼近 12 GB 之前都不积极 GC;而 `Test Core` 跑在 16 GB 的 `ubuntu-latest`
上,叠加堆外内存与其它进程后总量越过物理内存,**内核 OOM-killer 先于 V8 的
OOM 处理把进程杀掉,于是没有任何 Node 侧错误输出** —— 日志里只看到
`DTS Build start` 紧接着 ` ELIFECYCLE  Command failed.`。

也就是说这个数字不是防 OOM,而是 OOM 的成因之一。

实测(15 GB / 可用 13 GB 的机器,与 CI runner 同量级):DTS 构建在 8192 上限下
**成功完成,峰值 RSS 6.29 GB**。8 GB 上限相对真实需求留约 27% 余量,同时给
runner 剩下约 8 GB 供堆外与系统使用。

一个上午内四次命中,横跨内容毫不相干的 PR(纯删除 / wire 形状迁移 / 纯文案
patch),第四次发生在**合并队列**里并把 PR 踢了出来 —— 说明命中取决于是否真的
跑这一趟 DTS(turbo 缓存失效时),与改动内容无关。
