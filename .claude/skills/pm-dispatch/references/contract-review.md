# 契约复核细则(按面)

见 SKILL.md 〈入队与落地〉的条款②闸门;本文只放复核归属与资格。

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
- 只喂卡片、既有裁决与 PR 本体,⛔ 不喂派发令与派发席自己的结论;简报写成对抗性。
- 隔离复核子代理暂存全写按所审 PR 命名的 `<scratchpad>/pr-<n>/`,⛔ 不读非本轮自写的暂存。
- 独立性对:`Implemented-by:`/`Reviewed-by:` 取值见 `--template`;子代理记采纳它的席位。
- 轮次报告设复审清单专节,形状与代裁清单同为强制审计。
- 落地前检两条,过则 Tier S 入队、Tier H 等人批:① 达档条款②复核 PASS 在案(同形记录)。
- 例外:纯重生成 head 后移原记录继续管;判据机读已提交树;PR 落 `Regen-provenance:` 行。
- ② PR check 全绿,⛔ 非 required 子集;例外:merge-base 同签名的红不计、按设计而红见 SKILL.md。
- 签名 = 失败步 + 首错行,读 base check runs 的 API ⛔ 不凭口述;主干红止血立单不变。
