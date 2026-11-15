# 区域租约模式(area-lease)

任一车道席坐席、交接或换班时读本文;只写本模式特有的,余处已有者只点名 ⛔ 不抄。
本模式 = 一席 + 按需分区 + 复核席 + 区域 PASS 后自落地;席留 W0、路由、受管面与台账。

## 分不分区,动态定

- 坐席、每次交接或换班时席位重判三件:分不分、分几区、边界;⛔ 不沿用上一班的表。
- 分区阈值(经验):可认领 p1/p2 ≥15 张且跨 ≥3 个互不相干的模块簇;不足即照常按卡认领。
- 边界按卡触及的文件与包聚类,让两区极少改同一函数;⛔ 不按卡标题或词汇分。
- 排空的区并入邻区,积压即再拆(「比如增加分区」),⛔ 不抬每区 dev 数;拆并即改租约表。
- 租约表(区→路径→线程会话→复核席)住座位贴,任一列变或线程轮换即重写,为唯一记录。
- 复核席约每 3 活跃区一席,由他账号坐(`lanes/review.md`);同账号坐须维护者本线程亲字。
- 队列值守只照 `lanes/queue.md`(含其无席时的兜底),⛔ 不在此另派。

## 开席

1. 席位会话坐席:座位贴存根、自有信箱(`project-forms.md`)、租约表。
   - 信箱一步恒不省:「不按旧规」也不豁免;重坐、换号或移座恒开新信箱。
2. 每区一条项目线程,由协调者开(`coordinator.md`);复核线程照上节复核行。
3. 维护者在每条新线程亲写一句授权行:auto mode 只认本线程维护者原话,转述与点选不算。
   - 区线程:「本区通过复审的 PR 都可以 ready + auto-merge」
   - 席线程:「审批人批准后的 Tier H PR 你可以自主落地」
   - 授权行只解 auto mode 的拦截,⛔ 不改 AGENTS.md 第 14 条的落地档。
4. W0:各区首小时交席位一份关/并/改级/呈裁清单,同时即开首张 p1。
   - 清单经维护者过目后落笔:定级照 SKILL.md 域车道(自分诊例外住 `triage-duties.md`)。
   - 关卡照 `execution-duties.md`:⛔ 不凭本区读数自关。

## 区内规则

- 区会话署本席签名,`Session:` 填区会话 ID;开轮互斥读法照 `seat-lifecycle.md`。
- 认领前重读标签、assignee 与末条评论:他人 assignee、他人 `Claim:` 或他区 `lease:*` ⇒ 不碰。
- 认领前三查必过,各写认领评论一行;任一不过 ⇒ 不认领、不派 dev,当即交席位作决策:
  - `Pre-claim lane:` 修复所改路径属哪条车道,点名依据路径(碰他道路径照下文留道行)。
  - `Pre-claim deps:` 卡点名的 `Blocked-by:`、「after #N」与热文件,逐个已合或空闲。
  - `Prior rulings read:` 照 `decision-analysis.md`;grep `docs/adr/**`、链卡(⛔ 行在内)与反向 pin
    测试;记录冲突,或路线改门的可见行为超出本卡裁决,同作不过。
- 认领照 `execution-duties.md` 派发原子对,同笔加 `lease:<区>`;`Branch:` 照 AGENTS.md 命名。
- 认领后回读标签(SKILL.md 标签写四步):缺 `lease:` 或 `pm:dispatched` 即重挂;首推即开 draft PR。
- 写码与开发期读码全经 `os-dev` 等子代理(一卡或一组耦合卡,文件面不相交)。
- dev 开 PR 前自查申报:os-dev.md〈Definition of done〉,BREAKING/ADR-0087 照 AGENTS.md Post-Task 第 3 条。
- 席线程只协调,⛔ 不读 diff 与日志;ACCEPT 欠的自读(`contract-review.md`、〈路径分叉〉)除外。
- 每区恒 4 dev 在开发:裁定例外,超默认 `batch` 3 而在天花板内;额度墙照 `execution-duties.md`。
- 席每轮逐区查;先落建成 PR,空槽补 p3,新 p1/p2 先占;p3 ⛔ 改 p1/p2 在改或将改的热文件。
- 同函数互相牵连的卡合一 PR,准入照 `execution-duties.md` 折叠五门。
- 留道:修法已清的卡碰 `ui/**`、`packages/spec/**` 仍在本道开发、本席复审;他道席在线只通知
  「如果车道有人在线，只需要通知他就可以。」本条先于条款②行(`execution-duties.md`)、
  移道的 `lanes/spec.md` 与 `--tier` 提示;交出闭集:他道在线席已认领、cloud 路由、安全、ADR。
- 送审:欠不欠、档、谁跑只照 `contract-review.md`;四面皆不碰 ⇒ ⛔ 不送复核、不起 agent。
- 落地:区先读 `check-governed-merges.mjs --pr N`;非受管 PR 区照 `landing-operations.md` 自己落地。
- PASS 且全绿的非受管 PR 10 分钟内落地;挂前先查 PR 上已有落地评论,有即 ⛔ 不再挂。
- 受管面与超 3,000 行 PR 区 ⛔ 不落,交席位;席位照 SKILL.md〈路径分叉〉①–④ 一笔交棒。
- 席位每轮照 `execution-duties.md` 四件套行复查全部已 PASS 受管 PR,各区转来的一并在内。
- 插队照 `landing-operations.md` 三因;⛔ 本文不改队列配置。
- 性能卡与 PR 的提速数字只引已复审的 bench PR 读数;⛔ 不引估算或未复审的本地测量。
- 席只裁路由(拆并延、归区);改可见行为或解读 ADR 照 SKILL.md〈升级与决策〉呈维护者。
- 仅呈维护者选项组过独立 `CONTRACT_REVIEW_TIER` 评审,多卡一批;席自裁 ⛔ 不起评审,自读码。
  均带 `Prior rulings read:` 行,开工前呈 ⛔ 不在施工中途;对维护者「应该用中文和我沟通」。
- 席信箱只收:待裁、待落地受管 PR、跨区冲突、阻塞、交接完成;安全照 `security-findings.md`。
- 线程到约 150k 上下文即在干净点轮换,⛔ 不在复审中途;交接照下节落 GitHub。
- 每读一次用量,在座位贴评论记一行:用量 %、关卡数、合并 PR 数。

## 交接与换号

- 用量近 80% 即交接:停派任何级;在途推完,每条分支留 draft PR;余照 `seat-post-protocol.md` 清单。
- 交接与各区现状落座位贴评论:所有权、open PR、下一步、待批、坑;⛔ 不只留项目或记忆。
- 新旧账号重叠时座位贴写所有权切分:旧号持有的 PR 清单与新号可取集;新号只取后者。
- 旧号移座照 `seat-lifecycle.md` 移座行。
