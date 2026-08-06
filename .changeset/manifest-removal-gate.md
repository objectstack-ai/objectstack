---
"@objectstack/spec": patch
---

fix(spec): manifest 删行不再是纪律 —— 整 schema 消失必须相对 merge-base 自证 (#4725)

#4650 堵住了 `authorable-surface.json` 的手编删行捷径:被删的基线行现在必须在门禁
内自证。但它把「整 def 消失」这条路交给了 `json-schema.manifest.json` 的 #2978
ratchet —— 检查 (c) 的第 3 条出口至今原话写着「whole-schema removals are
adjudicated by json-schema.manifest.json」。**那个 ratchet 什么也没裁判。** 它的
`missing` 集合是「manifest − 本次产出」,而 manifest 是**同一个 commit 里可以随手
改的文件**:把导出、manifest 行、基线行一起删掉,`missing` 恒空,检查 (c) 又以
「def 已不再产出」为由放行它名下的每一行,`check:api-surface` 只是新鲜度门(重新
生成即绿)。三个门,一句话都不说 —— 和 #4650 修复前的形状同构,只是上移了一层。

实测(修复前,在测试沙箱里跑真源码):删掉 `src/data/index.ts` 里 **一行**
`export * from './validation.zod';` —— `ObjectSchema` 是直接从 `./validation.zod`
导入 `ValidationRuleSchema` 的,所以这 7 个 def 依旧从 `object` 元数据根**可达**、
它们的 116 个 key 依旧被作者书写、依旧被解析 —— `gen:schema` 与
`check:authorable-surface` **双双 exit 0**,消失的只是它们的 JSON Schema、
manifest 行,以及 ratchet 对它们的全部记录。

现在按 #4650 的同一结构重新锚定:

- **新增门禁「manifest deletion gate」**(`scripts/build-schemas.ts`):相对
  **merge-base(HEAD, origin/main) 的 manifest** —— 本次 commit 改不动的那一份 ——
  计算「离开已发布集合」的 def,每一个都必须有登记,否则红。它跑在检查 (c) **之前**,
  所以 (c) 那句「交给 manifest 裁判」从此指向一个真的会出裁决的地方。
- **新增导出 `RETIRED_DEFS_BY_MAJOR`**(`@objectstack/spec`,
  `src/migrations/registry.ts`):`RETIRED_KEYS_BY_MAJOR` 的上一层同胞,值是确切的
  `` `${category}/${SchemaName}` `` —— manifest 里怎么写就怎么写。沿用 #4659 的
  精确集合判定:不取叶名、不按前缀、不从相邻条目辐射。门禁失败时直接打印要粘贴的
  那几行和它们该进哪个 major。
- **镜像检查**:表里登记了一个本次构建**仍在发布**的 def —— 一次没有任何东西消费的
  登记 —— 直接失败,否则真正的删除可以在几个月后的别人的 PR 里落地,而门禁早已被
  满足、当时没有任何人写下任何东西。
- 改名不是退休:`RENAMED_DEFS`(`scripts/lib/renamed-defs.ts`)在这张表之前被查,
  一次改名不需要、也不允许写进这里 —— 那是在谎称契约收缩了。

**为什么是「声明」而不是「可达性」。** issue 建议复用 #4650 的可达性 BFS(「该 def
从元数据根不可达」)。这条在本层用不了,而且是**静默地**用不了:`reachableVia()` 从
`zodByDefKey` 取实例,而那张表只装**本次构建产出**的 def —— 一个刚刚不再产出的 def
必然答 `null`,也就是「不可达 ⇒ 放行」,正对着这道门要拦的那一类删除。加宽 BFS 也救
不了:def 已经从源码里没了,没有图可以走。所以本层唯一诚实的证据是声明,沿用 #5902
为 key 层定下的先例。

**离线沿用 #5235 的既有姿态,不新造第三种**:镜像检查不需要 git,任何环境都跑;
比较本身在解析不到 origin/main 时打印说明并跳过 —— 那些环境是已合并的不可变树
(镜像构建阶段、离网、fork、历史 tag 重放),「这个 PR 相对 main 删了什么」在那里
不是一个存在的问题,跳过不会让任何构建失败,因此不需要为它再加一个 in-tree 锚点。

`json-schema.manifest.json` 自己的描述同时更新了(并纳入陈旧判定,不会再漂移):
它此前写的「remove a key ONLY for a deliberate retirement」正是 issue 引用的那句
「唯一的要求,且没有任何机器校验」;现在它指向这道门和这张表。
