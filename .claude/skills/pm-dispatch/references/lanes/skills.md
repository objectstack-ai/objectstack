# 车道岗位说明:domain:skills

见 seat-lifecycle.md;本文是本车道岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 范围

- 两个技能根:`.claude/skills/**`(含 pm-dispatch 本体)与 `skills/**`(发布目录,恒英文)。
- 受管面治理执行文件:`.github/CODEOWNERS` 路由半边 + SUBJECT 是受管面本身的门禁/审计脚本。
- 全量判据在 SKILL.md 域车道表;受管面定义与两层分档见 SKILL.md 〈路径分叉〉,⛔ 不另抄。
- 契约复核归派发席席内、决裁勤务归总监席(`director.md`);本席保留 skill 与治理文本。
- 发布技能 `skills/**` 走子卡:修复改了作者或 agent 被教的内容 ⇒ 分诊首触即立本域子卡。
- 子卡带 `Blocked-by:` 产品卡,技能只记已落地的行为;产品 PR 正文点名该子卡。
- 退役时必跑门禁红产品 PR 则反序(spec-property-retirement §4):子卡只删键或改值,不记未落地。
- 产品车道 PR ⛔ 不改 `skills/**`;触了即把该 hunk 移入子卡,同 `spec.md` 的 `protocol:*` 兜底。
- 内部规则(`.claude/skills/**`、`AGENTS.md`、`CLAUDE.md`、`scripts/pm/**`)⛔ 永不搭产品 PR。
- 改规则(归属、门禁、上限、车道边界)先立决策卡,裁后本域写;新增门禁默认否照旧。
- 不改规则的修复(错字、陈旧路径、坏链)直交本域,不立决策卡。

## 常设承诺

- 四维分析先于派发与复核。
- Tier H 受管 PR 恒 draft 等维护者的字;flip 或 arm 前跑 `check-governed-merges --test` 带路径。
- 档位从 `--tier` 推导引用;pm-dispatch 根恒契约复审档;条款②闸门照现行。
- 棘轮逐行付账,⛔ re-wrap 筹行;砍点逐条核幸存,被砍内容若在别处无家,砍掉就是丢规则。
- 「Instruments serve the fleet」答不出的 finding ⇒ 建议 p3 或不做,⛔ 不自入队;定级归分诊。
- 内部指令面中文,机器判据恒英文;认领前重读全线程;标签写 read-modify-write 加回读。
- QA 波次由维护者手动触发,⛔ 不自启;`qa#1` 的 §6 例行与场景半边逐开发波跑,不是波次。

## 席内判断

- 技能文本改动的复核先问谁在读这一行:无具名读者的新增是 token 税。
- 每条经验自含失效模式与边界;⛔ 操作文本不引 issue 编号,id-lint 机械强制。
- 本车道的 SKILL.md 热文件链是 fold-or-serial 最常命中的现场,链首认领就是答题处。
