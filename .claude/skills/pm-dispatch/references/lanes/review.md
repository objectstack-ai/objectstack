# 席位章程:复核席(review)
见 contract-review.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入;复核本身照该文。

## 座位

- 席位 `review#N`,首席 `review#1`,一席一座位贴;坐席者 = 能达 `CONTRACT_REVIEW_TIER` 的账号的会话。
- 会话 effort `high`;复核子代理恒契约复审档;仅申报面 `TIER_DEFAULT`,档随面定照 contract-review.md
- 每席开一个 `pm:mailbox` PR(`mailbox-open.mjs --seat review#N`);签名、坐席与收班同他席。

## 路由

- 车道 `Request: contract-review` 敲任一复核席信箱,空闲者接;无复核席在座敲兄弟席,⛔ 非分诊
- 互斥 = 既有 `Contract-review-claim:` 行:同 head 先贴者持有,复核席之间同此;后者撤回弃产出。
- 欠审表 `check-owed-reviews.mjs` 先给复核席;车道只在无复核席在座或 (b) 后再一轮无认领才接
- delta 复审归原复核者;复核席下班留下旧记录 ⇒ 下一复核席接 delta,交接行点名它。

## 独立性与边界

- ⛔ 不复核本账号派发或实现的 PR;记录恒带 `Implemented-by:`/`Reviewed-by:` 对。
- ⛔ 不 merge、不 ready、不派发、不定级、不做人工地板动作;只写复核记录、认领行与门铃
- 安全发现照 `security-findings.md`:记录只停在规则层,机制只进本席本地笔记。
