# 契约复核细则(按面)

见 landing-operations.md 〈入队与落地〉的条款②闸门;本文只放复核归属、资格与等复核标记。

## 复核归属与资格(按面)

- 欠不欠按面判 ⛔ 不按车道:diff 或认领申报碰下列任一面即欠达档复核,交付后当轮完成。
- 复核面 = 契约四面:`Clause-②: yes` 申报、收窄申报、已发布 schema(`packages/spec/src/**` 非测
  试)、governed 规则文本(统一定义见 SKILL.md);`.changeset`/CHANGELOG、`content/docs/**`、`apps/docs/**` 散
  文面 ⛔ 不在其列:派发席按本席档在 ACCEPT 逐句对照 diff 核,ACCEPT 点名所核句。
- 档随面定:已发布 schema 或 governed 规则文本 ⇒ `CONTRACT_REVIEW_TIER`,混合 diff 一处命中即此
  档;PR 正文与 changeset 行首 `Clause-②: no (narrowing)` 申报的收窄亦此档,范围为散文面外全
  diff;仅凭 `Clause-②: yes` 申报而欠 ⇒ `TIER_DEFAULT`,由车道席位作复核记录;档恰等不作下限。
- 混合 diff 的达档复核范围 = `reviewFace` 的 `hits` 路径 + 其 hunk 所断言的文件(读被引代码);
  规则与执行它的门禁同属一改者一并读;记录 `Scope:` 行列两者,可放宽、⛔ 不窄于 `hits`。
- 余部归车道席位 `TIER_DEFAULT` 的 ACCEPT,同单独开 PR 并点名;Tier H 人批与队列守卫仍整张 PR。
- 面读 PR 已提交树的文件清单(同队列守卫判 governed 路径)与申报行;⛔ 不读席位自述。
- 已发布面以包的 `exports` 映射为准:从入口类型图不可达、且 `exports` 不可寻址的 `.d.ts` 是
  出货字节,⛔ 不是已发布接受集,改它不触发 `Clause-②: yes`;legacy node10 深引用在契约之外。
- 四面皆不碰 ⇒ CI 加席位自读 ⛔ 不起第二个 agent;谁跑 = 派发席,达档者席内审。
- 派发席达档调用被配额拒(HTTP 429)⇒ ⛔ 不降档审;PR 落交接行、留等复核标记,交分诊席。
- `Contract-review-handoff: triage — CONTRACT_REVIEW_TIER unavailable (<HTTP status / error>, <UTC time>) · head <sha>`
- 分诊只接无人在审的欠审 PR(draft 亦算):现 head 无记录、无活认领,且 (a)(b)(c) 之一成立。
- (a) 交接行点名现 head 或 PR 带等复核标记,同轮接;(b) 现 head 已等满一轮分诊(约 60 分钟);
- (c) 车道席已收班或不在总表;欠审清单 = `node scripts/pm/check-owed-reviews.mjs`,只读。
- 车道或分诊起审前读 PR:现 head 有记录或活认领 ⇒ ⛔ 不起;否则先落认领行,一 head 一行:
- `Contract-review-claim: <session> · head <full sha> · <UTC>`
- 认领随 head 移动或贴后 2 小时无记录失效;同 head 双认 ⇒ 车道胜,分诊回帖撤回、弃产出。
- 车道暂缓本 head 送审落 `Contract-review-hold: <session> · head <sha> · <reason> · until <condition>`
- 新 head 即清;点名现 head 时 (b) 不起;条件满足由持有车道挂等复核标记或落交接行。
- 逾 24 小时条件未满的 hold 列入分诊轮次记录(`check-owed-reviews.mjs` 标出)。
- 复核记录 = 一条评论落 PR 或卡,席内与子代理同形;散文、dev 自评、`os-dev-report` 恒不算。
- 同形 = `## Contract review` 题头、head sha 独占码段、①②③ 逐项、独立性对、PASS/FAIL。
- 同形含首行 `Served-tier:`:值写该面所定档的常量名 `CONTRACT_REVIEW_TIER` 或 `TIER_DEFAULT`;
  无此行不成裁决;模板 `node scripts/pm/record-recognisers.mjs --template`,申报面加 `--face declaration`。
- 同形带 `Local-runs:` 行:`none` 或 `probe — REASON` 具名唯一探针;有行必校,缺行旧记录不改判。
- ① derived judgments 逐项:diff 引出的接受集与公开面变化逐条点名判对错。
- ② semver 定级与 changeset 声明一致;③ 边界旗:dev 挂旗与 `open_questions` 逐旗答复或升级。
- ④ 设计判断欠 schema、governed 规则文本、收窄三面,spec、skills、ADR 皆已在内 ⛔ 不另立面:
  逐 `hits` 文件判改动对所引代码与验收场景是否成立,ADR 另判首个消费者与执行计划;
  被引代码读而不审;①–④ 合称完整复核,余面同形无 ④,⛔ 无第二条记录。
- 实质 head 各欠一轮完整复核;只落发现的 commit 由同一复核者 delta 复核;无 must-fix 即止。
- 另记作者:PR `user.login` 非 `objectstack-fleet[bot]` ⇒ ③ 注点名该 login(脱中继写),落地前读。
- 简报从 `record-recognisers.mjs --brief-template` 起稿:只读条款与输入集内建,⛔ 不删 ⛔ 行。
- 独立性对:`Implemented-by:`/`Reviewed-by:` 取值同见 `--template`;子代理记采纳它的席位。
- ④ 恒由起草者之外的 agent 达档跑,起草已达档不免;喂入同上,⛔ 不喂起草者的结论。
- 轮次报告设复审清单专节,与呈裁清单同为强制审计。
- 请审/求批与落地前检两条,过则 Tier S 入队、Tier H 等人批:① 现 head 同形达档 PASS 在案。
- head 后移:纯重生成或只动散文面则原记录续管,落 `Regen-provenance:` 行;余移或现 head 落 FAIL
  而已挂 auto-merge ⇒ 派发席读到即照 AGENTS.md disarm 句撤挂,FAIL 记录点名撤挂;重挂照 ①。
- ② PR check 全绿,⛔ 非 required 子集;例外:merge-base 同签名的红不计、按设计而红见 SKILL.md。
- 签名 = 失败步 + 首错行,读 base check runs 的 API ⛔ 不凭口述;主干红止血立单不变。
- 落地时仍欠复核的 PR 在落地 head 复审,车道席或分诊按 (a)(b)(c) 接;FAIL ⛔ 不修已关 PR。
- 每条 must-fix 引该记录立新卡、按发现定级;回退仅限主干红(p0,main-red 约定①)或安全边界。

## 等复核标记 `needs:contract-review`

- 只作等复核标记,⛔ 不是闸门:无 check、workflow 或队列守卫读它与认领/hold 行;单载体 = PR。
- 挂:ACCEPT 时条款②任一肢命中而现 head 无同形 PASS 在案 ⇒ 派发席同笔挂于 PR。
- 摘:现 head 同形 PASS 在案 ⇒ 写记录的席同笔摘;PR 合并或关闭 ⇒ 派发席摘;FAIL 不摘。
