# 入队与落地细则(references —— 按需加载)

出处:主文件「复核」的入队与落地原则。本表是 ACCEPT 之后把 PR 送到 MERGED 的操作
细则,在落地窗口查阅;⛔ 不引用 issue 编号。

## A. 碰生成物的 PR:入队前先同步 + 整体重生成

批次选择只保证同批 file-disjoint,管不到先后两单都碰生成物(协议变更几乎必然)。
`merge=os-regen` 路径清单**当场读**:`grep os-regen .gitattributes`(唯一权威清
单,⛔ 不抄进派发令当常量 —— 散文没法被类型检查;文档产物同在清单、同样被吞)。
该驱动 merge exit 0、零冲突标记,却**静默丢掉一侧改动** —— 只有重新生成才暴露。

四步序已机械化:`bash scripts/pm/os-regen-merge.sh` —— ① `git merge origin/main`
(⛔ 禁 rebase / force-push);② 生成物 `git checkout origin/main -- <路径>`;③
**先 commit 掉 merge**;④ 整链重生成 + 生成物门禁全绿。顺序防两个陷阱:

- **MERGE 状态下跑 `gen:schema` 会把 authorable-surface 锚点静默倒退回旧分叉点**
  (HEAD 仍是合并前分支 tip),倒退后的锚点**依然 authentic**、全部门放行 ——「先
  commit 再重生成」的由来。
- **`gen:schema` 的清场会抹掉 `gen:openapi` 的产物**(rest 包成串 `expected 503
  to be 200` 假红);补跑 `pnpm --filter @objectstack/spec gen:openapi` 即复原。

重生成后**断言所有兄弟单的条目都还在**;更硬的旁证是查**上一单的实现体**完好(带
引号精确名 `git grep … origin/main -- <实现文件>`)—— 条目是索引,实现体才是被吞
的重灾区。**锚点断言的正确措辞**(写错会教唆 dev 手改锚点):断言 `pnpm --filter
@objectstack/spec check:authorable-surface` **绿**即可;`baseRev` 允许滞后(一行
提示,不是错误);⛔ 禁为凑「相等」手改锚点,⛔ 不得要求 `baseRev == merge-base`。

## B. 跟到 MERGED 为止;入队后的看护归车道 PM 落地窗口

车道 PM 的权责:验收(复核清单);**首次入队** —— ACCEPT 后挂 6–9 分钟 flip 定
点,到点核门禁 job 结论(承载门禁族的 job `completed: success`),绿即转 ready +
挂 auto-merge,未绿阶梯重挂;CI success webhook 不可靠,⛔ 不坐等不忙轮询;定点文
本照定时器写法纪律(幂等开头、只写判据);确认 **MERGED** —— 每轮同时读队列分支与
`origin/main` 两个读数。ready 与 auto-merge 顺序不可反(转回 draft 会同时掉
auto-merge 与队列成员资格)。

**转 ready / 挂 auto-merge 之前先读 `mergeable_state`**:`dirty` ⇒ 先 merge
`origin/main`(生成物在面上按 A 的固定序)再挂;`unknown` ⇒ 重读一次(惰性计算,
事实行见平台读数)。**ready + 全绿 ≠ 已入队 —— 队列从不主动拉 PR,入队是显式动
作。**零 `enqueued` 事件按序查:① `mergeable_state` 是否 `dirty`;②
enable-auto-merge 调用根本没落地(GraphQL、吃配额、回显两向不可靠,按既有陷阱行
重发一次,以 timeline 事件验证,⛔ 不看 `auto_merge` 字段);③ PR 碰
`.github/workflows/**` 而 token 缺 workflows 权限。

**确认 MERGED 的同一动作里给 `Part of` 卡收口**(`Fixes` 卡 GitHub 代关、标签随
卡离开在飞视图):`Part of` 卡开着不摘 `pm:dispatched`,就把无在飞物的卡永远算在
`label:pm:dispatched is:open` 里。摘标(换回 `pm:queue` 或按剩余物定级)+ 一条评
论(交付了什么、剩下归谁)与 MERGED 确认是一个动作,⛔ 不拆到下轮巡检;同刻读相关
卡 `closed_by_pull_requests`,确认没有卡被正文闭合关键词误关(事实见平台读数)。

**每次合并后重拉一次车道盘点,与预期状态对账** —— 也是落地动作的一步,⛔ 不留给下
轮巡检:取 open 卡清单,对照「应关哪些、不应关哪些」的预期 diff;预期之外从 open
消失的,就是被闭合关键词静默误关的卡。与上段互补不互替:`closed_by_pull_requests`
逐卡核对、要先知道读哪张;盘点对账不需要先验名单,实测抓住静默误关的正是这一步。
落地后**再核一次落地判据本身**:队列的合并同样走 os-regen 驱动,A 的静默吞并在队
列合并这一步一样能发生。

**落地窗口给关键 PR 挂 `subscribe_pr_activity`**(会话型座位专用;Routine 座位收
不到,维持轮询):⛔ 不订阅 dev 交报告前的 PR —— 双驾驶员互踩(云卡出生即订阅不越
界,报告在 draft PR 开出即到);订阅是感知补充,不替代 flip 定点;**MERGED / 关闭
即退订,同刻把 `mode:cloud` 派的会话 `archive_session`** —— 触发条件是卡终局且报
告已收复核,⛔ 合并前不归档(活会话是 dirty 自救的执行手;误归档可 unarchive,但
容器现场已失,宁晚勿早);暂停/交接把在挂订阅清点进座位贴,⛔ 不留孤儿订阅。

## C. 依赖前棒才能转绿的 PR:draft 停放 + 签名级预期红清单

串行链里后棒常常先行实现。这种 PR **停在 draft**,PR body 写两样:**精确的预期红
清单**(逐条失败测试名 + 报错签名 ——「几条测试会红」不够用)与**解除条件**(「依
赖 PR #N 合入」)。每个 CI-failure 事件与清单比对 —— 签名匹配静默跳过,**新签名才
是真问题**。依赖合入后:最后一轮同步 → 红清零 → 转 ready → 入队。

## D. 串行接力:多个已实现 PR 全碰生成物时,一次只放行一个

1. **每一棒都是一整圈**:merge main + A 的四步 + 全套验证 + 兄弟单断言复核 → PM
   复核回报 → 转 ready → 挂 auto-merge/入队;每棒都重走,不是整条链只走一次;
   auto-merge 由 PM 挂、dev 永不碰。
2. **相邻两棒同碰一个文件时,交接的是语义,不是文本**:前棒在回报里写明它对共享文
   件改动的**性质**(改名/提取变量/增补断言,而非纯追加),PM 原样转告下一棒,并
   要求「两个 PR 的意图**叠加**,⛔ 禁止机械取一边」—— 取一边会各自绿、合起来错。
3. **两棒散文互锁时,分工由 PM 指派**:允许前棒留占位交接;PM 必须在**两侧**接力
   指令写明谁动、谁不动 —— 否则两边都动(冲突)或都不动(过期散文),CI 上都绿。
