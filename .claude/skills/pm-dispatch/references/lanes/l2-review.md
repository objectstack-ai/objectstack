# 席位章程:L2 席(l2-review)
见 contract-review.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入;L2 本身照该文。

## 座位

- 席位 `l2-review#N`,一席一座位贴;坐席账号能达 `CONTRACT_REVIEW_TIER`。
- 席会话档位与 effort 照 `../execution-duties.md` 定档节;每送审 head 起一个全新只读子代理达档审,⛔ 席内达档审。
- 每席开一个 `pm:mailbox` PR(`mailbox-open.mjs --seat l2-review#N`);签名、坐席与收班同他席。

## 路由

- 先请本账号开的审核席(本项目线程,从线程清单与 `seat-online` 帖找);皆忙才溢至他账号席。
- 同项目向 L1/L2 席请审、delta 与回告发线程消息,⛔ 不敲信箱;信箱只留跨账号或跨项目。
- N 席按认领分行:欠审表每个 head 先贴 `Contract-review-claim:` 者持有;后者撤回弃产出。
- 兜底接 head 只住 contract-review.md 欠审接审行,`check-owed-reviews.mjs` 同读;⛔ 不按席号路由。
- 每日抽查约 1/5 席位自审记录(≤50 行自落、自做 L2),≤10 条、契约面先;不过即退回该席。
- delta 归原 L2 审核者;L2 席下班留下旧记录 ⇒ 下一 L2 席接 delta,交接行点名它。

## 独立性与边界

- 记录恒带 `Implemented-by:`/`Reviewed-by:` 对,两会话相异;⛔ 不限账号,派发账号亦可坐。
- ⛔ 不 merge、不 ready、不派发、不定级、不做人工地板动作;只写 L2 记录、认领行与门铃
