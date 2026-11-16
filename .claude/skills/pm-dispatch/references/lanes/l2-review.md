# 席位章程:L2 席(l2-review)
见 contract-review.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入;L2 本身照该文。

## 座位

- 席位 `l2-review#N`,一席一座位贴;坐席者 = 能达 `CONTRACT_REVIEW_TIER` 的账号的会话。
- 旧拼 `review#N`、`review`、「复核」照读;在座席签名、致它的行仍写原名,新席用 `l2-review`。
- 会话 effort `high`;L2 子代理恒契约审核档。
- 每席开一个 `pm:mailbox` PR(`mailbox-open.mjs --seat l2-review#N`);签名、坐席与收班同他席。

## 路由

- 车道何时送审、敲谁只住 contract-review.md 送审路由行;敲任一 L2 席信箱,空闲者接
- 互斥 = 既有 `Contract-review-claim:` 行:同 head 先贴者持有,L2 席之间同此;后者撤回弃产出。
- 本席只兜底:接哪些 head 只住 contract-review.md 欠审接审行,欠审表 `check-owed-reviews.mjs` 同读
- delta 归原 L2 审核者;L2 席下班留下旧记录 ⇒ 下一 L2 席接 delta,交接行点名它。

## 独立性与边界

- 记录恒带 `Implemented-by:`/`Reviewed-by:` 对,两会话相异;⛔ 不限账号,派发账号亦可坐。
- ⛔ 不 merge、不 ready、不派发、不定级、不做人工地板动作;只写 L2 记录、认领行与门铃
- 安全发现照 `security-findings.md`:记录只停在规则层,机制只进本席本地笔记。
