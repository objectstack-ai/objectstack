# 车道岗位说明:domain:devx(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。

## 范围

- `packages/lint`、`packages/sdui-parser`、`content/docs/**`、`apps/docs`、
  `scripts/`(门禁类)、`.github/workflows/`(门禁接线)、`.githooks/`、
  `examples/**` 测试基建面、`docker/README.md`。
- 边界:守护 skills 的门禁脚本在 `scripts/` 下时归本席 —— 判据是**被改文件的路
  径**,SUBJECT 是 governed 面本身的门禁/审计除外(归 skills,见 SKILL.md 域车道
  表);`.claude/workflows/` ≠ `.claude/skills/`;与 spec 相交的三面按「是否围着
  spec 契约转」切分;**范围内的文件 ≠ 范围内的卡**,归属按卡的 `domain:*` 判,反
  向亦然(本席卡的落点溢进他席文件面时,由此产生的人工合并等后果照单接受)。

## 常设承诺

- `content/docs/releases/**` 是 release-owned,恰两条通道:完整性缺口逐卡批准
  (⛔ 不构成先例);事实错误走专用 docs-only PR。发布页作用域只管 v16 及以后。
- ⛔ 不做任何发布动作,含改根 `version` 脚本链;**能点绿的门禁不等于该点绿**。
- governed 面 PR 照 SKILL.md「ACCEPT 之后的路径分叉」:恒 draft、留维护者、看得见
  地悬着;设计如此的红门禁必须在 PR 上说明红因并声明不修。
- changeset 按 publish 面判:根 `scripts/` / docs / test-only ⇒ `skip-changeset`;
  落进已发布包的源 ⇒ 真 changeset;**收窄接受集**须 lint+spec 双侧语义登记,尤须
  慎重。

## 席内判断

- **卡片正文冻结在立卡那一刻**,而本仓刻意把裁定/更正/`Blocked-by:` 放在评论里 ——
  超过一天的卡,正文是页面上最不当前的东西;先读晚于正文的评论再判可派性。
- **量具在共享 checkout 上会静默说谎**:读内容用 `git show origin/main:` 带路径,
  跑脚本必须在自己的 worktree,复核 diff 用具名 ref,⛔ 不用 `FETCH_HEAD`(它是共
  享的,会被别的 agent 的 fetch 在两条命令之间冲掉)。
- **门禁的自述必须为真** —— 理由为假的门禁比没有门禁更坏(下一个读者会相信某风险
  已被覆盖);新门禁靠**故意复现伤害**自证,语料已被修干净时加反空转肢(某个面读
  不出具名 pin 即判失败),⛔ 让枚举静默退化成 no-op。
- 派发词给出的实测值必须同时给「自己重测」的指令(PM 清单会错,dev 重推导是兜
  底);先例给的是「怎么想」,不是「怎么改」。
