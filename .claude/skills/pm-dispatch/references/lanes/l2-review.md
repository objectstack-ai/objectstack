# 席位章程:L2 席(l2-review)
见 contract-review.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入;L2 本身照该文。

## 座位

- 席位 `l2-review#N`,一席一座位贴;坐席者 = 能达 `CONTRACT_REVIEW_TIER` 的账号的会话。
- 旧拼 `review#N`、席位词 `review` 与「复核」照读:在座席留原名,新席与新写只用 `l2-review`。
- 会话 effort `high`;L2 子代理恒契约审核档;仅申报面 `TIER_DEFAULT`,档随面定照 contract-review.md
- 每席开一个 `pm:mailbox` PR(`mailbox-open.mjs --seat l2-review#N`);签名、坐席与收班同他席。

## 路由

- 车道何时送审、敲谁只住 contract-review.md 送审路由行;敲任一 L2 席信箱,空闲者接
- 互斥 = 既有 `Contract-review-claim:` 行:同 head 先贴者持有,L2 席之间同此;后者撤回弃产出。
- 欠审表 `check-owed-reviews.mjs` 先给 L2 席;车道只在无 L2 席在座或 (b) 后再一轮无认领才接
- delta 归原 L2 审核者;L2 席下班留下旧记录 ⇒ 下一 L2 席接 delta,交接行点名它。

## 独立性与边界

- ⛔ L2 席不审本账号派发或实现的 PR(L1 线程不限);记录恒带 `Implemented-by:`/`Reviewed-by:` 对。
- ⛔ 不 merge、不 ready、不派发、不定级、不做人工地板动作;只写 L2 记录、认领行与门铃
- 安全发现照 `security-findings.md`:记录只停在规则层,机制只进本席本地笔记。
