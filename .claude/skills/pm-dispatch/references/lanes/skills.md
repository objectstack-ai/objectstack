# 车道岗位说明:domain:skills(references/lanes —— 座位贴指针指向本文件)

岗位说明版本化于此,升级走技能 PR;现值状态恒在座位贴,⛔ 不迁入本文件。

## 范围

- 两个技能根:`.claude/skills/**`(含 pm-dispatch 本体)+ `skills/**`(发布目录,
  恒英文);`scripts/pm/**` PM 循环工具;指令架构文件:根 `AGENTS.md` + 根
  `CLAUDE.md`;governed 面的治理执行文件(`.github/CODEOWNERS` 治理路由半边 +
  SUBJECT 是 governed 面本身的门禁/审计)。全量判据与裁决引文在 SKILL.md 域车道
  表;governed 面统一定义见 SKILL.md「ACCEPT 之后的路径分叉」,判定命令
  `node scripts/pm/check-governed-merges.mjs --test` 带路径。
- QA 管理循环执行归本席;qa-run 记录是协议载体不是工作;契约复审(条款②复审链)归
  分诊席,本席仅过渡期代行。

## 常设承诺

- 四维分析先于派发与复核。
- governed PR 恒 draft 等人合;flip/arm 前跑 `check-governed-merges --test`;轮报
  的 governed 合并审计清单带 `--since` 四仓实跑,⛔ 不凭记忆汇总。
- 档位从 `--tier` 推导引用;pm-dispatch 根 fable 强制;条款②闸门照现行;限额豁免
  floor opus。
- 棘轮逐行付账,⛔ re-wrap;付账砍点逐条核幸存 —— 被砍内容若在别处无家,砍掉就是
  丢规则。
- 首触定级每轮;决策形状 ⇒ 决策箱带四棱块,⛔ 永不自裁(唯一例外:本车道 finding
  自分诊,全仓轮跳过)。
- 内部指令面中文,机器判据恒英文;认领前重读全线程;标签写 read-modify-write +
  回读。
- QA 波次由维护者手动触发,⛔ 不自启。

## 席内判断

- 技能文本改动的复核先问「谁在读这一行」—— 无具名读者的新增是 token 税;每条经验
  自含失效模式与边界,⛔ 操作文本不引 issue 编号(id-lint 机械强制)。
- fold-or-serial 必答与家族派发五门在 SKILL.md 批次独立性段 —— 本车道的 SKILL.md
  热文件链是它最常命中的现场,链首认领就是答题处。
