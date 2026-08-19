---
name: checklist-test
description: >
  Execute the platform test checklist (docs/qa/platform-checklist/) against a real
  running app and produce a run record. Use whenever the maintainer says "测一下
  <功能>", "跑这个测试项", "run the checklist for <area/item>", "test this feature
  file", "验证 <功能点>", or points at a framework source file and asks whether it
  still works. Takes a SELECTOR (item id · area · capability kind · priority · a
  release · or a source-file path) and drives every matched item through its steps
  following RUNNER.md. The companion to `checklist-author` (which AUTHORS items); this
  one RUNS them. NOT a customer-published skill — internal agent tooling (lives in
  .claude/, never in the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery — every SKILL.md outside `skills/` must carry this marker
  # (template-consistency.test.ts enforces it).
  internal: true
---

# Checklist test —— 对着活的应用执行选中的测试项

你把一个**选择器**解析成一组清单测试项,在隔离环境把应用拉起来,在浏览器 / API 上驱
动每一项的步骤,并产出一份**运行记录**。逐条款判定的方法(判定词、oracle 层级、证
据、防误报自查)是 **`docs/qa/platform-checklist/RUNNER.md`** —— 先读它、服从它;本
技能只是触发器、选择契约与隔离/并行方案,不是 runner 协议的第二份拷贝。

环境知识(启动、dist 构建模型、vendored-console 陷阱、浏览器逃生舱)在
**`dogfood-verification`** 技能 —— 也要读。你不是在重新发明怎么启动;你是在对着一次
启动执行一份具体清单。

## 0. 解析选择器 —— 确定性的,不许猜

永不肉眼挑测试项。问解析器:

```
node scripts/checklist-select.mjs <selector> --json
```

选择器(每次运行一个):

| selector | 跑什么 |
|---|---|
| `platform-core.console-login`(裸 id) | 那一项 |
| `area:records-forms`(或裸 `records-forms`) | 该区全部测试项 |
| **`records-forms.json`**(或完整 `…/areas/records-forms.json` 路径) | **该区全部测试项 —— 列目录看到的文件名不带前缀也能用** |
| `capability:hook` | `coverage.json` 里映射到某个元数据种类的项 |
| `priority:P0` | 常备冒烟 |
| `surface:api` | 全部 API 面测试项(便宜 —— 不需要浏览器构建) |
| `since:v17` | 某个 release 引入的全部项(release-sweep 过滤器) |
| **`file:packages/plugins/plugin-approvals/src/approval-service.ts`** | **`source[]` 引用该文件的项 ——「测覆盖这个文件的一切」**(带 `/` 或代码扩展名的裸路径也自动按 `file:` 解析) |
| `all` | 整份清单 |

`--json` 给出可运行清单(id · priority · surface · revision)。**Blocked 项默认排
除** —— 它们在现成 fixture 上跑不起来;只有要把它们带着 fixture 理由记录成
`blocked` 时才传 `--include-blocked`。**把解析器报出的 `revision` 钉进运行记录**:
判定只对它运行时所对的那个 revision 有效。

## 1. 规划这一轮 —— 只构建需要的,钉住的先跑

读命中项的 `surface`:

- **全是 `api` / `build` / `cli`** → 不需要 console 构建。把框架拉起来
  (`objectstack dev`),驱动 REST/CLI。快(分钟级)。
- **有任何 `browser` / `mixed`** → 需要 vendored console dist。它与 showcase 工作区
  闭包**分开**构建(`pnpm objectui:build`,从钉住的 `.objectui-sha` 构建);它存在
  之前,第一次启动对 `/_console/` 是 404(dogfood §2 —— 真实前置条件,记录它,不要
  伪造 block)。给构建留预算(冷 monorepo 上 ~10–30 分钟);它占掉大头,浏览器驱动
  只是分钟级。

整轮只构建一次,提前建好。

**复用一棵已配好的树 —— 整轮最大的开销是环境,不是测试项。** 实测同一份清单、同一
个 subject sha:复用现成树的一轮跑完了它的区;三个冷容器在给出第一条判定之前就各自
烧掉了大半预算(install、console 构建顺序、缺失的 CLI dist),合计留下约三分之二的
区没跑。**默认复用**已配好的树;每轮开一个冷容器,只在这一轮必须**活得比派发会话
久**时才值(长时间浏览器运行、dogfood)。

**按 tier 排序,钉住的先跑、按区批量。** 解析器给出的 `automated.ref` 是最便宜的切
分:

- **Tier 1 —— 带 `automated.ref` 的项**:**按区批量**,一次 vitest 覆盖该区全部钉住
  的文件,一条命令为多项取证(RUNNER 规则 6:不重证自动化已钉住的东西)。
- **Tier 2 —— 无 pin 的 P0/P1**:手工驱动。sweep 的真实价值集中在这里。
- **Tier 3 —— 无 pin 的 P2**:除非有改动触达,否则押后。

实测这份清单:约四成的项带 pin,手工驱动的量只有条目总数的三分之一左右 —— 先把
Tier 1 批量清掉,剩下的预算才对得起 Tier 2。

## 2. 先隔离,再执行(照 dogfood §0)

- **每个并发运行的测试项**自有的空闲非默认端口 + 自有的文件 DB
  (`--seed-admin -d file:/tmp/<run>/<item>.db`)。两轮共用端口/DB/浏览器标签页就是
  `shared-browser-tab` 陷阱。
- **并行度**:API 面测试项放开并行扇出(各自端口,便宜)。浏览器项**少量并行**
  (2–3 个),各自端口 + 浏览器上下文 —— 超过这个数,单机 CPU 与共享显示开始互相争
  抢。派发 runner 子代理时,**必须用 `opus`**,每个给:该项 JSON、RUNNER.md、
  dogfood 技能、自己的端口/DB、结果不进仓规则(§4)。
- **没有子代理工具时,顺序跑 —— 并在运行记录里声明这一轮是顺序执行的。** 会话里不
  存在 Task/子代理工具是允许的退化路径,不是阻塞。但并行的全部价值在于**读者彼此独
  立**:悄无声息地塌缩成一个读者,findings 依然成立,**「没有别的遗漏」这个结论不再
  成立**,而输出上看不出任何区别 —— 所以声明是强制的,不靠自觉。
- 忠实执行每项的 `steps`;对照各自声明的 `oracle` 判定每条 `acceptance` 与每条
  `negative`,采集条款点名的 `evidence`。**服务端真相压过像素;截图确认渲染之后才查
  DOM;一个 `fail` 需要 ×2 复现 + 自动化自查 + 运行 issue 里的复现规则**
  (RUNNER §rules)。

## 3. 当这一轮教你的是关于测试项本身的东西

运行发现该项的 `steps` 写错了(路由搬家、键改名、过期路径还需要清 localStorage)——
这是清单在起作用。那是一次清单**编辑**:在 **worktree** 里做(PD#11):修订该项、递
增 `revision`、追加一条 `history`、保持 `node scripts/check-platform-checklist.mjs`
绿,落在任务分支上。运行中发现的产品缺陷按 §4 收束抽取成独立卡;条款侧可记
expected-fail 探针 —— 永不在真实缺陷上把条款打成绿。

## 4. 结果 issue —— 一次运行一张 GitHub issue,纯文本

每次完成的运行 —— **通过与失败同等** —— 恰好立一张 GitHub issue 作为持久记录。运行
的任何产物都不进仓库树:JSON 不进,截图不进。JSON 运行记录(RUNNER.md 形状)是执行
环境里的草稿;`runs/` 保持 git-ignore。issue 就是报告。

**issue 是纯文本 —— 永不放图。** 截图只为让你和子代理**现场**得出判定;它们是判断辅
助,随运行环境一起丢弃。持久报告需要的是**复现规则,不是图片**。

用 `issue_write`(github MCP)立单:

- **标题** —— `QA run · <selector> · <已判定>/<总数> · <framework-sha[:8]> · <date>`。
  那个分数是标题的一部分,不是可选装饰。
- **标签** —— 只带 `qa-run`,⛔ 不挂 `bug`/priority 等工作标签:run 记录是协议载体、
  不入分诊 sweep,⛔ 不是可派发单元;工作标签随抽取出的缺陷卡走(RUNNER 抽取义务条款)。
  **这条在记录的整个生命周期成立** —— 收口与关闭时同样不补挂。实测漂移形态:记录事后
  被补上 `tests` / `tracking` / `bug`,每一个都把协议载体推回排除清单本要挡住的
  sweep。
- **正文**,按此顺序:
  - **环境指纹** —— framework sha、`.objectui-sha`、端口、db、seed、时间戳。
  - **范围** —— 选择器 + 每项所对的 `revision`。
  - **逐条款判定表** —— 项 · 条款 · 判定 · 一行**文本** oracle 证据
    (API/网络/构建/测试结果 —— 服务端真相,永不是像素)。
  - **每个 `fail` 一条复现规则** —— 精确的有序步骤 / API 调用(method · path ·
    body)/ ref 定位的 selector 路径,足以在全新启动上重新命中,外加 oracle 的
    expected-vs-actual。足够让人或全新 agent 不靠你的截图复现。
  - 派生的整项判定 + fixture 缺口清单(如有)。
- **收束抽取(RUNNER 抽取义务条款)** —— 运行中发现的每个产品缺陷,收束报告时逐个抽
  取为独立 issue:标题自含、复现与机制条目化、指回本 run issue 取全量证据;缺陷卡不
  挂 `qa-run`,正常进分诊首触。清单准确性发现与 fixture 缺口归波次锚卡(sweep 跟踪
  issue)收口,⛔ 不抽取;环境阻塞记录在案即可。逐条 `fail` 的四分法处置、收口评论的
  机器行与抽取卡的溯源行见 §5。⛔ 认证 / 授权漏洞的抽取卡不写复现,见 Guardrails。
- **完成判据** —— 一个区只有在**每一项都有判定**时才算跑完。跑不完的一轮照常立单:
  交出已有的判定,**外加一份点名未触达项的交接清单**,标题按上面的分数如实写。
  `not-run` 是诚实判定;在 11 项 not-run 之上写 `(FULL area)` 不是。

同一份逐条款表 + 环境准备与测试的耗时之比,回报给维护者(chat),并链接已立的 issue。

## 5. 收口 —— 一张 `qa-run` 记录什么时候才算关闭

立单不是终点,收口是每一轮运行的一部分。RUNNER 的抽取义务条款给的是**抽什么**;本节
给的是**一张记录什么时候才算关闭**,以及关闭这件事在别处怎么被读到。零新标签 —— 下面
每个状态都用现有载体承载。

**开着的 `qa-run` 数 = 未清的收口债**,与裸 `finding` 计数同一构造:它是可直接读的健
康指标,所以⛔ 永不靠关掉记录让它变好看,只靠把下面几件事做完。

**每个 `fail` 落一个四分法处置**,判据是这份记录自己的证据,不是记忆:

| 处置 | 判据 | 动作 |
|---|---|---|
| **产品缺陷** | 被测能力的行为违背它自己声明的契约 | 抽取独立缺陷卡(§4 抽取条款):先查重、立在**修复落地的仓**、⛔ 不挂 pm 标签,正常进分诊 |
| **断言缺陷** | 产品是对的,测试项的 `steps` / `acceptance` 写错了 | 在**拥有该测试项的仓**立 test-fix 卡;条款侧修订照 §3 |
| **过期规格** | 两边都按各自的声明行事,条款钉的是已被裁决改掉的旧形状 | 立 re-point 卡:把条款重新指向现行规格,引裁决 |
| **配对无效** | 该项与这个 subject / fixture 根本不成立(错配的 revision、不适用的环境) | 记 `blocked` 说明,⛔ 不立卡 |

四选一是**穷尽的**:落不进任何一格的 `fail` 说明你还没判完 —— ⛔ 永不把它留成一条无处
置的红行。

与 §4「清单准确性发现归波次锚卡」的分界,是**有没有一条 `fail` 要清**:由 `fail` 判出
的断言缺陷 / 过期规格各自立卡(那条红行得有人负责变绿),运行中顺带看到的清单准确性问
题仍归锚卡收口,⛔ 不抽取。

**`partial` 的覆盖缺口点名,永不丢**:要么按区立 pin 升级卡(把该区缺 `automated.ref`
的项钉起来),要么挂到波次锚卡上。`not-run` 由 §4 的完成判据兜底(交接清单),⛔ 不另
起第二份清单。

**收口评论是机器可 grep 的** —— 一条一行,落在记录 issue 的收口评论里:

```text
Extracted: #缺陷卡号 · area.item · 条款
Parked-on: #锚卡号 · 缺口
Superseded-by: #新记录号
Carried-forward: #旧记录号 · area.item · 判定
```

**抽取出的每张卡,正文带一行溯源**(靠 grep,不靠标签):

```text
QA-source: #运行记录号 · area.item · 条款
```

上面两处的定位字段一律是 §0 的**裸 id 形式 `area.item`**(如
`platform-core.console-login`)—— 解析器、run 记录的逐条款表、抽取卡三处同一把定位
符,才互相 grep 得到;⛔ 不写只有 item 段的短形。**写进 GitHub 正文/评论时⛔ 不要用尖
括号占位符**:`<`+字母会被写入层当标签吃掉,一行溯源就此消失在库里 —— 占位用中文词或
直接填实值。

**Supersede 协议** —— 重跑覆盖了旧记录的地面时,旧记录关闭(`not_planned` + 一行
`Superseded-by:` 指向新记录),但**先把新一轮没有重新判定的判定结转过去**:结转行
(`Carried-forward:`,引旧记录号)落在**新记录**上,supersede 行落在**旧记录**上。⛔
永不用「新的一轮跑过了」直接关掉旧记录:没被重新覆盖的判定会随它一起消失,而记录被关
闭这件事在别处不留任何痕迹。

**重测触发,三条且只有三条**:

1. **发版候选** ⇒ 完整 Tier 1 重跑(§1 的分层)。
2. **QA 抽取的修复卡落地** ⇒ **接受该卡的座位**把受影响的项追加到波次锚卡的重测清
   单 —— 与跨仓联动同一纪律:第一产者是接受座位。
3. **维护者点名目标**。

⛔ 其它一切都不是重测触发:凭手感「再跑一遍」只增加收口债,不增加覆盖。

## Guardrails

- **不伪造覆盖。** 缺 fixture → `blocked(fixture)` 带理由;console 没构建 → 构建它
  或记 `blocked(environment)`;证到一半的项是 `partial`,不是 `pass`。带证据的
  blocked 判定是一次成功运行;伪造的 pass 不是。
- **认证 / 授权漏洞的复现,永不发布到 GitHub 的任何地方** —— 不进运行 issue,不进跟
  踪卡,不进评论。**本条压过 §4 的「每个 `fail` 一条复现规则」与 RUNNER 规则 2 的同
  款要求**:记下项 id、条款,以及 `detail withheld pending maintainer`;复现留在会话
  里,停下等维护者。「换个公开的地方贴」不是缓解 —— 跟踪卡同样是公开仓库里的公开
  issue,一次照办就把一个未认证读写洞的可用配方发布了出去。存在性公开、配方不公开的
  发现,依然是一份完整、可行动的报告;让缺陷得到修复,从不需要把可用的 exploit 交到
  任何人手上。
- **不把 blocked 项当可运行的跑** —— 解析器隐藏它们正为此。
- **一个选择器、一次运行、一张 issue。** release sweep 把 `since:vN` 与
  `priority:P0` 作为分开的两轮跑 → 两张 issue,不要糊在一起。
