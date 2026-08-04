---
'@objectstack/spec': patch
---

tooling: strictness 台账「数字/散文分家」—— 计数转生成物走 os-regen,判定与依据保持手写 (#5107, #5072)

`docs/audits/2026-07-unknown-key-strictness-ledger.md` 是战役期间全仓最热的合并冲突点,而冲突全部落在它的**数字**上:两个批次各按自己那份正确的增量去减表头,git 把互不重叠的**行**干净合并,而与谁都不冲突的**小计行**「干净合并、两边都错」—— 单日 7 例,`ui/` 小计被三个批次分别写成 119 / 110 / 100,而合并后的正确值 91 三边都没写过。**散文当天只冲突过一次,而且那次是有意义的。**

所以数字走了。新增生成物 `docs/audits/2026-07-unknown-key-strictness-ledger.counts.md`(`gen:strictness-ledger`),承载每文件站点数/strip 数、各段表头、按类小计、posture 分布与未细分目录的总数;`.gitattributes` 把它加进 `merge=os-regen`(#4675),合并时不做文本合并、整体重生成,`pre-commit` 在重生成之前拒绝提交。台账本体只留承重的部分:`Class` 判定、依据、findings log、豁免记录 —— 这些是判断,不是算术,重生成会**删掉别人的证据**,所以 `docs/audits/**` 仍在 `NOT_DRIVER_MANAGED` 里。

`check:strictness-ledger` 的职责随之反转,双向闸语义完整保留:

- **生成物新鲜**:整份重新渲染后逐字节比对,失败信息把「某个数字动了 = 有 schema 在没人重新审视的 `Class` 判定下被增删/改姿态」这句话说出来 —— 这正是旧的手写计数唯一值得留下的那一半;
- **散文自洽**:每条手写行必须指向一个仍然存在、仍然有站点的文件(旧的计数检查顺带买到的性质),有站点却没有行仍然红,strip 行归零仍然红(反向钉)。

两条红路径都先证了红再信绿:改生成物里一个数字 → EXIT=1;删一条手写行 → EXIT=1(并且被删的行不会静默变成 0,它会以 `⚠️ unclassified` 出现在生成物里)。

小计是「对判断做算术」,所以 remaining-strip 那张表的 `Class` 单元格现在有语法:`<verdict> [(p)] [· <n> <verdict>, …]`。已解决的 `mixed`/`split` **必须**声明自己的拆分,闸门拒绝猜 —— 一个宽容的解析器会把这些数字原封不动地送回它们刚被搬走的地方,而且是在一个绿色的文件里。迁移后所有已发布的数字逐一复现(235 strip / 36 open files / authorable 29 / unresolved 33 / no door 38 / no gate 31)。

**同一把尺的搭车修复(#5072)**:`postureOf()` 对战役自己的 helper 短路 —— `strictObject(` 直接返回 `strict`,不看链上挂了什么,于是 `strictObject(…).passthrough()`(运行期**开放**的形状)在台账里被记成 **strict**。全仓恰好 2 处,都在 `ui/view.zod.ts`(`GanttConfigSchema` / `TreeConfigSchema`),两处的 `.passthrough()` 都是刻意的。现在 idiom 只决定**起始**姿态,链一律走完,最后一个显式调用赢。`ui/` 的 strict 读数 119 → 117、passthrough 3 → 5;**strip 计数不变**,所以 remaining-strip 那张双向表的数字一个都没动。零 `*.zod.ts` 语义改动。
