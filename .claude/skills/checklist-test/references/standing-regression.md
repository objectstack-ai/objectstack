# 常驻回归 —— 两次发版之间也重跑

文中 §N 指 `../SKILL.md` 的节。

维护者所定的两条例行(裁定评论 6501246005)归 QA 席 `qa#1`;何时开轮只见 pm-dispatch `lanes/qa.md`,
⛔ 本节不另写节奏;例行不是仓库代码,也不是合并门禁。

- **例行回归**,对 `main` HEAD,四张 `qa-run` 记录,一个选择器一张:
  - 欠测清单:标题选择器写 `owed:weekly`(⛔ 不带冒号的词会被读成区),清单里每个 id
    按 §0 裸 id 逐项解析;
  - `touched:<上轮 touched 记录的 subject sha>`;首轮取最近一张发版全量重跑记录的 subject;
  - `priority:P0` 与 `surface:api`。
  §5 的 Supersede 让每条例行至多开着一张:选择器轮轮相同的三张直接适用;`touched:` 的 sha
  每轮都变,本轮那张照样 supersede 上轮那张,判定结转照 §5。
- **发版后 npm 冒烟**:每次发布后跑 `smoke:npm-<版本>`,形状照上一张同类记录;上一轮冒烟抽出
  的修复卡在这里重判(它们的溯源行见 §5 的冒烟例外)。
- **欠测清单**由 `node scripts/qa/retest-owed.mjs` 只读算出(⛔ 不写 GitHub):
  QA 抽取的修复卡关闭晚于该项最新判定的 subject,该项即欠测 —— 就是 §5 触发 2 的清单。
