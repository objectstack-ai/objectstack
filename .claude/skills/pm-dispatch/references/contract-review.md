# 契约复核细则(按面)

见 landing-operations.md 〈入队与落地〉的条款②闸门;本文只放复核归属、资格与等复核标记。

## 复核归属与资格(按面;复核席章程见 `lanes/review.md`)

- 欠不欠按面判 ⛔ 不按车道:diff 或认领申报碰下列任一面即欠达档复核,交付后当轮完成。
- 复核面 = 契约四面:`Clause-②: yes` 申报、收窄申报、已发布 schema(`packages/spec/src/**` 非测
  试)、governed 规则文本(统一定义见 SKILL.md);`.changeset`/CHANGELOG、`content/docs/**`、`apps/docs/**` 散
  文面 ⛔ 不在其列:派发席按本席档在 ACCEPT 逐句对照 diff 核,ACCEPT 点名所核句。
- 档随面定:已发布 schema 或 governed 规则文本 ⇒ `CONTRACT_REVIEW_TIER`,混合 diff 一处命中即此
  档;PR 正文与 changeset 行首 `Clause-②: no (narrowing)` 申报的收窄亦此档,范围为散文面外全
  diff;仅凭 `Clause-②: yes` 申报而欠 ⇒ `TIER_DEFAULT`,由车道席位作复核记录;档恰等不作下限。
- 混合 diff 的达档复核范围 = `reviewFace` 的 `hits` + diff 内直接实现或执行它的文件;
  后者审其合契约,diff 外被引代码只读;`Scope:` 行分列两者,可放宽、⛔ 不窄于 `hits`。
- 余部归车道席位 `TIER_DEFAULT` 的 ACCEPT,同单独开 PR 并点名;Tier H 人批与队列守卫仍整张 PR。
- 面读 PR 已提交树的文件清单(同队列守卫判 governed 路径)与申报行;⛔ 不读席位自述。
- 已发布面以包的 `exports` 映射为准:从入口类型图不可达、且 `exports` 不可寻址的 `.d.ts` 是
  出货字节,⛔ 不是已发布接受集,改它不触发 `Clause-②: yes`;legacy node10 深引用在契约之外。
- 四面皆不碰 ⇒ CI 加席位自读 ⛔ 不起第二个 agent;谁跑 = 派发席,达档者席内审。
- 派发席席内达档审;被配额拒(HTTP 429)⇒ ⛔ 不降档,留标记落交接行,点复核席,无则兄弟席:
- `Contract-review-handoff: <review#N|domain:<lane>#N> — CONTRACT_REVIEW_TIER unavailable (<HTTP status / error>, <UTC time>) · head <sha>`
- 欠审 PR(含 draft)现 head 无记录无活认领且 (a)(b)(c) 之一 ⇒ 复核席先接,车道次之,⛔ 非分诊
- (a) 交接行点名现 head 或带等复核标记,同轮由所点席接;(b) 现 head 已等满一轮(约 60 分钟);
- (c) 车道收班或离总表:欠审入交班简报待下席或复核席;清单 `scripts/pm/check-owed-reviews.mjs`。
- 复核席或车道起审前读 PR:现 head 有记录或活认领 ⇒ ⛔ 不起;否则先落认领行,一 head 一行:
- `Contract-review-claim: <session> · head <full sha> · <UTC>`
- 认领随 head 移动或贴后 2 小时无记录失效;双认 ⇒ 先贴者持有,后者回帖撤回、弃产出。
- 车道暂缓本 head 送审落 `Contract-review-hold: <session> · head <sha> · <reason> · until <condition>`
- 新 head 即清;点名现 head 时 (b) 不起;条件满足由持有车道挂等复核标记或落交接行。
- 逾 24 小时条件未满的 hold 列入分诊轮次记录(`check-owed-reviews.mjs` 标出)。
- 复核记录 = 一条评论落 PR 或卡,席内与各子代理同形;散文、dev 自评、`os-dev-report` 不算。
- 同形 = `## Contract review` 题头之下 `Head-sha:` 行独占码段、①②③逐项、独立性对、PASS/FAIL。
- 同形含首行 `Served-tier:`:值写该面所定档的常量名 `CONTRACT_REVIEW_TIER` 或 `TIER_DEFAULT`;
  无此行不成裁决;模板 `node scripts/pm/record-recognisers.mjs --template`,申报面加 `--face declaration`。
- ④ 设计判断欠 schema、governed 规则文本、收窄三面,spec、skills、ADR 皆已在内 ⛔ 不另立面:
  逐 `hits` 文件判改动对所引代码与验收场景是否成立,ADR 另判首个消费者与执行计划;
  实现文件审合契约、diff 外只读;①–④ 合称完整复核,余面同形无 ④,⛔ 无第二条记录。
- 实质 head 各欠一轮完整复核,发现逐条定 must-fix/should-fix/nit(无碍正确性与契约);有前两级
  才由同一复核者 delta 复核修复;仅 nit 即终轮,nit 记接受的偏差、转后续卡或只改散文面。
- 另记作者:PR `user.login` 非 `objectstack-fleet[bot]` ⇒ ③ 注点名该 login(脱中继写),落地前读。
- 简报从 `record-recognisers.mjs --brief-template` 起稿:只读条款与输入集内建,⛔ 不删 ⛔ 行。
- 独立性对:`Implemented-by:`/`Reviewed-by:` 取值同见 `--template`;子代理记采纳它的席位。
- ④ 恒由起草者之外的 agent 达档跑,起草已达档不免;喂入同上,⛔ 不喂起草者的结论。
- 卡线程隔离子代理照上落现 head 记录并贴简报 ⇒ 席核简报、`Scope:` 与独立性对后采纳,
  ACCEPT 点名其评论 id;`Scope:` 窄于 `hits` 不采纳;席的补缺记录只管缺口,⛔ 不单充 head 记录。
- 轮次报告设复审清单专节,与呈裁清单同为强制审计。
- 请审/求批与落地前检两条,过则 Tier S 入队、Tier H 等人批:① 现 head 同形达档 PASS 在案。
- head 后移例外:纯重生成或只动散文面原记录续管,落 `Regen-provenance:` 行;余移或现 head 落 FAIL
  而已挂 auto-merge ⇒ 派发席读到即照 AGENTS.md disarm 句撤挂,FAIL 记录点名欠撤挂;重挂照 ①。
- ② PR check 全绿,⛔ 非 required 子集;例外:merge-base 同签名的红不计、按设计而红见 SKILL.md。
- 签名 = 失败步 + 首错行,读 base check runs 的 API ⛔ 不凭口述;主干红止血立单不变。
- 落地时仍欠复核的 PR 在落地 head 复审,复核席或车道席按 (a)(b)(c) 接;FAIL ⛔ 不修已关 PR。
- 每条 must-fix 引该记录立新卡、按发现定级;回退仅限主干红(p0,main-red 约定①)或安全边界。

## 等复核标记 `needs:contract-review`

- 只作等复核标记,⛔ 不是闸门:无 check、workflow 或队列守卫读它与认领/hold 行;单载体 = PR。
- 挂:ACCEPT 时条款②任一肢命中而现 head 无同形 PASS 在案 ⇒ 派发席同笔挂于 PR。
- 摘:现 head 同形 PASS 在案 ⇒ 写记录的席同笔摘;PR 合并或关闭 ⇒ 派发席摘;FAIL 不摘。
