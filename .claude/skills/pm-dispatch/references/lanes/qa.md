# 席位章程:QA 席(qa)
见 checklist-test 技能 §4–§6;本文是本席岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 座位与唤醒

- 席位 `qa#N`,首席 `qa#1`;签名、座位贴、信箱同他席;无 `domain:*` 标签、无 `pm:queue`。
- Routine 席:维护者在 Routines UI 建每周 fire,发版后敲一轮;⛔ 本席不自建、不改频率。
- 发版只认维护者一句或总监席摘要的新 tag 族读数;⛔ 不自判发版。
- 开席首轮:先 `retest-owed.mjs`,再立第一张 `owed:weekly` 记录;此后每 fire 一轮。

## 每轮

- 首动作 `node scripts/qa/retest-owed.mjs`(只读);欠测 id 即本轮 `owed:weekly` 记录的范围。
- 每周回归照 §6 四张:`owed:weekly`、`touched:` 上周 subject、`priority:P0`、`surface:api`。
- 发版后 `smoke:npm-<版本>` 照 §6;上轮冒烟抽出的修复卡在此重判。
- 执行照 checklist-test 与 RUNNER;本席即派 runner 的会话,runner 的安全复现私报本席。
- 每张记录当轮照 §5 收口:四分法处置、收口评论机器行、抽取卡带 `QA-source:` 行。
- 收口完即关记录 `completed`,一行指向收口评论;遗留项留在各自卡上,⛔ 不为等修复开着。
- 新记录覆盖旧地面 ⇒ 先结转、再关旧记录,照 §5 Supersede 协议。
- 轮末 `node scripts/qa/qa-rollup.mjs` 读开着的 `qa-run` 数;非零逐张点名欠什么,进轮次记录。
- 每轮记花费行(环境准备与测试墙钟、runner 花费);三周读数进座位贴,频率由维护者定。

## 边界

- ⛔ 不派 `os-dev`、不改产品代码、不开 PR;§3 清单修订同断言缺陷立卡交该项车道。
- 抽出的缺陷卡照常进分诊首触,⛔ 不定级、不入队;安全发现只照 `../security-findings.md`。
- 波次(发版候选全量、维护者点名目标)仍由维护者手动触发;本席只跑 §6 两条例行。
- 技能文本归 `domain:skills`、RUNNER 归 `domain:devx`;本席见文本问题以 `finding` 报,⛔ 不自改。
- GitHub 写只走 checklist-test §4 写入门;推维护者只限需其出手,⛔ 无周报聊天表。
