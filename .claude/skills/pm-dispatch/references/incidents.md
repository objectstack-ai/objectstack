# pm-dispatch 案例实录(references —— 按需加载)

⚠️ **APPEND-ONLY。** 本文件是 `.claude/skills/pm-dispatch/SKILL.md` 的案例叙述
外置层:主文件留「规则 + 一行锚点 + 指针」,长叙述住这里(#5925 item 7,维护者
批准的纯搬移纪律)。三条读写规则:

- **只在尾部追加,不改写存量** —— 与 Operational notes 的追加纪律同款。新案例
  默认落这里,不再灌回主文件;主文件增长率因此归零。
- 每节标题即主文件指针的锚文本(§「…」逐字对应);「出处」行指回主文件的规则段。
- 搬入的正文**逐字节保留**原文(纯搬移零改写);行文里的相对指代(「上面」「见下」
  等)仍指其在主文件里的原位置,出处行会注明。

## 定点文本两例实录

出处:Operational notes 3「定点文本的写法纪律」—— 两种形态、同一个后果的两例。

- `domain:spec-surface` 席**两枪已 `delete_trigger`**(回包确认 `deleted trigger …`)
  的定时器**照样投递**,文本都落后现实两轮。其中一枪写着「#5783 …… 判为不可靠、
  交接、**重新派发一个 fresh os-dev**,worktree `objectstack-issue-5783` 已存在」;
  投递时 #5783 的 PR #6389 早已交付并通过复核 —— 照文本执行就是把一个重复 agent
  塞进一个活着且已完工的 worktree,正是认领协议要防的碰撞类,只不过这次是**从
  自动化里**来的,而不是从抢跑的 PM 那里。
- `domain:devx` 席的一枪**没被删,是被现实追上**:21:3x 挂、22:1x 投递,文本写的
  「两个 dev 静默结束、未开 PR、未交报告 ⇒ 判定失效 ⇒ 重新派发一个新 dev」在投递
  时前提已被推翻(两个 dev 都已回话正常推进,其中一个的 PR 已合并)。照做会向两个
  活着且已有成果的任务各塞一个重复 dev。删与没删是两条路径,终点是同一个。

## domain:spec-tooling 沿革

出处:「Domain lanes」的 `domain:spec-tooling` 节 —— 生效规则在主文件包家族表,此处为沿革全文。

维护者 2026-08-06 裁决(#5469,原文引用、未翻译):

> `domain:spec-tooling` 判为 **#5163 存续期的临时 program 车道**,不进 SKILL 包家族
> 域表;其存量单由分诊按现行域表重标,重标完成后该标签退役

⚠️ **该裁决所依据的前提(「临时、待退役」)在其后三天被反向的事实推翻,所以本节
记录的是现状,不是那条裁决的执行结果**(2026-08-09 实测):

- 裁决当天 15:03Z(裁决后约 9 小时)**新立了座位贴 #6018**,该席至今在任、经历
  一次移交、一个任期内落了 9 个 PR;
- **2026-08-07 维护者批准的 `spec` 拆分**(座位贴 #6298)在本文里写进了
  `spec-surface` ↔ `spec-tooling` 的分界判据 —— 即维护者本人在裁决次日签发的
  文本,把它当作活车道在用;
- 标签仍在被分诊打:当前 **10 单 open**(#6833 / #6797 / #6751 / #6635 / #6350 /
  #6232 / #6221 / #5828 / #5757 / #5163,其中 #6797、#6350 已 `pm:dispatched`),
  67 单 closed,最近一次新打在 2026-08-08。

⇒ 该标签是**在册车道,分诊照常打**。

**维护者 2026-08-09 裁决(#5469,取代上面 2026-08-06 那条):判据切分,给行。**
拖住补行的从来不是「它是否存在」,而是它与 `domain:devx` 的三处文件面重叠未裁 ——
裁完即补,包家族表的 `spec-tooling` 行就是该裁决的登记:

- **无争议、可直接路由的两处**:`packages/spec/scripts/**`、`packages/spec/docs/**`
  ⇒ `domain:spec-tooling`。devx 从未声明这两处,依据是 #6018 座位贴的 Scope 段与
  上面 2026-08-07 的 surface / tooling 分界(tooling 改「围着契约转的机器」)。
- **曾争议的三处**:`packages/lint`、`content/docs/**`、`scripts/` —— 座位贴 #6018
  与 #6023 **同时声明**这三处。这不是纸面问题,2026-08-09 实测两侧都在落地:
  `domain:spec-tooling` 的 #6778 整单落在 `packages/lint/src/`(PR #6831),而同期
  `domain:devx` 的 #5957 / #5330 / #6381 也落在 `packages/lint`。
- ⇒ **按「是否围着 spec 契约转」逐卡判**:契约门禁/生成器/lint 规则/报错散文/
  references 管线 ⇒ `spec-tooling`;一般开发工具面 ⇒ `devx`。这是 anchoring rule
  在 `packages/spec` 内那条显式例外的**延伸,不是第二套规则** —— 2026-08-07 拆分
  已写下判据的前半(「tooling 改围着契约转的机器」),本裁决把同一句话铺到这三处。
  拿不准的按 rule 4 误标路径 FLAG 回分诊,⛔ 不由 dev 代拍。

## 重新定价四方向实录

出处:step 3「阻塞解除后要给延后的那一单重新定价」—— 一轮之内四种方向各出现过。

本轮四种方向各出现过。**变便宜(且 issue 自己的成本估计同时过期)**:#5375(#5345)
去掉了「cube 风格数组也可作为输入」这条腿,`{member, operator, values}` 三元组自此纯属
私有中间表示,#5373 的 B 路线因此从正文写的「工作量最大」降为不跨 spec 的内部改动。
**没变**:#5431(#5373)对 #5374 —— dev 明确回报「**没有**让它变简单,也**没有**顺带
修好它」,调用点现在收到真值而非字符串化的值,但「`{$not: 'x'}` 约束不了任何东西」在
算子层,与比较数编码正交。

默认假设(「前一单大概让它变简单了」)本轮**错了两次、对了一次**,而两个方向的代价
不对称:误以为变简单 → dev 按缩小的范围做,漏修;误以为没变 → 走一条已经没必要的贵
路线。所以这不能由 PM 推,只能由在飞那单的 dev 答 —— 本轮正是该必答项的**否定**回答
直接决定了 #5374 不能缩范围(见 PR #5445 的「范围之外」段)。

## 编译面清单三次漏面

出处:step 5「过滤 / 谓词语义裁决」标准条款 —— 三次漏面,全部留在代码注释里。

- **#5146 → #5903**:裁决只落到面 1,面 2 是**不继承面 1 的独立编译器**,于是同一个
  驱动的两种连接模式对同一条过滤给出两种答案。现场记录在
  `driver-turso/src/remote-transport.ts:1731`:「LOCAL mode inherits that fix
  (`TursoDriver extends SqlDriver`), this independent compiler inherited none of
  it」。
- **#5326 / #5335**:面 3 与面 4 各**又花一圈**才对齐,记录在
  `spec/src/data/filter.zod.ts:370`。
- **#5905**:#5298 的裁决由 PR #5962 落到 driver-sql / formula / service-analytics
  与 conformance 表,**唯独漏了 HAVING 面** —— `objectql/src/having-filter.ts:37` 的
  原话是「was not in that PR's inventory, which left this file as the lone
  holdout」。**「inventory」这个词本身就是本条款的缺席证明**:那次派发确实有一份清
  单,只是它不完整,而没有任何机制要求它完整。

三次都不是难度问题,是**没有一份清单在问「还有几面」**。

## 便宜选项两次证伪

出处:step 5 派发令三分区的「第三块」—— 同一班两次把便宜选项写成已裁定,两次被 dev 证伪。

#6865 的卡自带
一条「断言 job 上没有 `if:`」的验收写法,照做会把**四个正确的 job** 判红;#6893 的
派发令把「把 `content/docs/releases/**` 排除出审计范围」写成「亦可辩护」的选项,
而那正是 #4920 明确否决的 option A —— `scripts/docs-audit/check-audit-scope.mjs`
在该目录**离开审计范围时直接 `process.exit(1)`**,脚本注释逐字点了 #4920 与 #6893。

## os-regen 清单第二份拷贝

出处:「入队与落地 A」—— #6492 的三读数矛盾实录;文中「(见下)」指主文件 A 节的四步序。

协议此处一度
内嵌一份路径拷贝,于是同一件事有了三个互相矛盾的读数:散文说「八条」、紧随其下的
代码块列**九**条、`.gitattributes` 实际路由**十**条(缺的是
`packages/spec/authorable-defaults/**`)。更要命的是漂移**还在加速**:#6492 分诊
两次测量之间(同一天,相隔约一小时)清单本身又动过,两次读数就不一样。一份「读起来
完整、实际不完整」的清单比没有清单更贵 —— 派发令照它枚举,dev 拿到的是一张自称
齐全的漏项检查表,而 os-regen 的失败是**静默**的(见下)。

## 判死基线样例与两次误判

出处:step 6「45 分钟是发探针的门槛,⛔ 不是判死的门槛」—— 样例基线表与两次误判;文中「上面五条」指主文件探活规程五条。

  | 出处(车道 / 日期) | 卡片形态 | 实测端到端 |
  |---|---|---|
  | `domain:spec-surface` 席,2026-08-07(#6393) | 文本面卡:#5767 / #5622 / #5955 / #5783 | 93 / 96 / ~95 / ~110 分钟 |
  | `domain:devx` 席,2026-08-07(#6393 认领评论) | 混合:#6251 / #6038 / #6405 / #6359 | ~67 / ~64 / ~160 / ~170 分钟(后两单含长 CI 等待) |

  合两席九单:同一天、同一套工具下,端到端跨越 **~64 分钟到近 3 小时**。凡把单一
  数字当判死线的读法,都会在这个跨度里翻车 —— 所以要建的是**你那一栏**的基线。
- 两个座位当天各误判一次,都栽在这条线上:`domain:spec-surface` 席在 92 分钟处
  写下「#5783 将判为不可靠」,而它在基线之内、几分钟后就推了分支;`domain:devx`
  席在派发 2 小时处判两个 dev「静默结束」并把「重新派发」写进了下一枪定点,而两个
  都在做深度取证。后者靠**先 SendMessage 问状态、而不是直接重派**救回 —— 那正是
  上面五条的第一条。

## 第三档带前提裁决实例

出处:step 8「第三档:带前提的裁决」—— 实例与单列理由全文(#7498 的行数预算搬移);
文中「上面」指主文件该节。

实例:#5373 给了 A/B/C 三条路,正文写「这是本面数据表示的公开形状,请 PM/维护者裁」——
按上面的门槛读,它像要升级的那一类。实际裁了 **B**,前提是「这个三元组现在是纯内部表示」。
dev 用五项检查验证了它,其中一条是**反向证据**:`spec/src/api/analytics.test.ts` 与
`runtime/src/http-dispatcher.test.ts` 各有一条测试断言 cube 风格的 `filters` 数组会被
**拒收** —— 直接证明该三元组没有线上格式。最终 PR 未触碰一个 spec 字节。

值得单列的原因:它让 PM 在信息不全时**做决定而不靠猜** —— 决定自带检验。既不是「自己拍
了算」(那要赌前提),也不是「升级」(那要占用维护者时间去回答一个代码可以回答的问题)。
第 3 条最容易被省掉,而省掉它就退化成最坏形态:前提不成立时 dev 自行改选,那正是**无人
裁决**的状态,且没有任何读数会显示它发生过。

## 决策继承正反例

出处:step 8「两条元判据」第一条「静默丢弃的声明,默认并入既有拒收集」—— 正反出处全文。

出处:#5714 把 `pool`-on-sqlite 裁成编写期错误之后,#5931(`memory` 支)仍占了一个
槽位,而它只是那条裁决的一词之差的外延;同族重复整周都在发生。反例:#5739(维度侧)
的理由是「拒收会连带拒掉今天已经能跑的查询」,该理由在**度量面上被证伪**,所以 #5918
另裁一次是对的。别让「同一个键」这个表面相似度替你做判断。

## 治理侧胜出三例

出处:step 8「两条元判据」第二条「一个操作两个实现,默认治理侧胜出」—— 定案与三例全文。

出处:cloud#896(hostname)即此形定案;cloud#1147 的三个待答问题(重装 = UPSERT、
卸载 = 软停用、外部词表 = manifest id)按本条全部落在治理侧;objectstack#4636 的
B 选项是同一形状。

## 业务需求轴改判正反两例

出处:step 8 评估轴「实际业务需求」—— 先例全文(#7498 的行数预算搬移)。

已发布但零消费的「能力」**不因沉没成本获得豁免**:#5021(主题排版 9 组)、
#4988(交互配置 22 站点)、#4834(plugin-runtime 五 schema)是先例。
这条轴会**改变结论**,不是陪衬,正反两例都有:#5021 因无业务拉动裁
退役,#4936 则因 showcase 自证了业务方向而裁「响亮拒绝而非退役」——
只看后两条轴,这两单会得出同一个答案,那是错的。

## 两种失明机理

出处:step 5 Prompt template「下沉进 os-dev 定义的那三条验证条款」—— 两段机理全文
(#7631 批次的行数预算搬移);文中条款正文住 `.claude/agents/os-dev.md`。

- **时序错(#6371)** —— 包集合对,但读的是过期事实。新 worktree `pnpm install`
  之后直接 `typecheck` / `test`,跨包依赖的 `dist/*.d.ts` 要么不存在要么陈旧。
  它**两个方向都骗人,且骗法不对称**:*假红*只烧时间(dev 去修一个不存在的问题
  —— #6203 烧了三个来回,#5962 报了 15 个包的红);*假绿*更危险 —— 收窄了导出
  类型,下游读的还是**旧** `.d.ts`,于是下游 typecheck 报绿,而那个绿**什么也没
  证明**,dev 会把它当作「消费半径已清扫」写进 PR,复核方从报告里看不出区别。
  同一天连咬三个 dev(#5962 / #6210 / #6203)。正面样本是 #6212 的 A+E 批:PR 里
  点名「driver-sqlite-wasm 读的是 driver-sql 重建后的 `dist/*.d.ts`」,先 build 再
  typecheck,**并且**用一次故意的反向验证坐实自己确实读到了新 `.d.ts`。
- **方向错(#6218)** —— 扫的包集合本身就不相关。pnpm 的省略号**有方向**:
  后缀 `'pkg...'` = 该包 + **它依赖的**(上游闭包),前缀 `'...pkg'` = 该包 +
  **依赖它的**(下游消费者)。#6210 收窄五个驱动的方法签名后按后缀扫,报告
  「25 个包全绿」,CI 全仓 typecheck 随即红在 `@objectstack/dogfood`(120 个任务
  118 绿)—— 那句「全绿」在方法论上与被测风险完全无关,却读起来像一次充分的清扫。

## 共享一致性覆盖三轴实录

出处:step 5「多面组件:测试落点是共享一致性覆盖」—— 实证全文(#7631 批次的行数
预算搬移);不变量引文与适用判据留在主文件。

`driver-memory` 有三个过滤面(`find` 的 live path、参考匹配器、analytics/cube 面)。让
那批缺陷活下来的不是难度,是**没有一条断言在问** —— #5345 之前,共享一致性表
`FILTER_LOGIC_CASES` 只盯住其中两个。本轮三次派发都写了这条,三次都兑现,并且长成
**三条正交的轴共用一条不变量**:#5375 是过滤器**形状**(组合子、算子词表)、#5431 是
**比较数类型**(布尔 / null / 数字样字符串)、#5445 是**算子**(每个声明的算子编译出的
谓词是否真的排除行)。

第三条轴还带了「declared = enforced」的另一半:`ANALYTICS_FILTER_CAPABILITIES` 声明的
**每一个**算子都被驱动着走两条路并必须一致,且**探针必须至少排除一行** —— 否则「一致」
什么也证明不了,那正是 #5374 的形状。

## 拒收用例两种失明实测

出处:step 5「拒收类用例的最低断言集是 `code` + `status`」—— #6142(#6050)反向
验证实测全文(#7631 批次的行数预算搬移);条款原话与「一句话」结论留在主文件。

- **裸 `Error` ⇒ 恒绿。** 删掉拒收闸后 `driver-sql` 28 例红 22,**多数红在抛出 knex 的
  裸 `Undefined binding(s)`** —— 一个 `code` / `status` 均为 `undefined` 的 Error。未修的
  驱动本来就抛,缺的只是信封:只断言「它抛了」的用例,**在本单所针对的那个驱动上保持
  绿色**。
- **从不抛的 transport ⇒ 红,但红得不指向缺陷。** 同一次删闸,`driver-turso` remote
  29 例红 20,**20 个全部**红在「本该拒收却编译出了 SQL」—— 该 transport 从不抛。只断言
  抛出的用例在这里报的是「promise 没有 reject」,说的是**没抛**而不是**没信封**,分不开
  「拒收了但信封错」与「根本没拒收」—— 而这正是这一族的两个缺陷。

## 收益穿过边界实例

出处:step 7 复核清单「收益穿过它必经的那道边界之后还在吗?」—— 实例全文(#7631
批次的行数预算搬移);判据句留在主文件。

实例:整条 filter 链的价值是
「拒收要说清楚作者错在哪」,而 `packages/rest/src/rest-server.ts` 的两处 4xx 直通**曾**把
`message.length >= 500` 的错误**整条替换**成 `'Request failed'` —— 不是截断;
`driver-sql` 的 `$null` 拒收实测 606 字符,越线,于是 REST 客户端拿到的是
`{ "code": "INVALID_FILTER", "error": "Request failed" }`:`code` 到了,**正文一个字
也没到**。反直觉的一层:不带 `status` 时原文完整直通,带上 `status: 400`(#4436 为进
ADR-0112 信封特意加的)反而被这道闸门吞掉 —— 写得越精确的拒收越确定送不到。**四个 PR
合入,没有任何人在复核里查过这件事**,直到一个 dev 在做别的单时顺手撞上(#5423,已按
「截断而非替换」修掉)。缺口不在那段代码,在清单里:本条补的就是它。

## 死代码删除核引用面标本

出处:step 7 复核清单「以『死代码 / 不可达』为由的删除」—— #5445 标本全文(#7631
批次的行数预算搬移);imperative 与查法指引留在主文件。

#5445 删掉
`memory-analytics.ts` 里两条映射(`'inDateRange': '$gte'`,注释自称 "Will need special
handling" 却无任何调用点实现;`'notSet': '$exists'`,方向还是反的)。dev 给的推理成立
(无条目降级到该名、`timeDimensions` 走 Stage 2、两个出口都只消费 `normalizeFilters`
的输出),但推理可以错,而 grep 只花十秒:

```
git grep -n "inDateRange\|'notSet'" origin/main -- 'packages/**/*.ts'
```

确认 `driver-memory` 内只有被删的那两行引用,其余命中全部落在 `service-analytics`
—— **另一个包、另一套 strategy**,不受影响。

## 代执行出处一例

出处:State model「代执行他人指令的关闭/作废,评论里必须带指令出处」—— 实测全文
(#7631 批次的行数预算搬移)。

PR #6668(一份 draft、全绿的 ADR 草案 —— 因未合并,它提案的那个编号从未签发)
被兄弟席位无说明关闭,本席读作误扫,重开
并发跨席询问;维护者随后说明那是**他本人的指令**,遂按原话重新关闭并把出处附在
PR 上。写那行出处要 20 秒,查「这是不是误操作」要一个跨席往返。
(同一个 PR 的另一半沿革 —— 维护者以「没人要这个能力」结案 —— 在 Guardrails 的
ADR 条款里,那条讲的是**决定**,本条讲的是**执行记录**。)

## 解锁扇出两标本

出处:step 3「解锁扇出优先」—— 2026-08-07 解锁扫描实测两标本(#7631 批次的行数
预算搬移)。

**#5702** 自 08-06T06:47Z
起可派发、压了约两天没人扫,身后排着 #5814 / #5893 / #6337 三张;**#6428** 更尖锐
—— 它不带任何优先级标签,却挡着 #5491 + #5492(维护者当日裁定必须同批落地的
v17 安全批的两半),#5492 自己又挡着 #5493。

## objectui 板无生产者读数

出处:发版板「每个 backlog 恰好一个生产者」—— objectui 行的立据读数(#7631 批次
的行数预算搬移)。

为什么补这条(实测 2026-08-09):objectui 的 `target:v17` 只在 2026-08-06/07
那次审计用过 7 次且全部已闭,此后本地 backlog 长到 117 open / 48 `pm:queue`
(立单读数;#6906 的 PR 复测 119 / 52)而板上 open **0** 条 —— 「随 console bundle 入板」有消费方却**没有常设生产
者**,而控制台正是从这个 backlog 发出去的。

## #5032 认领撞车与让行实录

出处:step 4「Race check」与「Yielding is a handoff」—— #5032 实录全文(#7631 批次
的行数预算搬移)。

#5032 is
the 20-second version: claims at 00:39:44 and 00:40:04, the later one
composed **without re-reading the thread** — and both aimed at
`pnpm-lock.yaml`, where two parallel re-resolutions produce mutually
unmergeable diffs. The dispatched dev caught the collision on its own
pre-code re-read and stood down with zero files touched.
In #5032 the yield handoff (the offline
scanner repro, `pnpm why` chains for all three packages, and live proof
that the existing undici override's exclusive upper bound had
self-invalidated) was consumed directly by the winning dev, whose PR
#5052 was up within half an hour of the yield.

## 半标注卡四次实测

出处:step 0「为什么 2、3 不是可选项」—— 四次实测与两个生产机制全文(#7631 批次
的行数预算搬移)。

同形已四次实测(两次各停滞整日,一次同日六张 11:00–13:55Z 立、16:47Z 才被两个 PM
会话**手工**报回来才捞起)。

- 析取 2 的生产者是**协议本身**,不是某个车道的坏习惯:跨座位转移卡(转出方
  按转移协议自带 `pm:queue`)与队列管家 Routine 的队列健康卡,**按设计**预先
  带队列标签,又**按单一生产者规则不准自打 `domain:*`**(管家原话:「no
  `domain:*` / `repo:*` label applied — routing labels are the triage seat's
  single-producer territory. Only `pm:queue` is set here.」)。于是它们在看板上
  显示可派、实际**谁都不能认领**。
- 析取 3 那张实测卡是**分诊自己写的纪律的反例**:同一条「立单方别自打
  `domain:*`、留给分诊」当天早上刚写在另一张卡上,几小时后 PM 立单时照犯,
  卡片对队列与扫描同时隐身 ~69 分钟。

## #5085 推断中止误判对照

出处:Operational notes 11 —— #5085 全文(#7631 批次的行数预算搬移)。

#5085 的
dev 子代理零推送、零分支就没了(子代理正常的 `/compact`/中断死法,step 6 的探活与
step 5「Handing off an interrupted dev」讲的就是它)。前任 PM 把它**推断**成
「维护者手动中止」,设了「是否重派等维护者示意」的门:该门从 08-05 07:00Z 立到
08-06 02:42Z 解除,**近 20 小时**压着一个 p0-邻近的真 bug,直到维护者本人确认
「没有中止」才发现是误判。同一条 #5085 上两种都出过:08-05 07:00Z 那次是推断
(误判,门压近 20 小时),08-06 04:12Z 那次是宿主信号(真中止,维护者两分钟后
示意重派、门即解除)。两次的症状(零推送、无分支)完全一样。那次
的门只写在「认领解除」评论里、标签退回了 `pm:queue`,于是队列视图显示可派发而
谁也不敢派。

## 读取端截断三例误判

出处:Operational notes 12 —— 三例实录全文(#7631 批次的行数预算搬移)。

#5148 / #5149(2026-08-05,分诊座位)与 #5164(cli 车道 PM)被判为「正文已被 GitHub
sanitizer 截断,不可分诊/派发」,据此挂起并要求原作者重贴。事后以两种读法复核 ——
REST 取 `body`(原文 4321 / 5183 / 4181 字符)+ 取 `body_html`(渲染版)—— **三条
正文都完整**,`<object>` / `<id>` 一类占位符全部落在行内代码或围栏内、未被吞。
三条判读均不成立,真因是**读取端(工具输出)截断**被误读成 issue 端截断;代价是
三条 issue 各白停摆 1–2 天(#5148 是有脚本化复现的可入队缺陷,#5149 / #5164 是
应当尽早进维护者决策箱的裁决卡),外加三张打给作者的假工单。

## #5584 advisory 红合并毒化

出处:Operational notes 10 —— #5584 全文(#7631 批次的行数预算搬移)。

PR #5584 的新测试文件触发 `check:engine-double-contract`(这一族门禁挂在 **ESLint
job** 里),该 job 19:53Z 结论 `failure`,而 PR 在红了 **19 分钟后照常过队合并**。
合并后,`main` 上这条红被 merge ref 带进**每一个后续 PR 的 ESLint job**,#5601 等
直接中招;热修 #5615 才解除,治理侧另立 #5617。

## 立单查重两反例

出处:Operational notes 9 —— 两例全文(#7631 批次的行数预算搬移)。

#5039 是反例:为一批 OSV 公告立单前没有做任何搜索,而 #5032 六分钟前已为同
一批公告立单、且分析更全(逐包 `pnpm why` 归因 + main 上的逐条复现证据),
两分钟后 #5039 只能关成 duplicate。代价不止两分钟:两条单各自吸走了一次认
领,直接诱发了 #5032 上相隔 20 秒的认领撞车(见 step 4)。同日另一例:
#4946 与 #4945 各自为同一条 brace-expansion 公告立单,后立者关 duplicate。

## 共享基础设施回退一例

出处:Operational notes 8 —— 边界外一例全文(#7631 批次的行数预算搬移)。

PR #4864(本线)与 PR #4856(另一车道)修的是**同一个
基础设施问题**,却挂在不同 issue 号下,门禁看不到任何重复。更糟的是 #4856 先合了
`testTimeout: 60_000`,**#4864 若合进去会把它降回 30s**,即一次静默回退。

## 单正文座位表互吞

出处:「座位贴协议」首段 —— 单正文时代的互吞机制全文(#7631 批次的行数预算搬移)。

座位登记曾是 #4604 单正文里的一张表,12 个座位共编一个 body;issue 正文更新是
**全文覆盖**(PATCH 整体替换,无条件写入/CAS),从过期快照出发编辑 = 静默回滚
其它座位的行 —— 与 os-regen 静默吞并同形:操作成功、零冲突标记、丢一侧改动,
08-06 一天内多次实测互吞。

## 计划内压缩成本依据

出处:step 9「波次收工点」—— 成本读数全文(#7631 批次的行数预算搬移)。

成本依据(#6806 云卡在飞约 2 小时的读数):`cache_read` **10.18M**,
未命中 input 仅 **6.9K** —— 边际每轮成本 ∝ 已积累上下文长度,随班龄单调增长;而
**「不压缩」并不保全上下文**:自动压缩时点不可选、裁剪者不知道哪些判断链重要。
计划内压缩在两个维度上严格占优(时点取在飞归零,裁剪者是知道轻重的在任 PM)。

## 转述断言重验三例

出处:step 5「派发令里的清单、路径、行号,一律在派发那一刻从树上取」的 ⚠️ 段 ——
实测明细(#7631 批次的行数预算搬移)。

连「门禁清单 = `lint.yml`」这句本身都是记忆形状的断言:该卡实测 61 条
`pnpm check:*` 在 `lint.yml`,另有 7 条散在 `ci.yml` / `spec-liveness-check.yml` /
`validate-deps.yml` / `release.yml` / `showcase-smoke.yml`。同形错误刚在 #6865 上
发生过 —— 转述进派发令的六个 required-context 名里,**四个其实住在 `ci.yml`**。
#6673 的「第三处提示串在 `protocol.ts:4780`」实测落在另一个函数、另一条轴上。

## #6413 解锁前提旧行号标本

出处:step 3「解锁那一刻」第一条 —— #6413 全文(#7631 批次的行数预算搬移)。

#6413 是标本:#5055 的 PR #6385 于
17:39:30Z 合入,分诊席 17:54:18Z(**15 分钟后**)贴出「前提已核」并援引
`widget-contract.mdx:14/:181/:184`、`quick-reference.mdx:55` —— 那些行号**只**匹配
`f7bd4e235^`(合并前的父提交),#6385 本身已经重写了其中一页(+62/−156)、改指了
另一页的行、删掉了该行链接的生成页。车道席 23:17:06Z 的解锁裁决又把这份未经复核的
说法原样带了下去。两处旧条款(step 1 陈旧前提检查、解锁扫描)**字面上都被满足了**
—— 它们查的是**上游的状态**,不是**卡在上游 ref 上的前提**。最后是 dev 用
premise-first 纪律顶回来的:`premise_still_valid: false`、零字节改动。

## #6190 收窄断言被证伪

出处:step 3「解锁那一刻」第二条 —— 实测全文(#7631 批次的行数预算搬移)。

实测:`domain:metadata` 席在 #6190 的解锁评论里断言该卡已被
PR #6478「实质收窄」,dev 验证**证伪**了它 —— #6478 只关掉了 overlay 那一层,
`allowRuntimeCreate` 那层仍在铸 org-scoped 行,原症状完好。

## L2 即报契约与决定性实测

出处:step 7 复核清单「报告在草稿 PR 时点到达」—— 全文含选 B 弃 D 决定性实测(#7754 批次的行数预算搬移)。

- **报告在草稿 PR 时点到达 —— CI 收敛读数自此只属于复核侧(#6644 L2,维护者
  2026-08-10 裁定)。** dev 的契约是「推分支 → 开 draft PR → 立即交报告」,报告里
  的 gate 状态照实记(`in_progress` 是诚实读数),⛔ 不等收敛 —— 所以「报告到了、
  CI 还没绿」是**预期内**的常态,不是异常。选 B(即报)弃 D(前台等到收敛)的
  决定性实测(2026-08-10):4 个在飞 dev 死 2 个(#6041、#6906),死点全在
  **活干完、报告未达**之间 —— #6906 连 commit 都打好了、分支未推;前台等待防不住
  进程重启,把报告时点提前到 push + draft PR 即刻才把这扇窗压到最小。守门职责
  **移交**到本侧,不是删除:arm auto-merge / 入队前**亲核门禁 job 的结论** ——
  不止 `pull_request_read get_status` 那个聚合读数,要看 ESLint 与 TypeScript
  Type Check 这两个具体 job 的 `conclusion` 已为 `success`(门禁族都跑在它们
  里面,Operational notes 10;#5584 的 advisory 红就是没读结论、红着合并进 main
  的)。这道读数现在是**唯一的一道**(本地门禁已按面收窄,step 5 / os-dev「Local
  verification scope」;dev 侧的收敛等待已随 L2 移除),⛔ 不要因为报告写了
  「本地绿」就跳过它。收敛期间转红的门走补丁轮(SendMessage 续派原 dev,REWORK
  那条)—— 多花的 push-fix 回合是这笔交换**已经付过**的价钱,不是 REWORK 的
  理由;红着合并才是。PM 侧与之配对的机械动作是「入队与落地 B」的 flip 定点 +
  队列看护 —— 那一段自此是 L2 的 PM 半边;派发令可对重量级卡显式写「本单等 CI」
  (step 5 模板的每单覆盖条款),只有那时 dev 侧的收敛等待才回来。

## premise 证伪四例

出处:step 7 复核清单「dev 是否验证了前提」—— 同日四例全文(#7754 批次的行数预算搬移)。

  that accepts every stated cause at face value is the one to read twice. Four
  same-day cases: #4808 (the issue was half right — the real truncation was in
  pruning, not the TTL), #4813 (the technical rationale the PM supplied was
  disproved by measurement and the dev's was harder; the issue body's wrong
  attribution became #4873), #4825 (the issue's option 2 was killed by
  call-site evidence), #4790 (previous day, a fixed-window conversion
  rejected). When a dev corrects the PM, **acknowledge it in the open** — the
  correction belongs in the PR/issue comments so the next reader inherits the
  corrected premise, and a wrong premise still sitting in an issue body gets
  its own follow-up issue rather than being silently dropped.

## #5452 验收判据证伪标本

出处:step 7 复核清单「验收判据本身也是前提」—— #5452 标本全文(#7754 批次的行数预算搬移)。

- **验收判据本身也是前提的一部分,可被 dev 证伪。** #5452 的 issue 把验收写成
  「某条字面 grep 归零」,dev 实测证明该 pattern 修前修后命中数不变(修好的
  正确输出同样匹配它),于是改钉真不变量(行内代码跨度花括号配平)做门禁,
  并因此多抓出 2 处 issue 的 grep 天然看不见的同根因缺陷。评审姿势:dev 用
  测量推翻字面判据、换上等价或更强的不变量门禁 = 好运行,照 ACCEPT;但推翻
  过程必须写在 PR 正文里,且新判据要附在 main 语料上的实测信噪比(误报为零
  的证据),否则按 REWORK 要证据。

## 事件载荷闸历史坑

出处:step 7 复核清单「skip-changeset」—— #5497/#5502/#5625 历史坑全文(#7754 批次的行数预算搬移)。

- **Tests/docs-only PR 走 `skip-changeset` 标签,不走空 changeset**(空
  changeset 滞留发布,#4898)。标签由 PM 在验收时打。历史坑(#5497/#5502
  实测):该闸曾从**事件载荷**读标签,rerun 重放旧载荷看不见新标签,得靠
  「摘掉再打回」制造新 labeled 事件 —— **#5625(#5580)已根治**,闸门改为
  实时读 PR 标签,rerun 即翻绿。留此一条是因为它是一类通病的标本:**任何
  从事件载荷而非现状读判据的闸,rerun 都复现旧世界** —— 撞上同形状的红,
  先查该闸读的是载荷还是现状,再决定是补事件还是改闸。
  边界:改动若含读者可见的生成产物(如参考文档),dev 选 changeset 而非
  标签是对的 —— 以 PR 正文说明的理由为准,两条路都有效,别来回改。

## +0/-0 NUL 标本

出处:step 7 复核清单「`+0/-0` 不是空文件证明」—— #4870 标本与修法全文(#7754 批次的行数预算搬移)。

- **`+0/-0` in a PR diff is not proof of an empty file.** git renders a file
  as binary — zero added, zero removed — as soon as it contains a NUL byte.
  #4870's 347-line test file showed `+0/-0` and was briefly misread as an
  unfinished placeholder; it was one bare `0x00` in the body, which
  `pnpm check:nul-bytes` rejects by design. On any `+0/-0` entry suspect NUL
  first and an empty file second, and settle it on the blob rather than the
  diff (`git show <sha>:<path> | wc -l`). The fix always belongs in the
  source: write the escape sequence `\u0000`, which is byte-identical at
  runtime and is the convention `scripts/check-nul-bytes.mjs` enforces. A
  raw NUL is never the right authoring choice: it also makes the whole file
  invisible to grep, which is how the defect hides in the first place.

## #6732 路径分叉由来

出处:step 7 ACCEPT 路径分叉 —— #6732 由来全文(#7754 批次的行数预算搬移)。

  入队。**
  上一段那条一般规则**没有错,而正是它正确执行的结果触发了被禁止的动作** ——
  #6732 不是谁「决定要合 ADR」,是 ACCEPT 照章办事,把一份已复核、全绿的 dev PR
  推进了合并队列。所以这个判据必须落在**手动之前**,而不是只写在 Guardrails 里
  等人事后对照:一个先读 Guardrails、再读 ACCEPT 的 PM,做的是 ACCEPT 说的事,
  因为手在这里。维护者裁决原文见 Guardrails 那条(引用、未翻译)。

## #6190 Fixes 误标实测

出处:step 7 ACCEPT「`Fixes` 还是 `Part of`」—— #6190 / PR #6600 实测全文(#7754 批次的行数预算搬移)。

  **开着的** issue:卡一关,那个待裁问题就此无人可见,且没有任何读者会知道它消失过。
  实测:#6190 的 dev 把 loud-log 那一半开成 PR #6600 时带的是 `Fixes`,复核时抓到、
  入队前改掉(dev 改后回读:`Fixes objectstack` 命中 0 次);若照原样合了,那个
  两问的契约裁决就从收件箱里蒸发了。**翻 ready 之前亲核首行**,别只信报告(#6644)。

## #3682 sweep 产物成组实测

出处:step 7 ACCEPT「sweep 产物成组列出」—— #3682 实测全文(#7754 批次的行数预算搬移)。

  「范围外发现照旧单开」(PD #10)会一次性吐出一**批**卡:#3682(ADR-0106,L,
  `mode:cloud`)一次派发就产出 3 张退场审计 finding(#6599 / #6601 / #6603)+ 1 张
  跨座位转席卡(#6622)+ 1 条决策箱上报,另有 3 处 ADR 自己没点名的退场在 PR 内修掉。
  这个量级下,分诊席需要它们**作为一个集合**到达,并且要知道**这次 sweep 的判据是
  什么** —— 否则就是一小时内飘来五张互不相干的卡,只能一张张重新推断关系。所以
  ACCEPT 评论里列成一块,并写明 sweep 判据,让分诊能一致地给整批定级,而不是逐张
  各判各的(#6644)。

## 串行接力语义交接实例

出处:step 7「串行接力」纪律 2 —— #5318/#5319 实例全文(#7754 批次的行数预算搬移)。

并要求「两个 PR 的意图**叠加**,⛔ 禁止机械取一边」。实例:#5318 与 #5319 同动
`packages/spec/src/system/metadata-form-zod-reconciliation.test.ts`,#5319 逐行号核过
#5318 新增的十项元素、并实测两者的交互 —— 没有 #5319 的 preprocess 修复,#5318 的新
断言在 view 上是空转的。取一边会「各自绿、合起来错」,即 AGENTS.md §10「clean merge
不等于 working merge」落在同一份测试文件上的形态。

## 决策卡前提刷新全文

出处:step 8 升级序列第 1 条 —— 前提刷新与 re-check 命令必备件全文(#7754 批次的行数预算搬移)。

1. **先刷新卡片的前提 —— 落卡与复升级都适用。** 决策卡写下的每条前提(某个在飞
   PR 还没合、某能力还不存在、某文件还是那个形状)都是**有保质期的读数**:main
   一天 ~18 合并,跨仓事实按小时变。落卡**之前**、以及把一张旧卡重新推到维护者
   面前**之前**,逐条复核一遍,失效的就地改写或撤卡 —— **隔夜没动过的卡,默认按
   「前提未经验证」处理,不是按「还在等答复」处理。** 出处是决策箱第 2 轮的实测:
   cloud#1148 的 A/B 卡在**写下前 ~50 分钟**就已失效(它等的那个上游 PR 已经合了),
   cloud#812 一张卡带三条过时前提。前提过期的卡比没有卡更贵 —— 维护者会照着一个
   不存在的世界做裁决,而卡面上没有任何读数会显示这件事发生过。
   **模板必备件(#7341 item 8):卡上每条前提行自带一条 re-check 命令** ——
   `git log origin/main --oneline -5 -- <path>`、REST `compare`、带引号精确名的
   `git grep`、`git ls-remote --heads origin | grep <branch>`……写卡的人当场就有
   这条命令(它就是建立该前提用的那条),抄上去的成本是一行;省掉它,上面那次
   复核就从「跑命令」退回「重做研究」,而研究没人重做,卡就带着死前提上桌。
   复升级时逐条**跑**一遍即可,零命中/变形的前提就地改写或撤卡。

## 波次收工点换人轮换阐释

出处:step 9「波次收工点」—— 换人轮换降级为班末动作的机理全文(#7754 批次的行数预算搬移)。

**换人轮换降级为班末动作**(换视角带来的免费证伪 —— step 5「dev 证伪 PM」那条的
PM 侧对偶),不再是班内节奏:同席压缩与换人的 token 账等价,但压缩**保全会话
绑定** —— PR 订阅、`send_later` 自绑定定时器、座位贴登记的会话 ID、对云卡的父子
关系全部不动,三处同笔的接管协议也免了。**Routine 座位不适用**:它每 fire 一个
新会话,本来就是从 GitHub 重建(见「座位 Routine 化」)。本条唯一的前提是本文
开篇那条不变量 —— **GitHub 恒为唯一权威,上下文只是工作缓存**;它失守时,压缩就
从「丢缓存」退化为「丢判断」。

## ADR 人工合并条款判据阐释

出处:Guardrails「ADR 由维护者确认、由维护者人工合并」条 —— 判据阐释、worked example 与权威落点全文(#7754 批次的行数预算搬移)。

  改动的落地是人的行为,绿灯只说明机器没意见。为什么偏偏是 ADR:按 AGENTS.md
  PD #13,accepted ADR **就是**那个决定本身,合并它等于采纳一个治理立场 ——
  正好是「CI 绿」零信息量的那一类。worked example **#6668**:一份彻底、全绿、
  测量无误的 ADR 草案,维护者以**没人要这个能力**为由关掉,那是任何门禁都评不
  出来的判据;反方向的代价见 #6191 / #6483(一次没有 ADR 的 ADR 级反转,至今
  还在拆)。PM 侧的终局动作见 step 7 ACCEPT 里的路径分叉 —— 那一段才是手真正
  会动的地方。本条的仓级权威落点按 #6741 要求 1 是 AGENTS.md(PD #13 旁;截至
  本条写入时那一半尚未落地,落地后照本节末行的既有优先序以 AGENTS.md 为准,
  这里是 PM 循环侧的执行拷贝)。
## 探活规程实测背景

出处:step 6「探活是每轮巡检的固定动作」—— 五条规程的实测背景全文(#7754 批次的行数预算搬移)。

**探活是每轮巡检的固定动作 —— 完成通知不可靠,它的缺席什么都不证明。**
下面的停摆纠偏处理「带任务中状态的通知到了」;这一条处理更隐蔽的另一半:
**通知根本不来**。宿主进程重启会把运行中的 subagent 连同其完成通知一起
静默杀掉 —— 2026-08-05 实测,五个「在飞」dev 里三个(#5050/#5515/#5483)
已死数小时,批次视图仍显示 5/5,实际吞吐 2/5,零信号。规程五条:

- 每次巡检(定时器唤醒、轮间隙)对**每个已派发且报告未达**的
  dev 发一次状态询问(SendMessage,措辞「回一段简报后继续干活」,不改变
  任务);派发后 ~45 分钟无任何远程产出即到探活门槛。⛔ 已有远程分支/PR
  不豁免 —— 触发面为什么这么宽,见下面「探活是常设兜底」。
- 两种回包都有价值:活着 → 拿到进度与阻塞点;**「no active task; resumed
  from transcript」→ agent 生前已死,这次询问本身就是复活** —— 从其
  transcript 带全部上下文恢复,比 worktree 接手协议(step 5)便宜得多,
  优先用它;resume 不可用时才走接手协议。
- 判据永远取正向证据(远程分支、PR、报告、探活回包),⛔ 绝不把「还没
  收到失败通知」读作「还在跑」。
- **定时器重挂是每次巡检的第一动作,不是最后一个**(维护者 2026-08-06
  授权)。巡检执行到一半被打断(穿插提问、事件风暴、会话中断)时,排在
  末尾的重挂会整个丢失,守夜链就此断裂 —— 2026-08-06 实测:一次漏挂让
  四连灭批静默了 ~100 分钟而不是探活门槛设计的 ≤45 分钟。先挂后查,链条
  对中断免疫;挂错了间隔可以在本轮末尾用 delete_trigger + 重挂修正,但
  「没挂」无法被本轮以外的任何机制补救。重挂的那一枪按 **notes 3 的定点
  文本写法纪律**写:以「幂等 —— 动手前先重读状态」开头、只写判据不写结论。
  巡检定点是最容易写成祈使句的一类(「⇒ 判为不可靠 ⇒ 重新派发」),也是
  投递时最可能已经过期的一类 —— 在飞的 dev 在两次唤醒之间会推分支、开 PR、
  交报告,而已 `delete_trigger` 的定时器仍会投递(notes 3 实测两次)。
- **批量在飞期间,主巡检间隔不得长于 45 分钟**(同一授权)。探活门槛是
  45 分钟,巡检间隔一旦超过它,门槛就成了写在纸上的数字 —— 最坏情形下
  一个派发后即死的 agent 要等到下一轮巡检才被发现,静默窗口 = 巡检间隔,
  而非门槛值。在飞清零的待命期可放宽到 60-70 分钟;有任何 dev 在飞即收紧
  回 ≤45,灭批频发期(如宿主重启风暴)进一步压到 20-30 分钟。

## 探活触发面证伪实测(7/7)

出处:step 6「探活是常设兜底」—— 2026-08-08 触发面证伪实测(7/7)全文(#7754 批次的行数预算搬移)。

**探活是常设兜底,不是异常通道 —— 而「PR 已经开出来了」不是豁免,那恰恰是失败
发生的那一格。** 上面第一条的触发面曾挂在「已派发且**尚无**远程分支/PR」上;
2026-08-08 的实测把那个口径证伪了:当天 **7 / 7** 个派发都是**在开出正确的 PR
之后**没能干净交回(#6586 / #6747)。失败的那一批**全都有远程分支、有 PR、有提交**
—— 按旧口径,它们一个也不会被探到。所以触发判据是现在这个写法:**探的是「报告
未达」,不是「分支未出现」**;远程产出只把一个 dev 从「可能还没开始」挪到「可能死在
收尾上」,它从来不是活着的证据(这就是上面第三条「判据永远取正向证据」里,PR 的存在
算哪一种正向证据的答案:它证明工作发生过,不证明 agent 还在)。

- **生产侧的条款不能替代它。** 那批里有 4 个的派发词逐字带着终止条款,其中 **3 个
  照样死了**(3/4)。成因在文档够不着的地方,所以兜底必须常设在消费侧,⛔ 不能写成
  「派发词写全了就可以不探」。
- **代价是延迟,不是正确性 —— 这既是它便宜的原因,也是回应只能是探针的原因。**
  至今每一例都能从 transcript 完整复活,**零工作丢失**:PR 在、分支在、提交在,缺的
  只有那段 JSON。所以 ⛔ 永远不要拿「重新派发」回应它 —— 往一个**可能还活着**的
  worktree 里塞第二个 agent,是用一个只花时间的问题去换一个会毁东西的问题
  (step 5「Handing off an interrupted dev」的碰撞面)。先探,拿到「no active task;
  resumed from transcript」这类回包再谈恢复。
- 与判死门槛的关系一字不变:本条只把**探针**的适用面铺满,⛔ 不降低判死的三类正当
  依据(见下一段)。已有 PR 的那一格尤其要守住这个分界 —— PR 全绿会让人很想直接跳到
  「报告丢失 ≠ 验收停摆」那条兜底验收,而那条的三个条件里第二条正是**探活确认已死或
  ≥2h 无推送**,不是「PR 看着能收了」。

## Stall 复位梯度实测

出处:step 6「A stalled subagent」—— 一夜 6 次停摆与复位梯度实测全文(#7754 批次的行数预算搬移)。

**A stalled subagent is this half's most common failure, and it never
self-heals.** When a dev stops mid-task reasoning that "a background watcher will
wake me", **that watcher never fires** — a completion notification is itself the
statement that no live subtask remains. Four agents stalled 6 times across the
2026-08-04/05 night, every one recovered by hand, ~1.5–2 h lost. Three rules:

- **State the execution posture in the dispatch/relay prompt** for any long
  verification pipeline:「**前台(阻塞)同步执行全部步骤,中途不停止、不把构建/
  测试挂到后台等唤醒**」.
- **A completion notification carrying a MID-TASK state IS the stall signal** —
  "build still in progress", "I'll resume when…". SendMessage it back
  immediately with that posture line attached; ⛔ do not wait out any silence
  threshold (the cloud-mode ~2 h below): a threshold is for *no* answer, not for
  an answer that says the agent stopped.
- **每一次复位比上一次更具体 —— 原样重发同一句话不算一次复位。** 2026-08-09 单班
  三个 dev 各自以「等我挂的后台定时器唤醒」结束回合(**自己挂的定时器不会唤醒
  自己**:完成通知本身就是「没有活的子任务了」这句声明)。两个在**点名该机制**的
  第一枪探针后恢复;第三个**在被告知之后立刻重复了同一个停摆**,直到第三枪
  **点名下一个该发的工具调用**、并**明令禁止任何后台等待**才恢复。所以复位有梯度:
  ① 复述执行姿态 → ② 点名下一个工具调用 + 明令禁止后台等待 → ③ 判 unreliable
  (下一条)。把 ① 原样再发一遍只是把同一个失败重放一次,却会把三次停摆的计数
  用掉一次 —— 梯度不是礼貌,是让第三次真的携带新信息。
- **A third stall means unreliable** — re-dispatch a fresh agent onto that
  branch under "Handing off an interrupted dev" in step 5 (worktree already exists,
  read every existing commit first, re-run the verification in full, claim and
  assignee untouched).

The **producer-side** half of this rule lives in `.claude/agents/os-dev.md`'s
resource discipline — fixing it at the producer beats patching it at the PM
(Prime Directive #12's instinct, applied to agent protocol); these three are the
backstop, not the primary fix.

## #5330 通知重放实测

出处:step 6「通知到达 ≠ 有新东西发生」—— #5330 重放实测与处置细则全文(#7754 批次的行数预算搬移)。

**通知到达 ≠ 有新东西发生 —— 第一眼读它是谁,不是读它带的 JSON。** 上一条处理
「通知带着任务中状态」;这一条处理另一半:通知**形态完全正常**、报告**完整且正确**,
而它只是同一份东西的第 N 次重放。#5330 一张卡发出 **6** 条通知,其中 **5 条是同一份
完整 JSON 报告的重放**(PR #6703;有一条来自一个盯着 agent 自己早已 `TaskStop` 掉的
运行的 monitor)。它们在到达那一刻与真完成**完全同形** —— 同结构、同载荷 —— 于是每
一条都被从头验收了一遍才发现是重复。**这个成本按到达次数计,由读的人付**:N 条通知
= N 次全套复核,除非第一眼读的是身份而不是内容。PM 侧的处置:

- **先算身份,再决定读不读内容。** 去重三元组:`(issue, 分支, PR head sha)` + 通知
  **自报**的守护对象。与本轮已验收过的那份逐项相同 ⇒ 在轮次台账上记一行「重放,
  首达时间 T」就结束,⛔ 不重新验收、⛔ 不重读 diff、⛔ 不重复留 ACCEPT 评论(重复的
  ACCEPT 评论会把审计线变成两条互相印证的假象)。
- ⛔ **不把它的到达读成「还活着」。** 重放来自一个按**自己的 deadline** 触发的
  monitor,与它的主体是否还在跑无关 —— #5330 那条守的正是一个已被取消的运行。活着
  的判据只有一个:探针回包。
- ⛔ **也不把它的不到达读成「已经死了」。** 这是同一枚硬币的另一面,与上面「绝不把
  『还没收到失败通知』读作『还在跑』」同源:重放一多,「最近有动静」这种读数就彻底
  失效,两个方向都不能再从通知节奏里读出状态。判死照旧只认那三类正当依据。
- **生产侧的自报是「变便宜」,不是前提。** dev 侧的对账写在
  `.claude/agents/os-dev.md` 的终止契约里(#6586):monitor 若仍触发,首行先自报它守
  的是什么、那东西还活不活着,再给 JSON。⛔ 但不要把去重建立在「对面会自报」上 ——
  同一批实测里,逐字携带终止条款的 4 个派发死了 3 个,携带率打不穿的成因同样打不穿
  这条。对面自报了就省一步,没自报就用上面那个三元组自己算。

## 座位 Routine 收集边界阐释

出处:step 6「座位 Routine 模式下的收集边界」—— 机理全文(#7754 批次的行数预算搬移)。

**座位 Routine 模式下的收集边界。** 一次 fire 就是一轮,fire 结束会话即销毁,
`mode:subagent` 的**返回消息**通道随会话一起消失。报告通道统一之后这不再是报告
丢失:dev 的终报同时落在 issue 评论(`<!-- os-dev-report -->`),**下一次 fire 从
GitHub 照常收到** —— 会话销毁丢的只是加速器。真正的边界因此移到**干活本身**:
一个在 fire 结束时还没跑完的 dev(既无评论也无返回消息)只能靠下一轮读 GitHub,
见下一段的取舍。跨轮未收的 dispatch 由下一轮按同一判据处置(~2h 无报告即
`blocked`),`delete_trigger` 的清理也顺延到收到报告的那一轮。

上面那三条**停摆纠偏**在 fire 内照常适用,但要注意它们的恢复动作是
`SendMessage` —— 那需要一个**还活着的对面**。fire 结束后没有可唤醒的 subagent,
停摆与「会话已销毁」在 GitHub 上是同一个读数(既无报告也无 PR)。所以座位
Routine 的取舍是:凡验证管线可能超过一个 fire 的活,**一开始就走 `mode:cloud`**,
把恢复权交给下一轮的 GitHub 读数,而不是赌它能在本轮内被唤醒。

## 舰队级死因与即报保险实测

出处:step 6「死因可以是舰队级的」—— token 断粮实测与即报顺序的保险论证全文(#7754 批次的行数预算搬移)。

**死因可以是舰队级的,那一格里探活半边同时不可用。** 2026-08-08/09 单班两次
**全账号 token 断粮**(~11:0x–12:10Z、~16:0x–17:1x),每次一口气打死四个在飞
dev —— 没有可探的对面,也没有可发的探针,三条件里能取的读数只剩 (a) 与 (c)。四张卡
**零信息损失**的唯一原因是**分支已推、draft PR 已开、且 PR 正文自带验证证据** ——
PM 走本条直接验收照常收口(报告丢了,PR body 就是报告)。⇒「推分支 → 开 draft PR
→ 立即交报告」这个顺序是**保险,不是效率优化**:agent 的死亡是常态而非异常,
而它可以在任意时刻、成批地发生 —— #6644 L2 把报告时点提前到草稿 PR 开出即刻,
正是把这份保险的空窗压到最小(2026-08-10 实测:4 个在飞 dev 死 2 个,死点全在
「活干完、报告未达」之间)。⛔ 但这**不**推出「把该顺序抄进派发令」:它是
无条件条款,已住在 `.claude/agents/os-dev.md` 的 Definition of done
(push → draft PR → 报告即刻,CI 收敛归 PM),按 step 5 的下沉纪律派发令只带增量;
本条是它在 PM 侧的**读法** —— 知道为什么那个顺序值钱,才不会在 dev 报告缺席时
误判为「要重派」。
## Model tiering 沿革

出处:step 5「Model tiering」—— 三次改版沿革全文(#7754 批次的行数预算搬移)。

⚠️ **本节已两次改写更旧的规则,读到这里请以本节为准。** 最早的形式是
「**pass `model: "opus"` on every dev dispatch**」;2026-08-09 改为 sonnet / opus
两档;2026-08-10 维护者裁定扩为**三档,并把档位决定权明确交给 PM**。凡在别处
(旧交接笔记、座位贴、他人转述)读到前两种形式,一律以本节覆盖它,⛔ 不要几条
并存着理解。

## model 参数解析四级细账

出处:step 5「Model tiering」显式传参条 —— 解析顺序两个方向的后果全文(#7754 批次的行数预算搬移)。

**档位必须显式传参,不能靠定义里的 pin 兜底。** 实测的解析顺序有四级(2026-08-09
对照 Claude Code subagent 文档核过):`CLAUDE_CODE_SUBAGENT_MODEL` 环境变量 →
**逐次派发的 `model` 参数** → agent 定义的 `model:` frontmatter → 主会话模型。
两个方向的后果都要记住:

- `.claude/agents/os-dev.md` 的 `model: opus`(#6686 / PR #6688,由 #6836 的
  `check:agent-model-declared` 守着)**不会**否决你传的 `model: "sonnet"` ——
  参数在 frontmatter 之上,本节的分档因此确实生效,不是一纸空文。
- 反过来,那条 pin 只管**你什么都不传**的情形。省略 `model` 不等于「按 os-dev 的
  opus 走」这句话今天恰好成立,但它成立的理由是那行 pin,而 pin 的历史正是被删过
  一次(#6686:四个 dev 连坐同一堵额度墙,三个留下未验证的 worktree)。所以
  **每次派发都显式写 `model`**,让档位是这次派发的属性,而不是某个文件此刻的状态。
- ⚠️ `CLAUDE_CODE_SUBAGENT_MODEL` 压在两者之上。本容器当前**未设置**(2026-08-09
  实测),但它一旦被设,会静默盖掉你所有的分档决定且仓内无任何显示。另有一条静默
  降级:传入的档位若被组织的 `availableModels` 白名单挡下,回退的是**继承的模型**,
  不是 frontmatter 的 pin。

## #7055 角色文件优先级实测

出处:step 5「角色文件优先级是实测事实」—— #7055 实测全文(#7754 批次的行数预算搬移)。

**角色文件优先级是实测事实,不是文体偏好(#7055)—— 下沉因此是唯一能生效的修
法。** 一条逐字写进派发词的禁令(⛔ 不许 `--force`)输给了角色文件里过时的处方:
dev 把角色文件内化为「事情怎么做」,派发词的临时条款在它旁边读起来像建议。⇒ 两条
配套规则:**对每张卡都成立的无条件条款只能住在 `.claude/agents/os-dev.md`,错了就
修那里**(在派发词里加一条对冲条款修不了它 —— 实测会输);**逐卡可变量走显式接口**
(模板占位符与三分区),⛔ 不靠派发词临时覆盖角色文件的默认值。下面模板里保留的
每一条,要么是逐卡可变的,要么是评审侧对账时点名要看的:

## 读 GitHub 交换机理

出处:step 5「读 GitHub 比粘正文」—— 交换方向论证全文(#7754 批次的行数预算搬移)。

**「读 GitHub」比「粘正文」多担一个风险,少担两个 —— 这笔交换是有方向的。**
粘贴正文时 PM 替 dev 读了一遍,截断风险归 PM(notes 12);改为自读之后,截断风险
归 dev,所以模板里那段自查是**风险转移的对价**,⛔ 不是可以省的客套。换来的是:
派发词不再随卡的长度线性膨胀,而且 dev 读到的是**当下**的 issue —— 包括派发之后
才追加的评论和维护者补充,那正是粘贴式派发永远看不见的一面。

## 三分区措辞三次证伪

出处:step 5「派发令里的机制性指导分两个区块」—— #5561/#5808/#5669 三次证伪全文(#7754 批次的行数预算搬移)。

**派发令里的机制性指导分两个区块,措辞决定 dev 敢不敢证伪。** 一班三次前提证伪
(#5885)都发生在 PM 附带的机制说明上:#5561(「注册告警无需动 spec」—— 实测
Zod default 抹掉未声明,不可表示)、#5808(「500 自动进 withhold 路径」——
启发式 11/11 不认)、#5669(「数组 where 闸门不看」—— 下沉后逐字同谓词)。三次
dev 都用实测顶回并保住了裁决意图 —— 因为派发令把两类内容分开标注了:

## 三分区第三块由来

出处:step 5 三分区「第三块」—— 由来与代价论证全文(#7754 批次的行数预算搬移)。

不分区块的派发令里,机制假设穿着裁决的衣服,dev 要么盲从错误假设、要么连裁决
一起重开 —— 两个方向都是返工。

**第三块是 2026-08-09 单班补的:前两块漏掉了最便宜的那一类 —— PM 顺口给的一个
「看起来无害」的选项。** 同一班被证伪两次,两次 dev 拒绝都是对的(#6865 /
#6893,实录见 `references/incidents.md` §「便宜选项两次证伪」)。
⇒ **把一个便宜选项写成已裁定,恰好招来相反的结果**:dev 要么照做产出一个红,要么
为了顶回来花掉一轮往返。裁决那一块只写真裁决,凡是「我觉得可以这样」的一律降到
第三块 —— 措辞的成本是零,读错的成本是一轮。

## #5586 文件面锚错标本

出处:step 5「文件面要写预期落点」—— #5586 标本与跨座位声明全文(#7754 批次的行数预算搬移)。

**文件面要写「预期落点 + 生产者在别包时怎么办」,⛔ 不能只写一个路径名。** 这是
第二块最常见、也最贵的一个实例。#5586 的派发令把文件面锚在**消费者**
`packages/core/src/utils/filter-tokens.ts`,而那条文法的**生产者**在
`packages/spec/src/data/context-tokens.zod.ts`;dev 在生产者侧修是对的(os-dev 的
contract-first 条款本来就要求它这么做),因而突破了申报的文件面。**只写一个路径名
的派发令,是在要求 dev 在「守约」与「修对」之间二选一** —— 而按它自己的定义,那
两条本该是同一条。所以文件面写成两句:

> 预期落点是 `<X>`;若实测表明真正的生产者在别包,**报备后按生产者侧修**(落点与
> 理由写进报告和 PR 正文),⛔ 不在消费者侧打补丁。

PM 侧的对价是**事后补声明**:#5586 那次判偏离成立,按 #6532 先例补了跨席声明
(#6017)。要一起记住的机械事实是**跨包常常等于跨车道** —— 这一例的消费者在
`domain:engine-core`、生产者在 `packages/spec`(「shared contract surfaces have one
owner」恒归 spec 座位),所以补的是**跨座位**声明,而不是随手越界;走的路径是
rule 4 的跨域例外与「跨座位转移协议」,本条不另造机制。

## same-day churn 两标本

出处:step 5「Same-day churn goes INTO the prompt」—— #4808/#4806、#4820/#4822 标本全文(#7754 批次的行数预算搬移)。

**Same-day churn on the issue's files goes INTO the prompt.** Step 1's
stale-premise check protects against issues that aged; the same-day variant is
main moving between filing and dispatch on the very file the issue quotes —
#4808 was dispatched right after #4806 rewrote the same guard, #4820 right
after #4822 touched the same file. Both prompts carried an explicit line
(「基于合并后的代码工作,issue 引用的片段可能已变,先核对当前 main」), and both
devs avoided rework that the issue's own snippets would have caused. Add that
line whenever `git log origin/main --oneline -20 -- <paths>` shows a merge on
the issue's files today, and tell the dev to verify against `origin/main`
rather than any working tree (Operational notes 4) — the dev's worktree is cut
from `origin/main` once and never refreshes itself.

## 在飞重叠拦截实测

出处:step 5「In-flight overlap needs intercepting too」—— #5322/#5335 实测与 notes 8 对偶全文(#7754 批次的行数预算搬移)。

**In-flight overlap needs intercepting too — same-day churn only covers the
dispatch instant.** The paragraph above handles "main moved before takeoff";
main lands ~18 merges a day, so it moves **after** takeoff just as often.
#5322's agent launched at 23:17Z and #5335 merged 32 minutes into that flight
(`merged_at` 2026-08-04T23:49:44Z) — the same two compilers, two of the same
four cells. The PM's routine check read `git log
origin/main`, spotted the overlap and sent an immediate SendMessage warning; the
agent narrowed its scope twice and dropped its own design in favour of a minimal
diff replayed inside the other PR's structure. Rule: **every round, when you
read `git log origin/main`, intersect each newly-landed PR against every
in-flight dispatch's declared file surface** — on any intersection warn at once,
with four instructions:「合 main 后重跑测试矩阵、读对方 diff 重划边界、只补它没覆盖
的部分、**被完全覆盖就停下回报,⛔ 不要硬造 diff**」. One round late is one rework.

This is Operational notes 8's sister paragraph: notes 8 is the PM re-checking
main **by symptom before enqueuing its own** shared-infrastructure fix; this one
is the PM re-checking it **on behalf of someone else's in-flight agent**. Same
fact that main keeps moving, two different victims — and only the PM can see the
second one, because the flying agent has no view of `origin/main` moving under it.

## 语义翻转 pin 清扫标本

出处:step 5「A ruling that flips public semantics」—— #5322/#5365 标本全文(#7754 批次的行数预算搬移)。

in the dispatch prompt.** When a maintainer ruling changes a public semantic
(#5322 reclassified the empty combinator from *refused* to the **boolean identity
element**), pins of the old position live **outside** the package being changed:
the consumer layers each hold a copy — REST envelope tests, objectql, runtime.
#5365's first lap flipped only the service-analytics layer and the copy in
`packages/rest/src/analytics-filter-refusal-envelope.test.ts` went red in CI
(`expected 200 to be 400`); a second lap cleared it. Two lines belong in the
prompt:

## premise-first 一日四证

出处:step 5「Issue 正文是线索,不是规格」—— 一日四证全文(#7754 批次的行数预算搬移)。

**Issue 正文是线索,不是规格 —— and the dispatch wording is what makes an
honest "the premise is dead" cheap to return.** Step 1's stale-premise check
is the PM's sample; the dev's verification is the real thing, so the prompt
must state the premise-first requirement explicitly (the template line
above), and the PM must treat `premise_still_valid: false` with no PR as a
legitimate — often valuable — deliverable. Evidence from one working day:
#4832 (dispatched; the dev found the premise had already expired), #4250
(the issue's minimum ask had long shipped via the stall-guard series — the
premise check instead surfaced that the guard's SIGKILL escalation path had
never once executed, a real defect the issue never named), #5047 (the
claimed 「enable/disable 重启即失」 was disproven with file:line evidence —
persistence existed by design — and verification narrowed the work to the
real empty-env seed bug PR #5117 fixed), #4930 (two of the three "silently
green" claims were wrong: the scripts went red with misleading messages, and
the fix was re-scoped to the dev's measurements). A dev that falsifies the
issue — or the PM's own framing — is a good run (step 7 says so); a prompt
that presumes the issue is true converts that good run into apparent
disobedience.

## 云卡分流裁决理由

出处:「Resource limits」M+ 云卡默认第一条 —— 裁决理由与旧判据清单全文(#7754 批次的行数预算搬移)。

- **M 及以上 ⇒ 默认 `mode:cloud` 单独派卡**(独享容器),⛔ 不混进共享容器批次。
  裁决理由(维护者同日讨论留档):全程可见、可直接对话干预,价值高于逐卡容器
  启动的开销 —— 对任何非琐碎的卡这笔账都成立。旧判据清单(`size/l` / `size/xl`;
  全量重生成类,#5837 分片即此形;验证半径跨 3 个以上包的全量测试;dogfood /
  浏览器验证;依赖族升级、全量回归;预计持 heavy-verify 锁超过 ~10 分钟)自此是
  **M+ 类的示例**,不再是触发清单 —— 一条都不命中的 M 卡照样走云卡。

## 云卡分流实测背景

出处:「Resource limits」M+ 云卡默认 —— 夜班共享容器实测背景全文(#7754 批次的行数预算搬移)。

- 实测背景(2026-08-06/07 夜班):9 dev 共享一容器,重验证在 flock 后串行,
  一张重卡(#5837 级,数十分钟级验证管线)拖长**整批**墙钟;把它单容器化,
  批内轻卡不再排它的队,重卡自己也不用和八个邻居分内存。

## 云卡授权面第 1 课实测

出处:「Dispatch backends」第 1 课 —— 403 细节与参数出处全文(#7754 批次的行数预算搬移)。

1. **授权面随 source,不随环境。** trigger 拉起的会话**没有仓库授权** ——
   clone(匿名只读)可用,push / 开 PR / 发评论全 403(`not in this
   session's authorized repository set`),`permission_mode: auto` 下也没有
   可弹的授权窗,dev 只能做只读勘察。`create_session` 带 `source_url` 的
   会话**出生即持推送授权**。同时带 `outcome_branch`(= 认领分支,平台托管
   推送)与显式 `model`(trigger 流不可指模型 —— sonnet 默认惊吓即此出处)、
   `title`(客户端卡片名 —— **以车道名开头,⛔ 不叫 os-dev**,维护者
   2026-08-07 拍板:多车道并行时卡片按车道可扫;形如
   `⚡ spec #5599 view 身份前置(裁 B)`,即 `⚡ <车道> #<单号> <短语>`)。

## 云卡交付通道误判沿革

出处:「Dispatch backends」第 3 课 —— 初版误判与三例实测推翻全文(#7754 批次的行数预算搬移)。

3. **交付通道:自开 PR + 订阅唤醒是正道,降级通道只属于 trigger 流。**
   初版条款以为云会话一律没有 GitHub API 工具 —— 对 `create_session` 卡是
   **过度保守的误判**(2026-08-07 下午三例实测推翻:#5599 会话自发 issue
   评论、#5775 会话自立两张 issue、#6243 会话自开 PR #6288),没有工具的只是
   **trigger 拉起**的会话(与第 1 课的 403 同源)。据此分流:
   - **create_session 卡(常态)**:派发词要求 dev **自开 draft PR**
     (`Fixes #<n>`,正文含验证记录)并把终报以 **issue 评论**
     (`<!-- os-dev-report -->`)交付;PM 在派发后立即对该 PR(或预期分支的
     PR)挂 `subscribe_pr_activity` —— dev 的完成动作即 webhook,通知延迟从
     「≤巡检间隔」降到秒级。**例外仍归 PM 代办**:会话未 attach 的姊妹仓
     (源仓之外)依旧够不着 —— 跨仓跟进卡由 PM 代立(#5775 的 objectui
     跟进卡即此形)。
   - **trigger 拉起的会话(定时/重复型)**:维持降级通道 —— 推送 outcome
     branch + 终报走报告 ref(空提交信息)或最后一条会话消息,PM 代开
     draft PR、代转录(权限面不因此放大)。附一条实测:报告 ref 用完后
     PM 侧 `push --delete` 会被 git 代理 403(推送授权不含删 ref),清理
     要走有权限的通道或留给维护者。

## fresh-session Routine 连接器约束实测

出处:「座位 Routine 化」—— 连接器缺失致静默零产出的 #5474 实测全文(#7754 批次的行数预算搬移)。

⛔ **实测运维约束 —— fresh-session Routine 必须带 GitHub 连接器创建。** 经 CCR
**会话内** `create_trigger` 创建的 Routine **不携带** GitHub 连接器(平台限制:
connector grant 只能传递调用会话自身持有的,CCR 平台注入的 github 工具不在其
列),fired session 因此拿不到 `mcp__github__*` 工具 —— 连自退守卫的第一步(读
#4604)都执行不了,表现为**静默零产出**。#5474 的分诊座位试点 2026-08-05 正是
这样失败并回滚的:烟测轮近 50 分钟零标签、零评论、零审计,与创建时平台给出的
警告完全吻合。因此:

## 现役座位 Routine 两例

出处:「座位 Routine 化」—— 现役两例与管家档位论证全文(#7754 批次的行数预算搬移)。

**现役两例(都由维护者从 UI 创建、都先过一轮烟测)。** 首例是**分诊座位**(#5474):
只扫/分类/打标签,⛔ 永不认领。第二例是维护者 2026-08-06 拍板的**三仓队列管家**(锚点
#5810,座位贴在 `pm:seat` 索引,cron 与分诊错开半个周期),管「入队与落地 B」里入队之后的那一
半:签名分诊四分支、队列停滞检测、跨仓 pin 链观测(含 #6162 的机械立单,见「入队与
落地 B」)。**档位按职责挑,不按重要性挑** ——
管家的正确性主要来自**查表**(#5810 的签名台账 + 座位贴说明段,两者都优先于它的现场
判断)与**机械兜底**(每轮限量、双向让行、只守落地的授权面),判断面窄、判例法已写死,
因此**不需要最强档**;吃最强档的是要现场设计取舍的执行座位。档位与 cron 一样是维护者
在 UI 上的可调项(上一条),试点判据不达标即升档 —— 本文 ⛔ 不复制其当前值,它的
`pm:seat` 座位贴才是现状。
## #6806 target 拆分标本

出处:发版板「拆分 / 分票时 `target:*` 随工作走」—— #6806 两面标本全文(#7754 批次的行数预算搬移)。

- **拆分 / 分票时 `target:*` 随工作走,不随票号留 —— 对每一半重跑一遍上面那条
  二元判据。** #6806 是 `target:v17` 的 #5495 拆出的引擎侧残余:拆分把**工作**移了
  出去,发版目标却留在原地,于是板上同时有**一张不会动的卡**(父单的剩余范围已被
  裁定 parked)和**一张看不见的卡**(真正在兑现 v17 义务的那一半)。查
  `label:target:v17` 的人两头都读错,而两个错误方向相反、互相掩盖。默认是**继承**
  (义务跟着工作走);判定某一半不该继承时,**把理由按上面四类阻塞写在那张卡上**
  (可证伪),⛔ 不默认不带。#6806 正是两面的标本:它正文里写过「why `pm:queue`
  without `target:v17`」的理由,该理由后来被重判、标签补上,两张卡今天都带
  `target:v17` —— 写下的理由会被复核,不写的默认不会。生产者不变(分诊座位 /
  objectui 整仓座位),拆分本来就是它做的,本条只是给它加一个必答项。

## 发版清单三条查询论证

出处:发版板「消费者三处」—— 三条查询的结构性论证与 cloud#1222 实测全文(#7754 批次的行数预算搬移)。

- **消费者三处**(a label exists iff something reads it):维护者的发版清单 =
  **三条查询**(与 `pm:seat` 状态板同构,标签即看板;维护者 2026-08-11 裁定,
  #7493,取代此前的两条)——
  `repo:objectstack-ai/objectstack label:target:<major> is:open`、
  `repo:objectstack-ai/objectui label:target:<major> is:open` 与
  `repo:objectstack-ai/cloud label:target:<major> is:open`;等价写法是一条
  org 级搜索 `org:objectstack-ai label:target:<major> is:open`(GitHub 全局
  搜索页支持 `org:`,仓内 issue 列表页不支持 —— 所以三条查询是随处可用的那个
  写法,org 级只是省两次切换)。
  ⛔ **「cloud 出现命中即误标信号」旧条款已废除(#7493)** —— 它教读者把一张
  正确带标的迁移卡当误标清理,等于销毁真实阻塞的唯一证据。实测代价:cloud#1222
  (自 #5852 按 #7167 迁入,带 `pm:queue` + `target:v17`)在两条查询的旧口径下
  **对整个板隐形 ~10 小时**,板读作「v17 clear」而 v17 阻塞卡开着。
  step 3 批次选择板上项优先;step 9 轮次报告第四健康指标 = **三张板之和**,
  「归零 = 可发版」指三张都空,单看 objectstack 归零不是可发版。
  **为什么是三条,而不是一条加过渡态**:rule 1 自 #7165 起是 file-at-destination
  —— 落点在 objectui / cloud 的执行卡就**长在**那个仓,它的 `target:<major>` 由
  该仓整仓座位在它自己的仓里生产(见上面「每个 backlog 恰好一个生产者」)。
  那两条查询因此是这套所有权模型的**结构性后果**,不是存量迁移的残留、
  也不会随哪一次清仓消失;少读任何一条的人**按设计**漏掉那一边,
  而漏掉的读数看上去和「板已清空」完全一样。

## 发版前置条件由来

出处:发版板「发版时刻 = 清板」条 —— #7268 缺口标本、#6162 判据辨析与 #7275 裁决全文(#7754 批次的行数预算搬移)。

- **发版时刻 = 清板,不是重扫**:板上每条三选一 —— 修掉 / 摘牌(不再成立)/
  **明示接受带病发布**(摘标签 + 一句 accepted-for-GA 评论留痕,进 release
  notes 的 known issues)。姊妹仓同标签:objectui **在自己仓里上板**,生产者是
  objectui 整仓座位(见上),修复经 console bundle 随 pin bump 进这次发布;
  cloud 同样**在自己仓里上板**(#7493;它独立部署,修复不随 console bundle 走,
  但板上项照样参与「归零 = 可发版」的读数)。⇒ 发版时刻的清单因此是**三条查询**
  (口径见上面「消费者三处」),**三张板都要清到空**;三选一对三张板**逐条**
  适用,⛔ 不因为「那是前端仓 / 独立部署」就整批默认接受 —— objectui / cloud
  板上项的三选一由各自整仓座位执行,读数回贴给发版清单。
  ⚠️ **「随 pin bump 进这次发布」是机制事实,不是自动的流程保证 —— 流程半边由
  下面的发版前置条件补上(#6906 交付项 2 查出缺口、另立 #7275 裁决)。**
  队列管家的 #6162 机械产出(见「入队与落地」B)判据是**窗口收口**
  (`.objectui-sha` 落后 objectui main **且** objectui 合并队列已空),不是发版
  时刻;而且它立的是 `pm:queue` 单,**按构造不带 `target:<major>`** —— 那张
  bump 单因此既不在上面三条查询里,也没有对应的「明示接受」摘牌形态(#7268 是
  2026-08-10 的实测标本:`pm:queue` 独一份)。发版**记录**另有硬门兜底
  (`check:objectui-pin-fresh` —— 发版 PR 上 required、发布路径上 enforcing,
  #3340 / #6170),所以陈旧 pin **发不出去**;缺的是发版时刻那张单或那次豁免,
  由本条补上:
  **发版前置条件(维护者 2026-08-10 拍板,#7275 Option A)**:清板动手之前,
  先取**一次** pin 读数(`.objectui-sha` 对 objectui main;⛔ 一次即止,不是
  重扫)。pin 滞后 ⇒ console bump 单必须**已存在且已上板**(`target:<major>`;
  上板由已拥有该标签生产权的座位执行 —— bump 单立在 objectstack,即分诊座位,
  单一生产者纪律不因此多一个写者),或按上面的标准形态**明示接受**
  (accepted-for-GA 评论留痕)。两者都不成立 ⇒ 不 cut。这条前置就是「板已清空」
  与「console bump 已就位」之间唯一的机械关联 —— 跳过读数就回到 #7268 那种
  板上看不见 pin 滞后的无声状态。

## 候选评论全读两例

出处:step 1「Read each candidate's full body and its comments」—— #4075 / #4829 两例全文(#7754 批次的行数预算搬移)。

before the issue can even be a candidate.** A comment may record that half
the work already shipped (#4075's step 1 had been merged for three days;
the claim went out without reading the comment that said so). Comments are
also where **rulings** land, not just progress notes: #4829's body reads as
a straightforward "delete the access gate" fix, while its thread held the
maintainer's 2026-08-03 暂缓处理 verdict AND the recorded finding that the
gate is ADR-0045 §3 (Accepted) mechanism with four pin tests. A PM that
read only the body recommended deleting an accepted ADR's mechanism and
dispatched it — only the dev's stop-and-refuse prevented the patch (the
maintainer later re-decided on the corrected analysis; that is the process
working *despite* the skipped read, not because of it). 裁决落在评论区,
跳过评论就是跳过裁决。Triage, batch selection (steps 2–3) and the dispatch
prompt all need the full picture.

## no-producer 一日五中

出处:step 2「Recognize the "no producer" shape」—— 一日五中全文(#7754 批次的行数预算搬移)。

**Recognize the "no producer" shape —「生产者在哪?」is a standing triage
question.** One issue class is invisible to every automated check: a field is
declared, consumers read it, types and gates are fully green — and **no code
path ever writes it**. Five hits in one day: #4704 (`Seed.env`, six call sites
drop it), #4837 (the liveness ledger's own criterion), #4839 (`session.roles`
written nowhere in the repo), #4862 (flow triggers bulk-set `previous` without
binding it), #4867. Type systems and lint validate the **consumer** side only,
so a missing 生产者 survives indefinitely under a green tree. On any issue
shaped `declared ≠ enforced`, ask where the producer is before routing it —
the answer is usually the root cause, and it changes the issue's scope (and
often its `domain:*` label) *before* dispatch rather than in the dev's report.

## 同文件延后记坑标本

出处:step 3「Same-file issues serialize strictly across rounds」—— #4820/#4821 标本全文(#7754 批次的行数预算搬移)。

**Same-file issues serialize strictly across rounds — and deferring is not
shelving.** Two issues on one file ride in different rounds, no exception
(#4820/#4821). The part that is easy to miss: while #4820 was in flight its dev
established that the fix #4821's body proposes (a `JSON.stringify` key) would
change type-coercion semantics and introduce a fresh silent defect. That
warning **and** the `Blocked-by:` line were written onto #4821 in the same round
#4820's review closed — not the next one. A deferred issue sits in the queue
looking dispatchable to every sweep, including another PM's; whatever you
learned about it is worthless until it is on the issue. Rule: when step 3 pushes
an issue to a later round, record the known trap on it before the round ends.

## 扇出标签已议已拒论证

出处:step 3「解锁扇出优先」—— 不发明新标签的论证与 #7498 第二裁全文(#7754 批次的行数预算搬移)。

- ⛔ **不要为此发明新标签**。`pm:blocking` 之类需要一个生产者,而没有读者的标签
  必然烂(「a label exists iff something reads it」)。扇出可以从协议已经在维护的
  数据里推出来,推它就只有一个真相源,也就不会漂移;顺带把激励摆正了 —— 解别人
  锁的活先做,吞吐是复利。**已议已拒,留档给后来者(维护者 2026-08-11,#7498
  第二裁)**:给被依赖卡打一揽子 `priority:*` / `pm:unblocks` 标签的方案被否 ——
  「被依赖」是推导出来、会随上游关单衰变的属性(正是 `target:v17` 裁决拒绝过的
  渐变烂形状);无读者的标签被状态模型禁止;发版关键链已由 `target:v17` 的
  contract-first 传播规则覆盖。`pm:unblocks` 变体仅当被依赖卡群远超今日 ~6 张时
  重议。

## 让行交接 PM 侧读数

出处:step 4「Yielding is a handoff」—— #5032 / #7145 交接读数全文(#7754 批次的行数预算搬移)。

   **Yielding is a handoff, not an exit.** The loser posts, together with
   its 让行 comment, everything it already diagnosed — repro commands,
   dependency paths, traps confirmed (#5032's handoff was consumed directly
   by the winning dev, whose PR #5052 was up within half an hour — details
   in the same incidents section). A yield that discards its diagnosis
   re-bills the whole investigation to the winner.
   The PM-side readings are the same duty (maintainer-accepted 2026-08-11,
   #7518 item 4; measured on #7145 — two same-account sessions claimed 69
   seconds apart, the assignee field read as "mine" to both, and the claim
   comments' timestamps + session IDs were the only tiebreaker): the loser's
   yield comment also hands over the **board readings it already took** —
   in-flight same-file PRs, region declarations, serial constraints cleared —
   so the winner does not re-scan. This is the PM-to-PM form of CLAUDE.md's
   re-read-the-comments rule.
## pin 滞后 cloud#1116 标本

出处:多仓协调 rule 2「Pin 滞后」—— cloud#1116 分叉窗口标本全文(#7754 批次的行数预算搬移)。

**Pin 滞后 ——「上游已合入」不等于「本仓已看见」(rule 2 的盲区)。** rule 2 只要求
`Blocked-by:` 的上游**已合并**;姊妹仓消费 framework 时还有第二个读数 —— 本仓的 pin
是否已覆盖那个 commit。cloud#1116 的裁决来自 framework #5347、落地于 framework #5368
(`9c5abf4e9`),而 cloud 的 `.objectstack-sha` 停在 `586d6f701a16`,`9c5abf4e9`
**不是它的祖先**(立单时 framework main 领先 pin 87 个 commit)。于是 cloud#1117 合入
后到下一次 pin bump 之前,同一个 `TursoDriver` 仍有分叉窗口,只是**方向反了**:remote
抛 400,local(继承 `SqlDriver`)仍编译 `IS NULL` —— fail-closed 的一侧先到,不是新洞,
pin 前移即自动收敛。规程两条:

- **派发前核祖先关系**(REST `repos/<owner>/<repo>/compare/<pin>...<sha>` 的 `status`
  / `ahead_by`)—— 本地 `merge-base --is-ancestor` 在 shallow 检出上解不出 pin 的
  commit、以 `fatal:` 退出,而它在 `&&` / `||` 链里会被读成「不是祖先」,正是
  Operational notes 6 那类假读数;
- 未覆盖 ⇒ 派发令要求 dev 在 **PR 正文留档分叉窗口与方向**,且 ⛔ **pin bump 不做
  rider**:`.objectstack-sha` 是共享文件、要走 `scripts/bump-objectstack.sh`(连带 hono
  override 与 lockfile 重生),塞进这一单会把一个独立的、必冲突的改动变成 rider。

滞后**本身**已有读数,不必自己算:cloud 的 `scripts/check-pin-staleness.sh`
(`pnpm check:pin-staleness`,test.yml 里以 `continue-on-error` 跑)每次 CI 都报两个 pin
各落后 main 多少 commit。但它是**有意的 advisory**(不设阈值,`--max-behind N` 需显式
传 —— pin bump 是深思熟虑的动作),且它回答的是「落后多少」,**不是**「是否覆盖我这条
裁决 commit」;后者只有派发前那一次祖先判断能回答。

## rule 4 双射动因

出处:多仓协调 rule 4 —— 纵向拆分的动因论证全文(#7754 批次的行数预算搬移)。

**4. 纵向拆分:一个分诊 PM + N 个执行 PM,一人一车道双射**(维护者
2026-08-05 拍板,#5472)。The claim protocol makes concurrent PMs *safe*, not
*useful* on its own: batch independence (file-disjointness) is only ever
checked inside one PM's own view, so two PMs on the same queue can claim
issues that collide on shared files — and「谁来分诊」原本是每个 PM 各做一遍的
重复劳动。objectstack 是最大的仓,单个 PM 的认知吞吐不够,同仓多 PM 必须保留;
所以把协调税**降为结构性防撞**,而不是靠自由文本申报互相躲。角色**纵向**拆开,
所有权是**双射**:

## 热文件串行队实测

出处:「座位贴协议」热文件串行队 —— domain:metadata 席一文件五卡实测全文(#7754 批次的行数预算搬移)。

- **热文件串行队 —— 正文里给它一个具名段。** 批次独立性(step 3)是**每轮**现算的,
  但一个热文件的**排队顺序**是**常设事实**:它跨轮、跨班次存在,接任者必须能直接
  读到,而不是从一堆认领评论里重新推。段内三列:**文件 → 有序卡片清单 → 每张卡认领
  的是哪个区域**。实测:`domain:metadata` 席一个任期里,
  `packages/metadata-protocol/src/protocol.ts` 一个文件背了**五**张卡
  (#6215 → #6190 → #6563 → #6479 → #5079),另有别的座位的 #5839 认领压在第三个区域上;
  该席临时用了这么一段,正是它让**连续三次同文件派发零碰撞**(#6644)。区域列是关键
  —— 同一文件的不相交区域可以并行,写清楚才敢并行,写不清楚就只能整文件串行。

## engine 拆分沿革

出处:「Domain lanes」engine 一分为二 —— 拆分动因与迁移纪律全文(#7754 批次的行数预算搬移)。

**`engine` 一分为二(#5472,与 #5095 同批)。** 旧 `domain:engine` 同时覆盖
objectql + metadata\* + platform-objects + core + formula + 全部 `driver-*`,
在双射之下**一个 PM 吃不下**(它是全仓最大的一块,且 driver 族的落地节律与
查询/元数据核心完全不同)。切分线就是上表:**`engine-core` = 编译/查询/元数据
核心**,**`drivers` = 存储后端适配层**。两条配套纪律:

- **迁移**:存量带 `domain:engine` 的 open issue 由**分诊座位**按落点逐条改标为
  `engine-core` / `drivers`,清零后删除旧标签 —— 双射要求「域 X 谁管」有唯一
  答案,一个仍在流通的旧标签就是一个无主车道。
- **座位贴同批新立**:`domain:engine` 那一个座位一分为二,各自的范围段
  照抄上表(维护者 2026-08-05 对 `driver-memory` / `driver-mongodb` 族的投入
  冻结指令锚在 `drivers` 那一行,`formula` / `driver-sql` 不受影响)。

## spec 拆分沿革

出处:「Domain lanes」spec 一分为二 —— 拆分动因全文(#7754 批次的行数预算搬移)。

**`spec` 一分为二(维护者 2026-08-07 批准,座位贴 #6298)。** 旧 `domain:spec`
同时覆盖「改接受面」与「改契约自述文本」两类节律完全不同的活:前者量小、
风险高、要吃版本窗口裁决;后者量大、机械、天然适合 sweep 打包 —— 混在一席,
文本债持续积压(truth-sweep 审计开采一天可灌 5-10 张)。切分纪律:

## metadata 拆分沿革

出处:「Domain lanes」engine-core 再拆 metadata —— 拆分动因与迁移纪律全文(#7754 批次的行数预算搬移)。

**`engine-core` 再拆 `metadata`(维护者 2026-08-07 拍板,座位贴 #6367)。**
首拆后的 engine-core 仍是全仓最大、增长最快的车道:编译/查询核心与元数据
机制(service / registry / directory + 内置平台对象)的落地节律不同 —— 前者
深、串行、常挂 ★,后者以机制修缮与观测型 finding 为主,天然可并行。二次
切分仍按包边界(anchoring rule 无例外,与 spec 拆分不同):**`engine-core` =
编译/查询核心**(objectql / core / formula / plugin-pinyin-search),
**`metadata` = 元数据机制与内置对象**(`packages/metadata*`、
`packages/platform-objects`)。配套纪律:

- **红线**:改变元数据**格式/接受面**的卡照旧归 `domain:spec`(协议席,判据
  「合法集合变没变」,#6245/#6235 先例);`/meta` HTTP 路由本体在
  `packages/rest`,归 `domain:cli` —— `metadata` 席只吃 engine 侧机制。跨半边
  的卡按主要落点判,拿不准 FLAG 回分诊。
- **迁移**:存量带 `domain:engine-core` 的 open issue 由**分诊座位**按落点
  逐条改标(只读分类审计留证,逐卡迁移评论);已在飞(`pm:dispatched`)的
  **改标不改辖** —— 标签随分类走,收尾与复核仍归原认领会话(先例 #6298
  说明段)。
- **座位贴新立**:#6367,范围段照抄上表;母席 #6019 范围随表收缩,由其在任
  PM 自行更新正文(单写手规则),分诊座位只留知会评论。
## sanitizer 写侧就地删除三例

出处:Operational notes 12 —— 写侧三例表格与判据推导全文(#7754 批次的行数预算搬移)。

**12. 判「正文被 sanitizer 截断」必须双读取 —— 单一读法的尾部缺失先算读取端截断。**
(三例误判各停摆 1–2 天、外加三张假工单;实录已移 `references/incidents.md`
§「读取端截断三例误判」。)两句纪律:

- 判截断前必须**双读取**,`body_html` 要带 full 媒体类型才拿得到:

  ```bash
  curl -s "https://api.github.com/repos/<owner>/<repo>/issues/<n>" \
    -H 'Accept: application/vnd.github.full+json'   # .body 原文 + .body_html 渲染版
  ```

  **两者在同一处断掉**才算 issue 端截断;任何单一读法的尾部缺失都先假定是读取端
  截断(工具输出上限、分页、`[:N]` 切片)。这与 notes 6「零命中必须用一个确定存在
  的邻近词反查」是同一条纪律的另一半 —— **缺失类读数在下结论前都要先证伪「扫描器
  坏了」这个解释**。
- step 0 的 **Repair first** 是**停摆指令**,成本由作者承担,所以它的判据必须比
  其它分类更硬:误判一次的代价是一条可入队缺陷躺一天,外加一条打给作者的假工单。
  已发出的重贴指令若事后证伪,**要在同一处公开作废**(同 notes 7:诊断结论一旦
  公开发出又被推翻,更正要发在同样公开的位置)。
- **同一个 sanitizer 的第二种形状 —— 写侧的「就地删除」,上面两条的判据抓不到它,
  反引号也不保护。** 上面两条管的是**读侧**误判(把读取端截断当成 issue 端截断),
  ⚠️ 一字不改、依旧成立;这一条是新增的**另一种失效形态**,不是对它的修正:短的
  `<…>` 片段在**写入时**被就地删掉,正文其余部分完好无损 —— 没有「断掉的位置」,
  所以「两者在同一处断掉」这个判据在它身上恒假,双读取会一致地告诉你「正文完整」,
  而它确实完整,只是少了几个片段。2026-08-07 `domain:spec-surface` 席在座位贴的
  交接台账上写后回读实测三例,三例都在反引号里、三例都被吃掉:

  | 写入 | 存回 |
  |---|---|
  | `<!-- os-dev-report -->` | (整段变成空) |
  | `expected <n> to be 19` | `expected  to be 19` |
  | `git log -- <path>` | `git log -- ` |

  第一例的代价:被吃掉的标记是在飞 dev 报告的**全部收集路径**(step 6
  `mode:cloud` 的收集判据)—— 只有写后回读抓到了它。两条动作:

  - 正文里凡要保留字面尖括号,一律写 HTML 实体 `&lt;` / `&gt;`,⛔ 不靠反引号或
    围栏 —— 实测它们不提供保护;
  - 含 HTML 注释标记(如 `<!-- os-dev-report -->`)、`<n>` / `<branch>` / `<repo>`
    一类占位符、泛型参数的正文,**写后回读逐个确认这些片段仍在**,这是动作不是提醒。
    label discipline 的「写后回读」是同一条纪律的上位(#5885 那两次「sanitizer 吞
    内容」即本形态),本条给的是它的**具体形状与判据**:失效完全静默 —— API 返回
    成功,渲染页看不出缺口,只有把存回的正文与你写的原文逐段对比才看得见。

## auto-merge 空字段返回正反实测

出处:Operational notes 21 —— 正反 3+3 例与对照组实测全文(#7754 批次的行数预算搬移)。

**21. `enable_pr_auto_merge` 的空字段返回(`method: , enabled at `,对照正常形态
`method: MERGE, enabled at <时间戳>`)对「入没入队」零区分度 —— 以队列读数为准,
只在成员资格确实缺席时翻转一次。**(处方并入 notes 1 的读数纪律:维护者
2026-08-11 裁定,#7492;吸收 #7518 第 2 课的第二时序形态。)identity 车道
2026-08-06/07 三例首测(#6207)之后,后续班次对全绿 PR 测得**反例 3/3**:

- **原三例**(#6034/#6092/#6197,checks 已全绿、`mergeable_state: clean`):空字段
  返回,auto-merge 确实被武装(随后 `disable` 能成功返回,反证武装生效),但 PR
  不入队 —— 无 `added_to_merge_queue` 事件;翻转一次后入队落地(#6034 识别出签名
  前静默停摆约 1 小时)。
- **反例 3/3**(#7506/#7508/#7605,同样全绿):同一个空字段返回,PR **照常立即
  入队**(`added_to_merge_queue` webhook 秒级到达),未翻转、首过落地。#7446 还
  测得 ready-flip 后同形:空收据 + 立即入队(#7518 第 2 课)。
- ⇒ **签名本身不构成任何方向的证据**;有信息量的只有队列读数。**处方**:先按
  notes 1 读成员资格(timeline 事件;队列分支**正命中**亦充分,注意
  `max_entries_to_build` 截断 —— 分支缺席单独不充分),成员资格**确实缺席**才
  `disable` → `enable` 翻转一次,翻转后仍以 notes 1 判据验证。⛔ 对已入队的 PR
  补一记 `disable` **不解除队列成员资格**(只有转 draft 才解除,见 notes 1 /
  Guardrails 的撤回机制)、PR 照常落地,但**会清掉 auto-merge 旗** —— 此后它
  若被队列踢出将不会自动重挂(#7446 与 #7506 各实测一半)。
- **对照组**:对 checks 还在跑(`blocked`)的 PR 调同一工具,返回完整字段、行为
  正常(绿后自动入队)—— #6086 / #6067 / #6107。工具行为在平台侧,仓内能做的
  就是把读数纪律钉在这里,免得每个新 PM 会话重踩一遍。
## #5536 机会主义重启条件标本

出处:State model label discipline —— #5536 四次命中无人接的标本全文(#7754 批次的行数预算搬移)。

- **机会主义重启条件必须点名触发文件,复查挂在所属车道的派发动作上(维护者
  2026-08-11 接受,#7518 第 3 课)。** 「下一个碰这几个文件的 PR 顺手带上」这类
  条件在命中那一刻**没有读者** —— 路过的人在文件里,不知道卡存在;#5536 的条件 ②
  已四次命中无人接(#6042、`e2798fa`、`d538647fc`、`06be54ec3`,其中两次同日)。
  处方两半:持有的 finding 把**触发文件清单**写进 hold 评论;所属车道的座位贴设
  「派发前必查」段 —— 凡派发的卡文件面与清单相交,派发令点名该 finding、把顺手活
  列为**申报过的 out-of-surface 增项**。检查挂在**派发动作**上才有读者;写进
  座位贴才活得过交接(#5536 本班已照此落地:座位贴 #6021 + 卡上公示)。

## 域标签创建段由来

出处:One-time setup「为什么这一段以前不存在」—— 词表承重而无创建者的沿革全文(#7754 批次的行数预算搬移)。

⚠️ **为什么这一段以前不存在,以及为什么它不是可选的。** 本块此前**一个 `domain:*`
都不创建**,只创建 `pm:*` / `finding` / `needs-user-decision` / `repo:*`;而同文的
label discipline 又规定「未打标签的 issue 任何人都不得认领」,`domain:*` 是分诊座位
**唯一生产的机器判据**。也就是说这套词表是**承重的,却没有任何一处可执行文本负责
把它创建出来** —— 现存的域标签全部是历史上手工点出来的,词表与实际标签集之间没有
任何机械对账,两边各自漂移(#5472 施工现场记录,归挂 #5469)。#5469 发现的两个
未入表条目就是这个缺口的产物,不是谁一时疏忽。

## 合并队列成员资格判据实测

出处:Operational notes 1 —— 6/6 实测、批次链读法与 #4852 空转全文(#7754 批次的行数预算搬移)。

**1. 判断 PR 是否在合并队列,看 `added_to_merge_queue` timeline 事件,不看
`auto_merge` 字段。**(成员资格判据修订:维护者 2026-08-11 裁定,#7492。原判据
`gh-readonly-queue/*` 分支**充分而不必要** —— 队列满载时 PR 已入队而分支尚未建出,
按旧判据读出「没入队」的假阴性,据此重投就是重投一张已在队列里的 PR。timeline
事件判据 identity 车道一班 6/6 实测:#7333/#7346/#7389/#7400/#7449/#7471,
含一轮分支判据会答错的。)本仓 PR 入队后,REST 返回的 `auto_merge` 回落为 off
(队列条目取代了挂起的 auto-merge),该字段对「在不在队列里」零信息量,据它反推
会得出「没入队,再入一次」的错误结论。成员资格判据:

```
GET /repos/{owner}/{repo}/issues/{pr}/timeline   →  event == "added_to_merge_queue"
```

队列分支读法**降级为读批次位置专用**(排序只有那里可见,⛔ 不再作成员资格判据):
`git ls-remote --heads origin 'refs/heads/gh-readonly-queue/*'`,分支名里带着这一批
被打包的 PR 号,base sha **串成链**(`pr-4878-<链上一条的结果 sha>`),顺着链读得出
自己排第几;**正命中仍然是「已入队」的充分证据**,只有「无匹配分支 ⇒ 没入队」这个
反向推断作废。

**成功序列规则(同一裁决)——「读间隔,不读事件名」**:`removed_from_merge_queue`
之后 **~1 秒内**跟着 `merged` 是**落地**,不是被踢(6/6 落地全是这个形状:#7346
08:12:08Z→08:12:09Z、#7333 08:27:50Z→08:27:51Z);真被踢的形状是
`removed_from_merge_queue` 之后**没有** `merged`、几分钟后 PR 仍 `open`(#7333
07:56:20Z 一度被误读为踢出,靠时间差纠正)。两个结局共用同一个事件名,不读时间差
就会把落地报成弹出、或对着真弹出干等 —— 两个方向的错各自都发生过。另有两点在同一
处咬过人:

- **「判据不在 `origin/main` 上」是个二义读数。** 它同时兼容「在队列里等」和「压根
  没入队」,而两者的处置完全相反(前者等,后者要动手)。#4852 的 auto-merge 从 10:15
  就挂着,每轮只查 main、判为「排队中」,实际它因 CI 红从未入队 —— 空转 **100 分钟**。
  落地检查永远是**两个读数**:队列成员资格 **和** `origin/main`,缺一不可。
- **PR 被转回 draft 会同时掉 auto-merge 与队列成员资格**,且不会自动恢复;转正之后
  必须重新挂。

## GraphQL 配额规程全文

出处:Operational notes 3 —— 配额规程与定点文本纪律的原始全文(#7754 批次的行数预算搬移)。

**3. GitHub MCP 的 GraphQL 配额(5000/时)极易打满,读操作与评论一律走 REST。**
今天三次归零(峰值 10402/5000),每次卡死的都是 `enable_pr_auto_merge`、draft 状态
切换、`list_issues` 这几个 GraphQL-only 操作 —— 配额一空,整个循环停在复核与入队上。
规程三条:

- 读与评论优先 `curl` / `gh api` 走 REST(core 配额 15000/时,与 GraphQL **独立计**),
  只有确实没有 REST 对应物的写操作才花 GraphQL 配额;
- 配额打满时把 GraphQL 写操作**排队而不是重试**,后台轮询 `rate_limit` 的
  `resources.graphql.remaining`,恢复即执行:

  ```bash
  gh api rate_limit --jq '.resources.graphql'   # 或 curl https://api.github.com/rate_limit
  ```

- 复核意见不等配额 —— 先用 REST 评论把结论发出去,入队、切 ready 这类 GraphQL 动作
  事后补;维护者拿到的信息不该被配额延迟。

配额期的**动作交接**四条(services 车道一班六次配额耗尽的沉淀,#5885;含一次
「读成功写被拒」卡在转 ready 半途 —— 读写配额独立,写被拒不代表读也死了,反之
亦然):

- 被配额挡下的动作,把**完整待执行状态写进 send_later 定点文本**(哪个 PR、哪个
  动作、判据是什么)—— 幂等、抗上下文丢失,恢复后照文本执行,不靠会话记忆;
- 重试用 **10–12 分钟阶梯定点**至成功,⛔ 绝不忙轮询;REST core 配额是**整点
  重置**,对齐 `:00` 重试优于指数退避(实测一次盲退避白等半个窗口);
- search 与 core 是**独立配额**,一侧打满时另一侧可作退路(用 search 拿清单、
  用 core 读详情,或反之);
- REST core(15000/时)在共享身份下**同样会打满** —— 本条的三份判据(rate_limit
  读数、整点重置、独立计费)对它一体适用,别把「走 REST」读成「不限量」。

**定点文本的写法纪律 —— 已删除的定时器仍会投递,且投递时文本可能已落后现实数轮。**
上面第一条让定点文本**完整**(带全待执行状态),这一条让它**过期时仍然安全**;两条
是同一枪的两面,都成立才够用。2026-08-07 跨两个座位三次实测,两种形态、同一个后果
—— 已删定时器照样投递×2、未删但被现实追上×1(两例实录见
`references/incidents.md` §「定点文本两例实录」)。

两条硬规则:

- **每一枪定点文本必须以「幂等 —— 动手前先重读状态」开头**,⛔ 不得包含未经重读
  即可执行的祈使句。三次都没出事的唯一原因就是这句在文本里、且重读**真的被执行**;
  定时器一旦投递,平台侧没有任何东西会替你复核它的前提 —— 把重读写进文本是**唯一**
  能让过期指令失效的机制。
- 文本只许描述**判据**(「若 X 则 Y」),⛔ 不许描述**结论**(「现在去做 Y」)。
  「⇒ 重新派发」「⇒ 判为不可靠」「⇒ 打回不 arm」这类祈使句正是要禁的形态:它们在
  写下的那一刻可能是对的,投递时未必还是,而祈使句把「判据可能已变」这件事从文本里
  抹掉了 —— 判据句自带复核,结论句把复核外包给了一个已经不在场的自己。

本条的落点在 step 6(巡检定点)与 step 7(flip 定点)各有一条同款约束,写法一致。

## 读数纪律四例明细

出处:Operational notes 6 —— 四条错读数的实测明细全文(#7754 批次的行数预算搬移)。

**6. 读数纪律 —— 四条各自产出过一个「我信了并据此行动」的错读数。** 第 4 条管的是
「在哪棵树上读」,这一条管的是「命令本身是否在回答你以为的那个问题」。

- **`cd X && cmd` 会短路。** Bash 工具每次调用 cwd 重置;`cd /home/user/objectui &&
  git grep ...` 在路径不存在时 `cd` 失败、整条命令继续,于是**在当前仓里执行**,产出
  假的「objectui 零消费方」。⛔ 跨仓一律 `git -C <path> grep`,不要用 `cd`。
- **`git grep -c <pat> | wc -l` 数的是文件数,不是命中数。** 曾据此得出「分支比 main
  命中更多」的荒谬结论。要命中数就不要再套 `wc -l`。
- **裸名 grep 会被幸存家族当子串命中。** 核验 `system/EmailTemplate` 是否已退役时,
  裸名命中的是仍然活着的 `EmailTemplateDefinition` 一族。退役核验一律**带引号精确
  名**;更硬的判据是查**声明式**(`^(export )?(const|type|interface) <Name>\b`)而不是
  查提及 —— 注释、pin 测试的断言词、迁移散文里出现该名是**正常且应当的**。
- **浅检出(shallow clone)上的历史读数不可信 —— 一个假「非祖先」加两个被截断的数。**
  队列管家核跨仓 pin 链时实测:`git merge-base --is-ancestor <pin> origin/main` 以
  **exit 1** 退出(直接读作「不是祖先」)、`git rev-list --count <pin>..origin/main`
  给出被浅历史截断的值(实测 50)、`git branch -r --contains <pin>` **零输出**;
  `git fetch origin main --deepen=<N>` 之后同样三条给出 exit 0、79、有输出。⇒ 跨仓
  pin 核验先 deepen 再判,或直接走 REST `compare`(多仓协调 rule 2 第一条同源,论证
  不重复 —— 那里讲的是 `fatal:` 退出在 `&&` 链里被读成「不是祖先」,这一条讲它还能
  不报错地给出一个**看起来正常的错数字**)。

统一原则:**零命中必须用一个「确定存在的邻近词」反查**,证伪「扫描器坏了 / 路径错了」
这个解释。没有这个反查,零命中不成立。

## #4845 误诊更正实录

出处:Operational notes 7 —— 2026-08-03 OOM 误诊三重错误全文(#7754 批次的行数预算搬移)。

**7. CI 红了先拿完整日志归档,再下结论 —— 三条读日志的纪律。** 这是 2026-08-03 当天
最贵的错误:公开断定四次 CI 红是**内核 OOM-killer 杀掉 DTS 构建**,据此开了 PR #4853,
然后被 #4853 自己的 CI 推翻(它挂着新参数跑,红得一模一样)。真因是 #4796 那一族的
5000ms 超时,由 #4856 修掉。完整更正见 #4845。三个叠加的错误各成一条:

- **「completeness check 绿」≠「测试通过」。** `check-test-completeness.mjs` 只断言
  没有 worker 静默死掉;workflow 自己的注释写着 *"A red suite plus a GREEN
  completeness check means real test failures"*。
- **turbo 并发输出的「相邻」≠「因果」。** `test` 的 `dependsOn` 只有 `["^build"]`
  (只含上游),`packages/spec` 没有 `pretest`,所以 `--concurrency=4` 下 `spec#build`
  与 `spec#test` 同时在跑,GitHub 又给整组打同一个时间戳。`X start` 紧接着
  `ELIFECYCLE` 完全可能来自两个无关进程。**先查 `turbo.json` 的依赖边**,再谈因果。
- **不要只看日志 tail。** 那次的 ~10 KB 尾巴被 `gen:schema` 的 1675 行清单吃光,真正
  的失败行根本不在里面。取完整日志归档再判。

诊断结论一旦公开发出又被推翻,**更正要发在同样公开的位置**,并把据它开的 PR 撤回
draft、解绑 `Fixes`,免得一个错结论继续被当作已立案的事实引用。

## #7655 armed 窗口 disable 撤单实测

出处:Operational notes 21 —— 2026-08-11 班次乱序 webhook 正反两例(#7755 的 notes-21 修订叙事)。

notes 21 旧处方「成员资格确实缺席才翻转一次」在 2026-08-11 班次测出**处方内部的时序
缺陷**:GitHub 的「added to merge queue」webhook 可能**乱序迟到**,在首次空字段
enable 已经真实入队**之后**才到达 —— 于是「缺席」读数是假的,打进 armed 窗口的
`disable` 会把真实入队撤掉。

- **反例 #7655**:enable → 空字段返回 → `disable`(以为没入队)→ 乱序的
  「added to queue」通知到达 → 队列分支消失 —— 真实入队被那记 disable 撤销,
  多付一整圈翻转才落地。
- **正例 #7657(同日)**:按修订序列 —— 空字段后先
  `git ls-remote --heads origin 'refs/heads/gh-readonly-queue/*'` 验队列分支
  (给条目 ~20–30s 建出),分支在即收手 —— 零摩擦首过落地。

修订以 amend-in-place 并入 notes 21 现行序列(取代旧处方,不另立竞争条目);
「⛔ enable 与它的队列验证之间永不插 disable」是 #7655 的直接产物。与
§「auto-merge 空字段返回正反实测」的关系:该节讲**签名零区分度**(读什么),
本节讲**读数与动作的时序**(什么时候动手)。

## 跨会话消息 roster 限制实测

出处:Dispatch backends「跨会话消息面」段 —— 平台限制读数与维护者裁定(#7755,2026-08-11)。

- CCR 创建的云会话**不注册**跨会话消息 roster:`ListAgents` 不列出、`SendMessage`
  按会话 ID 直投返回 not-reachable。实测时官方文档点名的门槛**全部满足**:
  Claude Code 2.1.227 ≥ 2.1.224;四个可关停该特性的环境变量一个都没设;同一批
  读数内,进程内 subagent 可列出、可投递(对照组,证明工具面本身是活的)。
- 官方文档(code.claude.com/docs/en/cross-session-messaging):云会话仅当**发送侧**
  具备「cloud access —— 第一方 Anthropic API 上的 claude.ai 登录」时才可见 ——
  CCR 容器凭证当前不满足此条件,限制在平台侧,不在配置侧。
- 维护者裁决(2026-08-11,spec 车道会话,原文):「当前事件驱动架构即长期方案」/
  「云卡通信课题就此收档 … 不再追」/「没有计划 把 PM 席迁到常驻本地机」。
  ⇒ 云卡通道 = `subscribe_pr_activity` webhook + 双落点报告契约(issue 评论 +
  会话终报)+ 判据式定时器;⛔ 不再复测 roster 路径、不再提本地机迁移。

## 云卡订阅 A/B 实测

出处:Dispatch backends 第 4 课 —— 订阅升格为硬步骤的同日 A/B 依据(#7755,2026-08-11)。

- **#7672(未订阅)**:PR 合并由轮询发现,迟到数分钟 —— 感知滞后整整一个巡检周期。
- **#7655/#7657(已订阅)**:CI 失败与合并通知**秒级**投递,整段接力
  (红 → 修 → 绿 → 落地)全程事件驱动、零轮询。
- ⇒ 「云卡创建即对其 PR 挂 `subscribe_pr_activity`」由随行纪律 bullet 升格为
  `mode:cloud` 交付契约的**编号硬步骤**:没订阅的云卡 PR 就是轮询负债。

## #6072 感知通道缺口实测

出处:入队与落地 B「落地窗口挂事件订阅」段 —— 适用面动因与 #6072 出处(#7755 的行数对冲搬移)。

这类单的 base 会在等待期间被 main 甩开,冲突转换与 CI 红正是 PM 可动作的事件;订阅把感知从
「一个巡检周期的轮询滞后」缩到实时(出处:#6072 压后待放期间起冲突,维护者先于
PM 看到 —— 感知通道缺口实测)。

## 云卡归档欠账与 dirty 自救实测

出处:入队与落地 B 归档 bullet(#7755 的行数对冲搬移;dirty 自救半边并入自
`claude/pm-dispatch-spec-5ls2tr` @ `bbe056b` 的 rider 段,原目标 #7431 已关闭)。

- **欠账实测**:归档是 ACCEPT 收尾的**固定动作序列**的一环,不是可选的清理 ——
  实测代价:一个座位曾累积 **11 个**已完成未归档的空转容器 —— 只会被问出来,
  不会被发现。
- **rider 段原文(bbe056b)**:「**云卡归档(维护者 2026-08-10)**:PR 已 MERGED/关闭
  **且**报告已收复核 ⇒ `archive_session`;巡检顺手批扫 `list_sessions` 的
  review_ready 存量。⛔ PR 合并前不归档 —— 活会话是 dirty 自救的执行手
  (#7265/#7325 实测:PM 一条 PR 评论唤醒完工会话 merge+regen+重推);误归档可
  `unarchive_session`,但容器现场已失,宁晚勿早。」规则半边已并入主文件归档
  bullet,本节存叙事与出处。
