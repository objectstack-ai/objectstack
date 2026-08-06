---
"@objectstack/spec": patch
---

fix(spec): `check:liveness` 的 stale-evidence 从 `⚠` 升级为 `✗` 判红,摘要行不再把「声明数」当作「解析成功数」(#5623)

`live` 判定的语义就是它的 evidence 指针 ——「这个属性有运行时消费者,在这里」。指针指向本仓已不存在的文件时,这条声明就不再可证伪:declared 有,enforced 无。而把它变成这样,只需要一次目录重组或一次改名。

实测(`origin/main`,把 `packages/spec/liveness/query.json` 的 5 条 evidence 路径指回迁移前的 `packages/plugins/driver-sql/...`):

```
evidence paths: 330 resolved against this checkout, 101 attributed to another repo (…)

⚠ 5 'live' entr(ies) cite a missing file:
    query/fields → packages/plugins/driver-sql/src/sql-driver.ts
    …
```

退出码 **0**。五条断链逐条点名了,CI 一路绿灯 —— 而且摘要行里的 `330` 一动没动,因为它数的是 local 路径**总数**,不是解析成功数,"resolved" 这个词是失真的。

**为什么以前是 `⚠`,以及为什么现在不该是。** 这不是对本仓路径的有意宽容,是解析器时代的遗留:#3857 之前的检查取 `evidence.split(':')[0]` 当文件名,227 条里报 48 条、**全是误报**,那种情况下它当然不能判红。`evidence.mts` 修好了解析(realm marker 归属 + 仓根路径提取),此后这份清单一直是空的 —— 恰恰是这一点让「有命中」重新变成信号。当时被那 48 条噪声埋掉的唯一一条真腐烂(`object.enable.clone`,消费者从 `@objectstack/objectql` 搬到了 `@objectstack/metadata-protocol`),就是宽容的实际代价。

同族的旁证:同一目录下的 `check-empty-state.mts` 对 `rotted-evidence` 一直是 `✗` + exit 1,README 也写着它的执行点路径「resolves like `evidence` above, so a pointer that rots is reported rather than trusted」。真正有意的宽容在这个 gate 里都写明了理由(`verifiedAt` 的年龄、undrilled 容器计数、`PENDING_GOVERNANCE` —— 每一条都在代码里明说 "never fails CI"),stale-evidence 那一段一个字都没有。

**改动**

1. **`live` 条目引用本仓缺失文件 → `✗` 判红**,并给出三条修法(仓内搬家就改指针并补 `verifiedAt`;搬去别的仓就加 realm marker;消费者真没了就按 ADR-0049 重新判定,而不是随手指向一个看着像的幸存者)。
   **边界不变**:cross-repo attribution(`objectui:` / `cloud:` / `packages/services/service-ai/…`,当前 101 条)只计数、不解析,永远不判红 —— `checkEvidence` 只对 local 桶做存在性检查,这个分界是结构性的,不是靠约定。
2. **摘要行改成两个数**,而不是二选一:
   ```
   evidence paths: 330 repo-local path(s) declared by 'live' entries, 330 resolved against this checkout; 101 attributed to another repo (…)
   ```
   两个数都留着是有原因的:"declared" 是 #3857 留下的解析健康度信号(有单测防止解析器退化成「什么都提不出来」而假绿),"resolved" 是判定。绿的时候两者相等 —— 这正是当初只印前一个会被读成通过的原因。有断链时行尾追加 `, N MISSING`。
3. 新增 `--ledger-root=<dir>`:让 gate 读 `packages/spec/liveness` 的一份副本。自测据此把真 gate 跑在「只坏了一条指针」的 ledger 副本上,不改动仓库里任何文件。

`check-liveness.test.ts`(新增 8 例)直接 spawn 真脚本断言退出码 —— 这个 bug 从来不是「检查看不见」:它把五条全点名了还是 exit 0,所以只测 `checkEvidence` 的单测全程是绿的。

脚本本身(`scripts/`)不进 npm 包,但 `packages/spec/liveness/**` **是发布内容**(`package.json` 的 `files` 里有 `liveness`,`npm pack --dry-run` 实测 29 个文件入包,含该目录的 `README.md`)。一个新开始判红的 gate 必须同步它面向作者的文档,否则下一位作者只能靠撞红的 CI 才知道规则变了 —— 所以 README 里那段新的失败语义也随包发出,按 patch 记账,而不是空 frontmatter(空 changeset 是 `changesets/action` 的真实输入,全空集合会静默绿着卡住发布 —— #4898 卡住 17.0.0-rc.2 的就是这个)。当前 `main` 上 330 条本仓路径全部解析成功,该 gate 落地即绿。
