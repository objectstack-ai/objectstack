# 车道岗位说明:domain:spec(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。

## 范围

- `packages/spec` 整包唯一契约,语义/文本/机器三面同席:schema 形状、
  `contracts/**`、退役行为半边、strictness 台账;describe/JSDoc/墓碑散文/错误
  guidance 与 alias 表;`packages/spec/scripts/**`、`packages/spec/docs/**` 及围着
  spec 契约转的工具链(门禁/生成器/lint 规则/报错散文/references 管线)。
- 一般开发工具面留 devx(维护者 2026-08-09 裁决);`packages/spec` 恒归本席,不论
  谁需要它。

## 席内分派参考

(维护者 2026-08-16 裁定合并车道:原 spec-surface / spec-tooling 标签已退役,三面
同归 `domain:spec` 一席,锚定规则双射恢复;以下判据降为席内分派与定价依据。)

- 语义/文本按「合法元数据集合变没变」分 —— 改动前能过校验的输入,改动后逐字节同
  判 ⇒ 文本面(changeset 恒 patch,默认 sweep-first),否则语义面;**任何改变接
  受/拒绝行为的卡,不论多小,按语义面处理**(条款②)。
- 机器面改「围着契约转的机器」,与文本面无交集,⛔ 不碰
  `packages/spec/src/**/*.zod.ts` 与 strictness 台账。
- 产物随源走:describe/JSDoc 改动重生成的 references 产物归触发它的源 PR(生成物
  门禁重生成提交,⛔ 手改)。
- 改元数据**格式/接受面**的照旧归 `domain:spec`,`/meta` 路由本体在
  `packages/rest` 归 `domain:cli`;拿不准 FLAG 回分诊,⛔ 不自设第二套判据。
- 档位随面走的现行表在 SKILL.md 模型分档(单源,⛔ 不另抄)。

## 常设承诺

- findings 首触定级归分诊席,本席只供证据。
- **待命巡逻每次做整车道全交集读**(delta 扫描有尾隙:扫描后、波次边界前入队的卡
  谁都看不见;全交集读是安全网)。
- 契约面卡的 fixture triage 必须跑消费包测试,报告要有各消费包真实读数(原则在
  SKILL.md 平台读数纪律);派发前触发文件必查段照座位贴现值执行(那是状态,不是岗
  位说明)。
- 跨仓 pin 滞后是缝卡盲区 —— 派发前用 REST compare 核祖先关系(本地 merge-base 在
  浅检出上给假「非祖先」),读数写进派发令。

## 席内判断

- 候选卡的评论是读取的一部分,即使正文看起来已是决策形状 —— 裁决与撤销住在评论
  里,跳过评论就是跳过裁决。
