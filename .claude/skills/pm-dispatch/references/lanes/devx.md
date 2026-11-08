# 车道岗位说明:domain:devx

见 seat-lifecycle.md;本文是本车道岗位说明,现值状态恒在座位贴,⛔ 不迁入本文。

## 范围

- 定位:AI 员工流水线效率,即 agent 的活从 push 到合并跑得多快、多稳。
- 度量六项:PR CI 墙钟、队列等待 p50/p90、级联重建、PR runner 分钟、flaky 率、报告假绿数。
- 报告假绿 = dev 报告称绿而 CI 红。
- 规则与知识(告诉 agent 什么)归 `domain:skills`;工具与流水线(agent 的活跑多快)归本席。
- 本席路径面全量在 SKILL.md 域车道表 `domain:devx` 行,⛔ 不另抄。
- 车道按包判,⛔ 不按触发:只记录一个包的 `content/docs` 页随该包车道,同 `domain:ui` 行。
- 本席留 `apps/docs`、导航 `meta.json`、references 管线,及横跨两条及以上车道的 sweep。
- `.github/workflows/**` 按路径归本席;产品卡要改 workflow ⇒ 另立本席卡并回链该产品卡。
- `examples/**` 的 `vitest.config.ts`、fixtures、共享 harness 归本席;产品行为 pin 归所演练子系统。
- 边界:守护 skills 的门禁脚本在 `scripts/` 下时归本席,判据是被改文件的路径。
- SUBJECT 例外与 spec 三面切分在 SKILL.md 域车道表;`.claude/workflows/` 不是 `.claude/skills/`。
- 范围内的文件不等于范围内的卡:归属按卡的 `domain:*` 判,反向亦然。
- 本席卡的落点溢进他席文件面时,由此产生的人工合并等后果照单接受。

## 常设承诺

- `content/docs/releases/**` 是 release-owned,恰两条通道;发布页作用域只管 v16 及以后。
- 通道一:完整性缺口逐卡批准,⛔ 不构成先例。通道二:事实错误走专用 docs-only PR。
- ⛔ 不做任何发布动作,含改根 `version` 脚本链;能点绿的门禁不等于该点绿。
- 设计如此的红门禁必须在 PR 上说明红因并声明不修。
- 收窄接受集须 lint 与 spec 双侧语义登记,尤须慎重。

## 席内判断

- 量具在共享 checkout 上会静默说谎:读内容用 `git show origin/main:` 带路径。
- 跑脚本必须在自己的 worktree;复核 diff 用具名 ref,⛔ 不用 `FETCH_HEAD`。
- 门禁的自述必须为真:理由为假的门禁比没有门禁更坏,读者会相信某风险已被覆盖。
- 新门禁靠故意复现伤害自证;语料已被修干净时加反空转肢,某面读不出具名 pin 即判失败。
- 派发词给出的实测值必须同时给自己重测的指令:PM 清单会错,dev 重推导是兜底。
- 先例给的是怎么想,不是怎么改。
