# 入队与落地细则

执行席在落地窗口(ACCEPT 之后至 MERGED)读本文;入队与落地条款与 A–D 操作细则都在此。

## 入队与落地

- 条款②入队闸门:翻 ready / 入队前先取 PR 实际 diff;diff 是事实,卡片语义是预测。
- `--tier` 嫌疑行是提示非裁定;双肢命中任一 ⇒ 无达档条款②复核 PASS 在案 ⛔ 禁止入队。
- 路径肢 = diff 触及契约面 `packages/spec/src/**` 非测试,含 error-code-ledger、`*.zod.ts` 契约 schema。
- 声明肢 = 认领评论声明 `Clause-②: yes`,与路径无关;错误的 `no` 是可审计的假申报。
- 子代理起不来 ⇒ 复核缺席,PR 带 `needs:contract-review` 留 draft 队列外;旁路仅维护者逐次亲审
- PASS ⇒ Tier S ready、auto-merge;Tier H 经 SKILL.md ③ 交棒;FAIL ⇒ 撤挂,补丁轮;⛔ 免复核不放行。
- 落地后才见欠复核 ⇒ 按 `contract-review.md` 复审落地 head、发现立新卡,⛔ 不修已关 PR。
- DELIBERATE CORRECTION 红(`check-empty-changeset`)⛔ 不等维护者;确认件皆须点名每个被改 note:
- diff 只改 release 文字或注释者:派发席 ACCEPT 确认,逐句引改前与改后,免第二次同 head 复核。
- 其余(含改代码)照全套:同 head 达档复核 PASS 记录即确认,记录逐句判改写句。
- 两类缺一不算;算即按 SKILL.md 三条件带红入队,门禁不改。
- 真正设计分叉照旧进决策箱,席内复核 ⛔ 不替代维护者裁定;外部评审链只作事后审计。
- 默认分支 push 即触发对外部署的仓,只在验证层存在时才合并;无验证层 ⛔ 不合并。
- 验证层 = 部署以 CI 为闸、发布后探测线上面、失败自动回滚并立卡。
- 该类仓的落地判据是已发布且探测通过,⛔ 不是 MERGED;跟到发布为止。
- 合并后工作流不在 PR 检查清单上,读 PR 检查的规则对它全盲;按独立检查类登记分开读。
- 人闸不是验证层的替代:答不了会不会坏的人闸只买延迟,⛔ 不以人闸代替探测。
- 落地记账:座位贴落地清单即账本,逐轮即时记;确需全仓核对时首选 `head:claude/` 精确过滤。
- 红/踢出处置在同一落地窗口内做:机器输入是 merge-queue triage workflow 的分诊评论。
- 判据唯一来源是签名台账(锚点 issue),优先于现场判断;只有人工能升级台账。
- 疑似新 flaky 只留提请,⛔ 不自行加表;纯计数不追记,只有改变修法作用域时才记。
- 四分支:已知 flaky ⇒ 原样重投;已修签名再现 ⇒ ⛔ 不重投,判新问题重新诊断。
- 基上缺已合修复 ⇒ merge main 推新提交,重跑无效。
- 新签名 ⇒ ⛔ 不重投,PR 与其 `Fixes` 卡各留完整签名与初判;下条三事实全立可重投一次。
- 三事实:失败文件 import 闭包与 diff 不相交、队列基座同 shard 绿、首错是超时非断言。
- 每次处置留审计评论,重投写签名与台账依据或三行回执;同签名再弹即停,交下一席重诊。

## A. 碰生成物的 PR:入队前先同步 + 整体重生成

- `merge=os-regen` 路径清单当场读 `grep os-regen .gitattributes`,那是唯一权威清单。
- ⛔ 不把该清单抄进派发令当常量;文档产物同在清单、同样会被吞。
- 四步序已机械化 `bash scripts/pm/os-regen-merge.sh`,步骤以脚本为权威;⛔ 禁 rebase 与 force-push。
- ⛔ 永不在 MERGE 状态下跑 `gen:schema`:锚点会静默倒退回旧分叉点且全部门禁放行。
- 重生成后断言所有兄弟单的条目都还在。
- 更硬的旁证是查上一单的实现体完好:`git grep` 带引号精确名对 `origin/main` 与实现文件。
- 锚点断言的正确措辞:断言 `pnpm --filter @objectstack/spec check:authorable-surface` 绿即可。
- `baseRev` 允许滞后,是一行提示不是错误;⛔ 禁为凑相等手改锚点。

## B. 跟到 MERGED 为止;入队后的看护归车道 PM 落地窗口

- 车道 PM 的权责三件:验收(复核清单)、首次入队、确认 MERGED;落地执行在案判决,非自批。
- 首次入队:ACCEPT 后挂 6–9 分钟 flip 定点,到点核门禁 job 结论。
- 绿即经中继 op `pr_ready` + `automerge_enable` 落地,拼写见 `rest-channel.md`;未绿按阶梯重挂定点。
- 写节流拒(exit 10) ⇒ 待 `node scripts/pm/write-pace.mjs --status` 现空槽再重试。
- CI success webhook 不可靠:⛔ 不坐等,也 ⛔ 不忙轮询;定点文本照定时器写法纪律。
- undraft 撞 429 ⇒ 落地入等 `resets at` 态:该刻记卡,到点一次重试;⛔ 不报阻塞、不自定节奏。
- 落地遭分类器拒 ⇒ 停手、报维护者、卡上记命令与拒因;⛔ 不换拼法、不退回 ccr 绕过。
- 落地评论 = 两个读数的探针表 + 一行状态变更(摘标/关卡/收口),⛔ 不复述 `## 席位核对`。
- 转 ready/入队前跑 `check-governed-merges.mjs --pr N`:受管面照两层;>3000 行(含生成物)照 Tier H。
- ⛔ 两层不由席位批准;清标即落地同受此闸,漏判会被队列守卫在 merge group 里拒收。
- 再读 `mergeable_state`:`dirty` ⇒ 先 merge `origin/main` 再挂;生成物在面上按 A 的固定序。
- 挂 auto-merge 的同一动作里重测生成物漂移,⛔ 不复用更早的零;非零 ⇒ 按 A 的固定序。
- ready + 全绿 ≠ 已入队:队列从不主动拉 PR,入队是显式动作。
- 零 `enqueued` 事件按序查三条:① `mergeable_state` 是否 `dirty`。
- ② enable-auto-merge 调用根本没落地,重发与效果验证序列见 `platform-readings.md`。
- ③ PR 碰 `.github/workflows/**`:令牌常驻 `workflows: write`(裁决评论 6104822731),仍拒即授权漂移。
- 确认 MERGED 同一动作里给 `Part of` 卡收口、`Fixes` 卡代关但标也须摘,⛔ 不拆到下轮巡检。
- `Part of` 卡开着不摘 `pm:dispatched`,无在飞物的卡就永远算进 `label:pm:dispatched is:open`。
- 摘标换回 `pm:queue` 或按剩余物定级,加一条写清交付了什么、剩下归谁的评论。
- 同刻读相关卡 `closed_by_pull_requests`,确认没有卡被正文闭合关键词误关。
- 每次合并后重拉一次车道盘点与预期状态对账,⛔ 不留给下轮巡检。
- 取 open 卡清单对照预期 diff:预期之外从 open 消失的,就是被闭合关键词静默误关的卡。
- 落地后再核一次落地判据本身:队列的合并同样走 os-regen,A 的静默吞并一样能发生。
- MERGED 不是终点:发版后义务见 `release-aftercare.md`。
- PR 开出至 MERGED,每看一眼(唤醒/巡检/报告前)同读检查与 `mergeable_state`;`unknown` 即重读。
- `dirty` ⇒ 当即合 `origin/main` 推新提交,⛔ 不等冲突通知;未见非 `dirty` ⛔ 不报无需你做。
- MERGED 或关闭即退订,同刻把 `mode:cloud` 派的会话 `archive_session`。
- 触发条件是卡终局且报告已收复核;⛔ 合并前不归档,误归档可 unarchive 但容器现场已失。
- 暂停或交接时把在挂订阅清点进座位贴,⛔ 不留孤儿订阅。
- main-red 约定①:见主干/队列全量红的席位先找锚卡,无则立 p0 锚卡(门类 ①),域随失败面。
- 认领并派止血,⛔ 不等分诊首触、不等维护者;首触事后补,可改域、⛔ 不改动作。
- 首道止血 = 回退引入红的提交(主干末绿与首红之间找),根因另立卡。
- p0 fix-forward 止血跳队,限机械、根因已核实;维护者可按 governed 例外人工直合一行修复。
- 止血非机械 ⇒ 锚卡点名归属车道、敲其信箱 `Request: main-red`;根因卡恒归该车道。
- main-red 约定②:一个失败 check 只锚一张卡,先立者赢,后见者评论到锚卡,⛔ 不另立。
- 约定③:锚卡一轮分诊(~60 分钟)无人认领 ⇒ 分诊与总监当轮轮报点名卡与归属车道。
- 再一轮无人认领 ⇒ 分诊贴标准认领行、派一个 os-dev 只做止血;每轮一张,分诊不成车道。
- 止血 PR 复核归车道席或总监,⛔ 非分诊;Tier H 仍等审批人;车道席到场经认领行交回。

## C. 依赖前棒才能转绿的 PR:draft 停放 + 签名级预期红清单

- 这种 PR 停在 draft,正文写精确的预期红清单:逐条失败测试名 + 报错签名。
- 正文同写解除条件:点名所依赖的那张 PR 合入。
- 每个 CI-failure 事件与清单比对:签名匹配静默跳过,新签名才是真问题。
- 依赖合入后:末轮同步走中继 `pr_update_branch`(`rest-channel.md`)→ 红清零 → 转 ready → 入队。

## D. 串行接力:多个已实现 PR 全碰生成物时,一次只放行一个

- 每一棒都是一整圈:merge main + A 的四步 + 全套验证 + 兄弟单断言复核。
- 然后 PM 复核回报 → 转 ready → 挂 auto-merge 或入队;每棒都重走。
- 相邻两棒同碰一个文件时,交接的是语义不是文本。
- 前棒在回报里写明它对共享文件改动的性质:改名、提取变量、增补断言,还是纯追加。
- PM 原样转告下一棒,并要求两个 PR 的意图叠加,⛔ 禁止机械取一边。
- 两棒散文互锁时分工由 PM 指派,允许前棒留占位交接。
- PM 必须在两侧接力指令里写明谁动、谁不动。
