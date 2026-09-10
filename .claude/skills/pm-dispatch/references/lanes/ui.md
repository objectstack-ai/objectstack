# 车道岗位说明:domain:ui

见 SKILL.md 〈多仓协调〉;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本席为姊妹仓执行座位:在 objectui 仓认领、派发、复核、落地。
- ⛔ 不产 `domain:*`、type 与定级,中央分诊唯一生产,见 SKILL.md 多仓协调规则 1 与 4。
- 误标 ⛔ 不自改:挂 `pm:retriage` 加异议评论同笔,见同节规则 4。

## 范围

- 三流分流的残余流归本席:发布库 `@object-ui/*` 与 `apps/*`,判据见 SKILL.md 〈多仓协调〉。
- objectui 的 `domain:devx` 与 `domain:spec` 卡归各自跨仓车道,⛔ 不归本席。
- 症状位置不改流向,docs 随所记录的面走,两条同上节,⛔ 不在此另抄。
- 落点不明留分诊首触,⛔ 不猜、不代判。

## 常设承诺

- 构建产物经 `pnpm objectui:refresh` 回流,见 SKILL.md 〈多仓协调〉。
- 回流后的 console pin bump 是 objectstack 的单张卡,⛔ 永不做本仓 PR 的 rider。
- 凡触 `packages/spec` 一律转 `domain:spec` 座位,见 SKILL.md 〈多仓协调〉。
- `scripts/pm/**` 单写手恒在 objectstack 侧 ⇒ 本席的工具需求走上游卡带 `Blocked-by:` 回链。
- 受管面五项含仓根发布 `skills/**`,清单、判据与禁令见 objectui AGENTS.md §9 受管面段。
- ⇒ 命中即整 PR 停在 draft 等人合,⛔ 不 ready、不入队、不 auto-merge、不自合、不留批准。
- 未命中的 PR 按同节走合并队列落地;changeset 与版本纪律见 objectui AGENTS.md §9。
- 半状态巡查在本仓有载体:定时 workflow 与 sweeper 皆在,自 objectstack 移植。
- 锚 issue 未配置 ⇒ 写锚步骤 skip,发现只落 run summary,绿不等于已交付读锚腿。
- ⇒ 手工半边照 `hotcrm.md` 那条办,并每轮实测锚是否已配,⛔ 不沿用本行读数。

## 席内判断

- 卡正文是快照不是状态:⛔ 不凭正文单读裁决或派发,读全线程并对 `origin/main` 重测。
- `pm:queue` 在本仓兼指已分诊与可派发 ⇒ 逐张重验可派性,⛔ 不按标签直派。
- 零读数恒配点亮的正控,且正控须经被测机制本身生效;本仓 search 假零,查重只引命中。
- 脚本能滚动不证明用户能滚动:可达性断言必须驱动真实输入管道。
- 落地验证按内容,正控须在合并前证明会响,⛔ 不按 sha 判已落地。
- 档位与复核豁免边界读源码与 `references/contract-review.md`,⛔ 不凭记忆或继承的注记。
