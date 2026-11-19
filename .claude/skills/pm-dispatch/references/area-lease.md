# 区域租约模式(area-lease)

本模式 = 一席 + 按需分区 + L1 线程 + 区域 ACCEPT 后自落地;席留 W0、路由、受管面与台账。

## 分不分区,动态定

- 坐席、每次交接或换班时席位重判三件:分不分、分几区、边界;⛔ 不沿用上一班的表。
- 分区阈值(经验):可认领 p1/p2 ≥15 张且跨 ≥3 个互不相干的模块簇;不足即照常按卡认领。
- 边界按卡触及的文件与包聚类,让两区极少改同一函数;⛔ 不按卡标题或词汇分。
- 排空的区并入邻区,积压即再拆(「比如增加分区」),⛔ 不抬一容器 2 dev 的并行验证上限。
- 租约表(区→路径→线程会话)住座位贴,任一列变或线程轮换即重写,为唯一记录。
- L1 线程每 3 活跃区一条,新开名 `L1-a`、`L1-b`…,在跑留原名;`lanes/l2-review.md` 席规不及它。
- 请 L1 审或 delta 发线程消息,只取区在 PR 评论宣布的定稿绿 head;信箱只留跨账号或跨项目。
- ⛔ 不入区:大卡(`dispatch-runbook.md` 卡线程节)与队列值守(只照 `lanes/queue.md`,含其无席兜底)。

## 开席

1. 席位会话坐席:座位贴存根、自有信箱(`project-forms.md`)、租约表。
   - 信箱一步恒不省:「不按旧规」也不豁免;重坐、换号或移座恒开新信箱。
2. 每区一条项目线程,由协调者开(`coordinator.md`);L1 线程照上节 L1 线程行。
3. 维护者在每条新席线程亲写一句授权行:auto mode 只认本线程维护者原话,转述与点选不算。
   - 席线程:「审批人批准后的 Tier H PR 你可以自主落地」
   - 授权行只解 auto mode 的拦截,⛔ 不改 AGENTS.md 第 14 条的落地档;区线程无授权行。
4. W0:各区首小时交席位一份关/并/改级/呈裁清单,同时即开首张 p1。
   - 清单经维护者过目后落笔:定级照 SKILL.md 域车道(自分诊例外住 `triage-duties.md`)。

## 区内规则

- 区会话署本席签名,签名第三位与 `Session:` 皆填区会话 ID;开轮互斥读法照 `seat-lifecycle.md`。
- 认领前重读标签、assignee 与末条评论:他人 assignee、他人 `Claim:` 或他区 `lease:*` ⇒ 不碰。
- 认领前三查必过,各写认领评论一行;任一不过或遇大卡 ⇒ 不认领、不派 dev,当即交席位:
  - `Pre-claim lane:` 修复所改路径属哪条车道,点名依据路径(碰他道路径照下文留道行)。
  - `Pre-claim deps:` 卡点名的 `Blocked-by:`、「after #N」逐个已合;热文件照下文重叠检查。
  - `Prior rulings read:` 照 `decision-analysis.md`;grep `docs/adr/**`、链卡(⛔ 行在内)与反向 pin
    测试;记录冲突,或路线改门的可见行为超出本卡裁决,同作不过。
- 重叠检查:认领前与每次推前跑 `scripts/pm/overlap-check.mjs`;exit 1 排所列 PR 后,3 补前提重跑。
- 认领照 `execution-duties.md` 派发原子对,同笔加 `lease:<区>`;`Branch:` 照 AGENTS.md 命名。
- 认领后回读标签(SKILL.md 标签写四步):缺 `lease:` 或 `pm:dispatched` 即重挂;首推即开 draft PR。
- 认领前照 `dispatch-runbook.md` 派发前置核前提;开线程请求交席位攒批(`coordinator.md` 三)。
- 写码与开发期读码全经 `os-dev` 等子代理(一卡或一组耦合卡,文件面不相交)。
- 同系列卡可从前卡分支起步(AGENTS.md §2 主干形,⛔ 不叠 PR);新测试建按卡命名的新文件,
  AGENTS.md 共享 harness 规则适用时除外,由重叠检查定排队。
- 席线程只协调,⛔ 不读 diff 与日志;ACCEPT 欠的自读(`contract-review.md`、〈路径分叉〉)除外。
  所落 PR 欠的红检查读日志(`platform-readings.md`)派子代理读,一读兼守本条与该文。
- 每区恒 2 dev,空即补;逐位上张 PR 入合并队列才领下张,此前跑修复轮;Tier H 或待裁 PR 让位。
- 席每轮逐区查;⛔ 不单做 p3:只搭同文件 p1/p2 PR(每 PR ≤5 卡);转制时已领未动的 p3 释放。
- 同函数互相牵连的卡合一 PR,准入照 `execution-duties.md` 折叠五门,额度墙亦照该文。
- 留道:修法已清的卡碰 `ui/**`、`packages/spec/**` 仍在本道开发、本席 L1/L2;他道席在线只通知
  「如果车道有人在线，只需要通知他就可以。」本条先于条款②行(`execution-duties.md`)、
  移道的 `lanes/spec.md` 与 `--tier` 提示;交出闭集:他道在线席已认领、cloud 路由、安全、ADR。
- 送审:≤50 行、只改文本或测试、`Clause-②: no` 且无他契约面 PR 由区照 `l1-review-checklist.md`
  自审落地,ACCEPT 点名自审;余者由 L1 线程 ACCEPT 读,先于 `contract-review.md` 不起第二个 agent。
- 契约记录只欠 `contract-review.md` 四面,head 移动照其例外;同 patch-id 干净合 main 只保 ACCEPT。
- 落地:区先读 `check-governed-merges.mjs --pr N`;非受管 PR 照 `landing-operations.md` 自落,受拒报原文。
- PASS 且全绿的非受管 PR 10 分钟内落地;挂前先查 PR 上已有落地评论,有即 ⛔ 不再挂。
- 受管面与超 3,000 行 PR 区 ⛔ 不落,交席位;席位照 SKILL.md〈路径分叉〉①–④ 一笔交棒。
- 席位每轮照 `execution-duties.md` 四件套行复查全部已 PASS 受管 PR,各区转来的一并在内。
- 性能卡与 PR 的提速数字只引已过 L1 的 bench PR 读数;⛔ 不引估算或未过 L1 的本地测量。
- 席只裁路由(拆并延、归区);改可见行为或解读 ADR 照 SKILL.md〈升级与决策〉呈维护者。
- 仅呈维护者选项组过独立 `CONTRACT_REVIEW_TIER` 评审,多卡一批;席自裁 ⛔ 不起评审,自读码。
  均带 `Prior rulings read:` 行,开工前呈 ⛔ 不在施工中途;对维护者「应该用中文和我沟通」。
- 席信箱只收:待裁、待落地受管 PR、跨区冲突、阻塞、交接完成;安全照 `security-findings.md`。
- 线程约 150k 即在干净点轮换,⛔ 不在 L1/L2 中途;交接写 `/mnt/project-files/<席>/handover-<区>.md`。
- 省耗:dev 推前照 os-dev.md〈本地验证范围〉;跨线程只传指针;线程 effort high;⛔ 不减 dev。
- 每读一次用量,在座位贴评论记一行:用量 %、关卡数、合并 PR 数。

## 交接与换号

- 用量近 80% 即交接:停派任何级;在途推完,每条分支留 draft PR;余照 `seat-post-protocol.md` 清单。
- 交接与各区现状落座位贴评论:所有权、open PR、下一步、待批、坑;⛔ 不只留项目或记忆。
- 新旧账号重叠时座位贴写所有权切分:旧号持有的 PR 清单与新号可取集;新号只取后者。
