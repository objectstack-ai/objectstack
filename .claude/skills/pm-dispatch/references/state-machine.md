# 状态机细则

见 SKILL.md 〈状态模型〉;本文只放各状态的行契约、双通道与巡查判据。

## 跨状态通则

- 六态 ONE-OF 的成因恒是半写的转换;判定以 `check-half-states.mjs` 的 H29/H30 为权威。
- 生成物不分叉:`skills/**` 生成器产物跑 `check-governed-merges.mjs --test`,⛔ 不按路径手判。
- 交接即标签:只写交接评论而不同笔挂标 = 空交接,收件箱只认标签。
- 开着的卡离手恒落一态:摘 `pm:*` 态同笔补下一态、`needs-user-decision` 或关卡;写门拒半写。

## `pm:on-hold`

- 合法性:正文或评论带 `Restart-when: closed <owner/repo>#N`,由 `Blocked-by:` 同遍解锁扫描点火。
- 或带 `Restart-when: <一行可执行判据>`;两种拼写之外的 hold ⛔ 不合法。
- hold 评论写明日期、理由与出处(维护者裁或座位定级),⛔ 不设第二个标签区分两者。
- 入 hold ⛔ 不降级(级只反映严重度);存量行尾的 ` · Restart-grade: pN` 即原级,照它复原。
- 冻结(freeze)裁决与 `pm:on-hold`+`Restart-when:` 同笔落地;只写评论不挂标 = 半状态。
- 机会主义重启的触发文件走 `Restart-touch: <仓内相对路径>`,一行一路径,值须为 tracked 文件。
- 该行大小写敏感、行锚定,与另两行同双通道,喂 H17 触发文件索引;存量 hold ⛔ 不迁移。
- 放行双查皆机械:只放最近一次 hold/blocked 转换评论的条件;其后卡上有新 merged PR 即拒。
- 挡路卡 hold 而被挡卡未 hold(反之只报)⇒ 默认被挡卡随之入 hold,维护者在卡上另说除外。

## `pm:blocked`

- 正典标记 = 行首 `Blocked-by: #N`(跨仓 `owner/repo#N`)、写时无装饰;读者兼收列表/粗体/反引号。
- 该行是唯一来源:目标须为 open 卡或未合并 PR;等维护者亲手动作 ⇒ awaiting,⛔ 不挂本态。
- 句中提及刻意拒收;等 PR 合并写该 PR 号:合并才放,关而未合并 ⛔ 不放;等发布见下行。
- ⛔ 不扩词表;等发布的目标 = pin-bump 杂事卡,`Part of` 型 PR 的跟踪卡 ⛔ 不可用作目标。
- 工已完而被门禁缺陷卡住者同用本态,⛔ 不设新标签、不重派;`Blocked-by:` 指向门禁卡。
- 正文行 `Unlock-action: re-check PR #M`(重查落地)或 `re-check #N when label <标签> <absent|present>`。
- 只认此二值,别的拼写静默回落重派,散文另起行;停放的 PR 正文须点名那张门禁卡。
- 目标全关(PR 已合并)⇒ 每日扫描过可安装检查,一条评论放回队列;仍有阻塞即改写该行。
- 每日扫描另报:blocked 卡无该行或无 open 目标,互挡与成环,挡路卡级低于所挡,hold 不一致。
- 挡路卡取自身与所挡 open 卡(同仓跨仓同)里最高的级;人定的级 ⛔ 不动,由扫描报维护者。
- `scheduled-full-run-card.yml` 经 `scripts/ci/scheduled-full-run.mjs` 刷新小时红卡时亦放回,规则更窄:
- 双通道目标全为本仓已关卡(PR 已合并)、无 `Unlock-action:` 行与 assignee 才放;跨仓已关不放。
- 正文是正典家:新 blocker 停在评论、正文留已关旧目标 ⇒ 巡查报 stale 并要求迁回正文。

## `pm:awaiting-maintainer` 与 `pm:retriage`

- awaiting 入态带 `Maintainer-action: <席位做不了的动作> — done when <可查证据>`,双通道行锚定。
- 写不出即决定待做;本态无机器出口:维护者完成后由总监席核验摘标 + 证据评论同笔。
- 开发卡码已落只差维护者动作 ⇒ 席位另立维护者卡(本态+该行),关开发卡,放开所挡卡。
- 真要等该动作结果的卡,`Blocked-by:` 改指新立的维护者卡。
- 等维护者产品选择 ⇒ 带选项与推荐入决策箱,⛔ 不停 blocked/awaiting;逾 3 天每日扫描列出。
- retriage 原定级在改判前仍是权威;awaiting 卡在在飞视图里计停放库存。
- 挂标者 = 提出异议的席位,挂标与异议评论(证据 + 所求的答案)同笔;⛔ 裸挂标不合法。
- 摘标者 = 分诊 Routine,每 fire 先答异议评论所求、答后同笔摘标;老化兜底归巡查 H18。
- 释放者 = 让卡离手的席位:行首 `Release:`(会话/因/去向)与清 assignee 同笔;下一任重新认领。
