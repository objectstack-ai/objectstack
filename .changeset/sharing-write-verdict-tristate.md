---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
---

feat(sharing): `ISharingService` 的每行写判定补三态 —— 放行 / 不表态 / 拒绝(#6428)

#5492 的维护者裁决(2026-08-07,B 案)分两步兑现两种已声明的写扩权,本次是 **step 1:
契约与默认实现**。plugin-security 前像门的 provenance 分层合成是 step 2,本次一行未动。

**为什么二态不够(实测,不是推演)。** `canEdit()` 用同一个 `true` 表达了两件事 ——
「我有依据放行」与「本服务对这一行根本不设门」。对只**追加**一道门的调用方(sharing
中间件、`sys_attachment` 父记录门、ADR-0055 master 判定)这没问题:`true` = 「我不拦
你」。对让这个答案去**顶替另一个权威的地板**的调用方就是 fail-open —— #5492 的 E2 实验
把前像写门委托给 `canEdit()` 后,在**没有 `owner_id` 列**的对象上,普通成员跨 creator
的 UPDATE 变成 `ok: true`(main 上是 403),因为平台的 `created_by` 所有权地板正是这类
对象唯一的行级写门,而一个「不表态」的 `true` 把它盖掉了。

**新增契约面**(`@objectstack/spec/contracts`):

- `SharingWriteVerdict = 'allow' | 'abstain' | 'deny'` —— 闭合联合,普通 TS 类型
  (非 zod 派生,不进 ADR-0122 的 pin 计数)。
- `ISharingService.checkEdit()` / `checkDelete()` —— 三态主形态,动作边界照 ADR-0111 D3
  继承:`edit` 级共享让 `checkEdit` 答 `allow`、同一行 `checkDelete` 仍答 `deny`;两者
  的 `abstain` 集合完全相同(两道门对「哪些对象由共享设门」意见一致,只在动词上分歧)。

**兼容:`canEdit()` / `canDelete()` 原样保留,语义零漂移。** 它们被定义为三态的
**投影** `verdict !== 'deny'` —— 从前对 public / 无 owner 字段 / bypass 对象返回的那个
`true`,现在落在 `abstain` 上,投影回来仍是 `true`。真值表逐分支被测试钉住(9 个分支
× 两个动词),因为 `resolveSharingCanEdit`(plugin-security)与 `sys_attachment` 父记录
门读的正是这一列,翻掉任何一格都是本 PR 未触及的包里的静默权限变更。

**fail-closed 落点:查询失败是 `deny`,永远不是 `abstain`。** 两者对合成方是相反的指令
(`abstain` 把这一行交给另一个权威,`deny` 就地终结),把失败读成「没有意见」正是造出上述
fail-open 的那个混淆。默认实现把所有权查询与共享查询整段包在 fail-closed 分支里,并
`logger.error` 记名,不静默吞。

**行为变化(一处,方向收紧)**:引擎查询抛错时,`canEdit`/`canDelete` 从**向外抛**改为
返回 `false`。两个既有调用点本来就在自己那侧 catch 成 `false`(`resolveSharingCanEdit`
的 #5386 fail-closed、attachment hook 的降级读),所以对它们是同一结果;其余调用点由
「异常中止写入」变成「403 拒绝写入」,严格不更宽松。

**解锁**:#5492 step 2 的前像门可以按 provenance 分层合成 —— `abstain` 回落平台所有权
地板、`allow` 按声明顶替地板、`deny` 维持拒绝 —— 而不必在 security 侧重算一份
owner/depth/share/bypass(那会是同一契约的第二份实现)。#5491 与 #5492 同批落地。
