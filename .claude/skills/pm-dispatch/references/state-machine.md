# 状态机细则

见 SKILL.md 〈状态模型〉;本文只放各状态的行契约、双通道与巡查判据。

## 跨状态通则

- 六态 = `pm:{queue,dispatched,blocked,on-hold,awaiting-maintainer}` 加 `needs-user-decision`。
- 六态 ONE-OF 的成因恒是半写的转换;判定以 `check-half-states.mjs` 的 H29/H30/H31 为权威。
- 生成物不分叉:`skills/**` 生成器产物跑 `check-governed-merges.mjs --test`,⛔ 不按路径手判。
- `needs:contract-review` 卡侧先挂而 PR 尚不存在是合法中间态,⛔ 不读作半写。
- 交接即标签:只写交接评论而不同笔挂标 = 空交接,收件箱只认标签。

## `pm:on-hold`

- 合法性:正文或评论带 `Restart-when: closed <owner/repo>#N`,由 `Blocked-by:` 同遍解锁扫描点火。
- 或带 `Restart-when: <一行可执行判据>`;两种拼写之外的 hold ⛔ 不合法。
- hold 评论写明日期、理由与出处(维护者裁或座位定级),⛔ 不设第二个标签区分两者。
- 机会主义重启的触发文件走 `Restart-touch: <仓内相对路径>`,一行一路径,值须为 tracked 文件。
- 该行大小写敏感、行锚定,与另两行同双通道,喂 H17 触发文件索引;存量 hold ⛔ 不迁移。
- 放行双查两查皆机械零判断:① 只放最近一次 `pm:on-hold`/`pm:blocked` 转换评论的条件。
- ② 该评论之后卡上有更新的 merged PR ⇒ 拒绝放行;⛔ 永不对更早的 blocker 放行。

## `pm:blocked`

- 正典标记 = 行首 `Blocked-by: #N`(跨仓 `owner/repo#N`)、无装饰;指令是行,句中提及是散文。
- 句中提及刻意拒收;等 PR 合并或等发布且 pin 覆盖的卡同理,指一张在该刻关闭的卡。
- ⛔ 不扩词表;等发布的目标 = pin-bump 杂事卡,`Part of` 型 PR 的跟踪卡 ⛔ 不可用作目标。
- 工已完、PR 被外部门禁缺陷卡住者同用本态,⛔ 不设新标签;`Blocked-by:` 指向那张门禁卡。
- 正文加机器可读行 `Unlock-action: re-check PR #M`,把解锁出口改为重查该 PR 落地。
- 只认此一值,别的拼写静默回落重派,散文另起行;停放的 PR 正文须点名那张门禁卡。
- ⛔ 永不给完工卡重派 dev。
- 上游已关 ⇒ 先重新推导是否有新阻塞并改写该行,⛔ 不反射式放行。
- 正文是正典家:新 blocker 停在评论、正文留已关旧目标 ⇒ 巡查报 stale 并要求迁回正文。

## `pm:awaiting-maintainer` 与 `pm:retriage`

- awaiting 无机器出口:维护者完成该操作后,由项目总监席核验摘标 + 证据评论同笔。
- awaiting 卡在在飞视图里计停放库存。
- retriage 挂/摘分属两方:原定级在改判前仍是权威。
- 挂标者 = 提出异议的席位,挂标与异议评论(证据 + 建议定级)同笔;⛔ 裸挂标不合法。
- 摘标者 = 分诊 Routine,每 fire 高优先重判、重判后摘标;老化兜底归巡查 H18。
- 标签须五仓存在,首次应用时创建。
