# 契约复核细则(按车道)

见 SKILL.md 〈入队与落地〉的条款②闸门;本文只放载体纪律、归属资格与降档保险丝。

## 载体纪律(挂与清)

- 内容肢及于 published `skills/**`:作可证伪的算子或契约语义主张的改动挂标走本复核。
- ⛔ 判据不是提到契约:纯算子清单、拼写、格式不触发。
- `Clause-②: yes | no` 按设计临时:只定是否必过达档契约复核的保守方向,⛔ 非终审。
- 删误拒的 `Clause-②: no` 附 `Contract-text:` 引已发布契约文本,双载体同载;缺引即缺申报。
- 真闸门在 PR 或报告时点的达档复核;声明被复核推翻 ⛔ 不作席位过失。
- 机械地板 claim 时可查树:新导出符号或已发布载荷上的新键恒 `yes`,锁达档契约复核。
- conformance 类 ⛔ 不机械化:填充已声明字段、在两个已发布码之间重选输入类都需判断。
- claim 拿不准 ⇒ 按 `yes` 挂标走达档契约复核;⛔ 不建全量分类学与 claim 时决策程序。
- 同笔在卡上记一行条款②认定,PR 侧 ACCEPT 补齐;停靠只防误入队,⛔ 无无限期等外席态。
- 前瞻的条款②事实住卡上裁决与分诊评论、`Clause-②` 申报和 `--tier` 输出。
- 开着的载体恒 = 真实待审;载体不迁移:⛔ 不迁 PR review 或 Request Changes,⛔ 不为迁移留门。
- FAIL 同 PASS 剥双载体:同笔留卡上交接评论(引复审、独立性对、欠改);卡态与 assignee 不动。
- 重挂前先查裁决:闸门标签缺失 ⇒ 先 grep 卡评论找复审结论;`get_reviews` 读空 ≠ 未复审。
- PASS + 无标 + head 未动 = 已清标不是被剥;head 后移或无结论才重挂;清标缺引记录即半态。
- 例外:纯重生成 head 后移原记录继续管;判据机读已提交树 ⛔ 非自述;PR 落 provenance 行。

## 复核归属与资格(按面)

- 欠不欠按面判 ⛔ 不按车道:diff 碰下列任一面即欠达档复核,交付后当轮完成。
- 复核面 = 出货给用户或 agent 的五处:`content/docs/**`、`apps/docs/**`、CHANGELOG/`.changeset` 散文。
- 加已发布 schema(`packages/spec/src/**` 非测试)与 governed 规则文本(统一定义见 SKILL.md)。
- 五面皆不碰 ⇒ CI 加席位自读 ⛔ 不起第二个 agent;谁跑 = 派发席,达档者席内审。
- 复核记录 = 一条评论落 PR 或卡,席内与子代理同形;散文、dev 自评、`os-dev-report` 恒不算。
- 同形 = `## Contract review` 题头、所审 head sha 独占码段、①②③ 逐项、独立性对、PASS/FAIL。
- 同形含首行 `Served-tier:`:值写常量名 `CONTRACT_REVIEW_TIER`;无此行不成裁决,模板见 `--template`。
- ① derived judgments 逐项:diff 引出的接受集与公开面变化逐条点名判对错。
- ② semver 定级与 changeset 声明一致;③ 边界旗:dev 挂旗与 `open_questions` 逐旗答复或升级。
- 复核形状:只读 diff 与卡片,check 结论取 head 的 check-runs,⛔ 永不本地重跑派生门禁族。
- 独立性件(契约真分叉、dev 挂旗)与保险丝只免席内审,不免复核:起隔离达档子代理。
- 只喂卡片、既有裁决与 PR 本体,⛔ 不喂派发令与派发席自己的结论;简报写成对抗性。
- 隔离复核子代理暂存全写按所审 PR 命名的 `<scratchpad>/pr-<n>/`,⛔ 不读非本轮自写的暂存。
- 独立性对(机读):`Implemented-by:`/`Reviewed-by:` 取值见 `--template`;子代理记采纳它的席位。
- 两者同 session ⇒ 报 SELF-REVIEW;只 `mode:remote` 可达,`mode:subagent` 席内审是设计;值紧跟冒号。
- 清标即落地:PASS ⇒ 同席同笔剥双载体;清标同笔落 PR provenance 评论,引记录 id 与所判 head。
- 轮次报告设复审清单专节,形状与代裁清单同为强制审计。
- 落地前检三条,过则 Tier S 入队、Tier H 等人批:① 达档条款②复核 PASS 在案(同形记录)。
- ② 双载体已清,逐对机读 `PM_SWEEP_REPO=仓 node scripts/pm/check-clause2-carriers.mjs --pair N`。
- 确定性行 = 记录在案、`Served-tier:`、双载体一致、认领形;C5 放宽 tell 只报告,归复核裁。
- ③ PR check 全绿,⛔ 非 required 子集;例外:merge-base 同签名的红不计、按设计而红见 SKILL.md。
- 签名 = 失败步 + 首错行,读 base check runs 的 API ⛔ 不凭口述;主干红止血立单不变。

## 降档保险丝(机读)

- 保险丝只管 spec 与 skills 席的条款②复核:每场前必读服役档(`platform-readings.md`)。
- 总监席裁决非达档裁决,⛔ 不受本丝;总监席档位由维护者逐场定。
- ⛔ 自述档位与传参皆非读数;条款②的 `mode:subagent` 派发恒保留标至达档复核完成。
- 读数不达档 ⇒ 改走转录核验达档复核子代理;起不来即无复核,标签原样、队列外等档。
- 子代理档只取其转录 harness 逐请求 `model` 盖章;`get_session` 量的是派发会话,⛔ 不作互证。
- 清标前 `--pair`:`Served-tier:` ≠ 常量名 ⇒ exit 4,点名 PR、评论、读数;型号串按 `AGENTS.md` 拒。
- 施工档只取 harness `model` 盖章或认领 Container & model 行;`Co-Authored-By` = 署名常量 ⛔ 非证据。
- 产出裁决的每轮都须读到契约复审档位,见回退证据 ⇒ 裁决整体作废。
- 父会话只可逐字采纳或整体作废(核验失败、越范围、格式不完整),⛔ 永不改写润色。
- PASS、FAIL 与作废都落 PR 或卡;同 head 再起子代理须引前次作废因,⛔ 不重起求 PASS。
- 额度耗尽豁免只及派发 ⛔ 不及复核;档位退役 ≠ 耗尽,恒维护者裁决 ⛔ 非席位读数。
