# 入队与落地细则

见 SKILL.md 〈入队与落地〉;本文是 ACCEPT 之后把 PR 送到 MERGED 的操作细则。

## A. 碰生成物的 PR:入队前先同步 + 整体重生成

- `merge=os-regen` 路径清单当场读 `grep os-regen .gitattributes`,那是唯一权威清单。
- ⛔ 不把该清单抄进派发令当常量;文档产物同在清单、同样会被吞。
- 四步序已机械化 `bash scripts/pm/os-regen-merge.sh`,步骤以脚本为权威;⛔ 禁 rebase 与 force-push。
- ⛔ 永不在 MERGE 状态下跑 `gen:schema`:锚点会静默倒退回旧分叉点且全部门禁放行。
- 重生成后断言所有兄弟单的条目都还在。
- 更硬的旁证是查上一单的实现体完好:`git grep` 带引号精确名对 `origin/main` 与实现文件。
- 锚点断言的正确措辞:断言 `pnpm --filter @objectstack/spec check:authorable-surface` 绿即可。
- `baseRev` 允许滞后,是一行提示不是错误;⛔ 禁为凑相等手改锚点。
- ⛔ 不得要求 `baseRev == merge-base`。

## B. 跟到 MERGED 为止;入队后的看护归车道 PM 落地窗口

- 车道 PM 的权责三件:验收(复核清单)、首次入队、确认 MERGED。
- 首次入队:ACCEPT 后挂 6–9 分钟 flip 定点,到点核门禁 job 结论。
- 绿即转 ready + 挂 auto-merge;未绿按阶梯重挂定点。
- CI success webhook 不可靠:⛔ 不坐等,也 ⛔ 不忙轮询;定点文本照定时器写法纪律。
- 确认 MERGED 要两个读数:每轮同时读队列分支与 `origin/main`。
- 契约复核 PASS 落地的 PR 到窗口时已 ready 且 auto-merge 在挂,见 `contract-review.md`。
- 窗口自身权责不变:跟到 MERGED、踢出处置、落地后对账。
- 转 ready 或挂 auto-merge 前先判受管面:`node scripts/pm/check-governed-merges.mjs --test` 加变更路径。
- 一条命中 ⇒ 整 PR 改走人工合并道:复核照写 + 留 draft + 向授权批准人请审 + 状态评论。
- ⛔ 不翻 ready、不入队;清标即落地同受此闸,漏判会被队列守卫在 merge group 里拒收。
- 再读 `mergeable_state`:`dirty` ⇒ 先 merge `origin/main` 再挂;生成物在面上按 A 的固定序。
- ready + 全绿 ≠ 已入队:队列从不主动拉 PR,入队是显式动作。
- 零 `enqueued` 事件按序查三条:① `mergeable_state` 是否 `dirty`。
- ② enable-auto-merge 调用根本没落地,重发与效果验证序列见 `platform-readings.md`。
- ③ PR 碰 `.github/workflows/**` 而 token 缺 workflows 权限。
- 确认 MERGED 的同一动作里给 `Part of` 卡收口,`Fixes` 卡代关但标也须摘。
- `Part of` 卡开着不摘 `pm:dispatched`,无在飞物的卡就永远算进 `label:pm:dispatched is:open`。
- 摘标换回 `pm:queue` 或按剩余物定级,加一条写清交付了什么、剩下归谁的评论。
- 摘标与 MERGED 确认是一个动作,⛔ 不拆到下轮巡检。
- 同刻读相关卡 `closed_by_pull_requests`,确认没有卡被正文闭合关键词误关。
- 每次合并后重拉一次车道盘点与预期状态对账,⛔ 不留给下轮巡检。
- 取 open 卡清单对照预期 diff:预期之外从 open 消失的,就是被闭合关键词静默误关的卡。
- 落地后再核一次落地判据本身:队列的合并同样走 os-regen,A 的静默吞并一样能发生。
- MERGED 不是终点:发版后义务见 `release-aftercare.md`。
- 落地窗口给关键 PR 挂 `subscribe_pr_activity`,会话型座位专用;Routine 座位维持轮询。
- ⛔ 不订阅 dev 交报告前的 PR;订阅是感知补充,⛔ 不替代 flip 定点。
- MERGED 或关闭即退订,同刻把 `mode:cloud` 派的会话 `archive_session`。
- 触发条件是卡终局且报告已收复核;⛔ 合并前不归档,误归档可 unarchive 但容器现场已失。
- 暂停或交接时把在挂订阅清点进座位贴,⛔ 不留孤儿订阅。
- main-red 约定①:p0 fix-forward 允许跳队,限 p0、机械、根因已核实的止血 PR。
- 也可按既有 governed 例外由维护者人工直合一行修复;仅限 main-red 修复。
- ⛔ 不放宽其它任何 PR 的 queue-only 落地。
- main-red 约定②:一个失败 check 只锚一张卡,先立者赢,后见者评论到锚卡,⛔ 不另立。

## C. 依赖前棒才能转绿的 PR:draft 停放 + 签名级预期红清单

- 这种 PR 停在 draft,正文写精确的预期红清单:逐条失败测试名 + 报错签名。
- 正文同写解除条件:点名所依赖的那张 PR 合入。
- 每个 CI-failure 事件与清单比对:签名匹配静默跳过,新签名才是真问题。
- 依赖合入后:最后一轮同步 → 红清零 → 转 ready → 入队。

## D. 串行接力:多个已实现 PR 全碰生成物时,一次只放行一个

- 每一棒都是一整圈:merge main + A 的四步 + 全套验证 + 兄弟单断言复核。
- 然后 PM 复核回报 → 转 ready → 挂 auto-merge 或入队;每棒都重走。
- auto-merge 由 PM 挂,dev 永不碰。
- 相邻两棒同碰一个文件时,交接的是语义不是文本。
- 前棒在回报里写明它对共享文件改动的性质:改名、提取变量、增补断言,还是纯追加。
- PM 原样转告下一棒,并要求两个 PR 的意图叠加,⛔ 禁止机械取一边。
- 两棒散文互锁时分工由 PM 指派,允许前棒留占位交接。
- PM 必须在两侧接力指令里写明谁动、谁不动。
