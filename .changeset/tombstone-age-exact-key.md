---
"@objectstack/spec": patch
---

fix(spec): 墓碑老化时钟改按**确切 key** 起算 —— 无关簇的登记不再替一次退休提前放行 (#5898)

`scripts/build-schemas.ts` 的检查 (c)(#4650)保证一件事:删掉一条
`authorable-surface/` 基线行必须自带证明 —— 那个文件正是检查 (a)/(b) 赖以判定的
证据,行没了证据也就没了。它承认的三种证明里,第一种是「墓碑已老化」:base 里这条
是 `[RETIRED]`,且它的退休登记比当前 major 至少早 `TOMBSTONE_AGE_MAJORS`(= 2)。

#4659 把检查 (b) 收口到了 `RETIRED_KEYS_BY_MAJOR` 的确切 key,检查 (c) 的同一套
**叶名匹配**原封不动地留了下来:拿 key 的叶名去和**全部 major** 的所有 conversion /
migration `surface` 子句做 `endsWith('.' + prop)`,再取 `Math.min`。两个后果都朝
「放行」的方向 —— 一条无关登记就能让一个从没被登记过的墓碑通过「有没有登记」这一关,
而 `Math.min` 保证时钟一律从**最早**的那次巧合起算。

实测:当前 97 条历史墓碑里有 **2** 条今天就可删,而且**两条都是误判**,机制还不一样:

- `data/Index:type` 被 protocol 11 的 `flow.node.type` 定了年份 ——
  `flow-node-http-callout-rename` 里一个 flow 节点的 `type`,和索引类型毫无关系。
  它自己那条诚实的登记 `object.indexes[].type` 是 major 17,时钟被提前了六个 major。
- `api/RestApiConfig:requireAuth` 被 major 12 的 `api.requireAuth` 定了年份 ——
  那是 `rest-requireauth-default-flip`,一次**安全默认值翻转**,该 step 自己写着
  「No metadata shape changed」。它真正的退休是 protocol 17 的 conversion
  `stack.api.requireAuth`(#3963)。同一个 surface,不同**种类**的变更,早了五个 major。

现在检查 (c) 读的是检查 (b) 那张表,按确切 `` `${defKey}:${name}` `` 判定,
`build-schemas.ts` 里再没有任何叶名匹配。

**历史墓碑不回填,并且因此不可删。** 两条可机械推导的来源都无法诚实定年:叶名匹配
正是 #4659 拿掉的那种推断(上面两条误判即为实证);而
`authorable-surface.json` 的 git 历史始于 `17.0.0-rc.0`,把 97 条全部定在 major 17
—— 那是基线文件的**出生日期**,不是考据。所以这些行保持未登记,检查 (c) 对它们
fail-closed:没有条目就无法证明年龄,基线行不许删。可删数从 **2 → 0**(按当前
`authorable-surface/` 的 100 条墓碑口径同样是 2 → 0)。

要删其中某一行,是一次有意的、可复核的动作:确定该 key 真正的退休 major,把确切 key
写进 `RETIRED_KEYS_BY_MAJOR`,由检查 (b2) 复核该条目仍指向一个本次构建确实
tombstone 的 key。⚠ 定不出年份的行不要写 —— 写进这张表的估算,对之后每一道门禁都
读作事实。

导出值本身没有变化;`RETIRED_KEYS_BY_MAJOR` 的文档注释更新为它现在同时被检查 (b)/(b2)/(c)
读取,以及历史墓碑的 fail-closed 口径。
