# 入队与落地细则(references —— 按需加载)

出处:主文件「复核」的入队与落地原则。本表是 ACCEPT 之后把 PR 送到 MERGED 的操作
细则,在落地窗口查阅;⛔ 不引用 issue 编号。

## A. 碰生成物的 PR:入队前先同步 + 整体重生成

批次选择只保证同批 file-disjoint,管不到先后两单都碰生成物 —— 协议变更几乎必然如
此。被路由到 `merge=os-regen` 的路径清单**当场读**:`grep os-regen .gitattributes`
(唯一权威清单,⛔ 不抄进派发令当常量 —— 散文没法被类型检查,唯一不会烂的拷贝是不
存在的那份;清单里同时有文档产物,同样会被静默吞)。该驱动会 merge exit 0、零冲突
标记,却**静默丢掉一侧的改动** —— 只有重新生成才暴露。

四步序已机械化:`bash scripts/pm/os-regen-merge.sh` —— ① `git merge origin/main`
(⛔ 禁 rebase / force-push);② 生成物 `git checkout origin/main -- <路径>`;③
**先 commit 掉 merge**;④ 整链重生成 + 生成物门禁全绿。顺序防两个陷阱:

- **MERGE 状态下跑 `gen:schema` 会把 authorable-surface 锚点静默倒退回旧分叉点**
  (HEAD 仍是合并前分支 tip),倒退后的锚点**依然 authentic**、全部门放行,一次已
  合并的锚点推进被静默撤销 —— 这就是「先 commit 再重生成」的由来。
- **`gen:schema` 的清场会顺手抹掉 `gen:openapi` 的产物**,表现为 rest 包一串
  `expected 503 to be 200` 假红;补跑 `pnpm --filter @objectstack/spec
  gen:openapi` 即复原。

重生成后**断言所有兄弟单的条目都还在**;更硬的旁证是查**上一单的实现体**完好(带
引号精确名 `git grep … origin/main -- <实现文件>`)—— 条目是索引,实现体才是被吞
的重灾区。**锚点断言的正确措辞**(写错会教唆 dev 手改锚点):断言
`pnpm --filter @objectstack/spec check:authorable-surface` **绿**即可;`baseRev`
允许滞后,滞后只打一行提示不是错误;⛔ 禁止为凑「相等」手改锚点文件,⛔ 不得要求
`baseRev == merge-base` —— 那个等式不是任何门的判据。

## B. 跟到 MERGED 为止;入队后的看护归队列管家

车道 PM 的权责:验收(复核清单);**首次入队** —— ACCEPT 后挂 6–9 分钟 flip 定
点,到点核门禁 job 结论(承载门禁族的 job `completed: success`),绿即转 ready +
挂 auto-merge,未绿阶梯重挂;CI success webhook 不可靠,⛔ 不坐等 webhook、不忙轮
询;定点文本照定时器写法纪律(幂等开头、只写判据 —— 窗口内 PR 可能已被他手处置);
确认 **MERGED** —— 每轮同时读队列分支与 `origin/main` 两个读数。ready 与
auto-merge 的顺序不可反(转回 draft 会同时掉 auto-merge 与队列成员资格)。

**确认 MERGED 的同一动作里给 `Part of` 卡收口**:`Fixes` 卡 GitHub 代关、标签随卡
离开在飞视图;`Part of` 卡仍开着,`pm:dispatched` 不摘就把一张无 dev、无分支、无在
飞物的卡永远算在 `label:pm:dispatched is:open` 里。摘标(换回 `pm:queue` 或按剩余
物定级)+ 一条评论(已交付什么、还剩什么、剩下的归谁)与 MERGED 确认是一个动作,
⛔ 不拆成「下轮巡检再摘」。同刻顺手读一次相关卡的 `closed_by_pull_requests`,确认没
有别的卡被正文里的闭合关键词误关(事实表见平台读数)。

**每次合并后重拉一次车道盘点,与预期状态对账** —— 也是落地动作的一步,⛔ 不留给下
轮巡检:取 open 卡清单,对照「本次合并应关哪些、不应关哪些」的预期 diff 一遍;预期
之外从 open 消失的卡,就是被 PR 正文闭合关键词静默误关的卡(`completed` 状态对一切
只看 open 的过滤与巡检隐身,不主动 diff 永远看不见)。与上一段互补而不互替:
`closed_by_pull_requests` 是逐卡核对、要先知道读哪张;盘点对账不需要先验名单,实测
里抓住静默误关的正是这一步。

**落地窗口给关键 PR 挂 `subscribe_pr_activity`**(会话型座位专用;Routine 座位每
fire 新会话收不到,维持轮询):

- ⛔ 不订阅 dev 交报告前的 PR —— 报告前是 dev 的领地,双驾驶员互踩;云卡出生即订阅
  不越此界,因为其报告在 draft PR 开出即刻到达;
- 订阅是感知补充,不替代 flip 定点;
- **MERGED / 关闭即退订,同刻把 `mode:cloud` 派出的会话 `archive_session`** —— 触
  发条件是卡的终局且报告已收复核;⛔ PR 合并前不归档(活会话是 dirty 自救的执行
  手;误归档可 unarchive,但容器现场已失,宁晚勿早);
- 暂停/交接时清点在挂订阅写进座位贴,⛔ 不留孤儿订阅。

落地之后**再核一次落地判据本身**仍是车道 PM 的活 —— 队列的合并同样走 os-regen 驱
动,A 的静默吞并在队列合并这一步一样能发生。

## C. 依赖前棒才能转绿的 PR:draft 停放 + 签名级预期红清单

串行链里后棒常常先行实现。这种 PR **停在 draft**,PR body 写两样:**精确的预期红
清单**(逐条失败测试名 + 报错签名 ——「几条测试会红」不够用)与**解除条件**(「依
赖 PR #N 合入」)。每个 CI-failure 事件与清单比对 —— 签名匹配静默跳过,**新签名才
是真问题**。依赖合入后:最后一轮同步 → 红清零 → 转 ready → 入队。

## D. 串行接力:多个已实现 PR 全碰生成物时,一次只放行一个

1. **每一棒都是一整圈**:merge main + A 的四步 + 全套验证 + 兄弟单断言复核 → PM 复
   核回报 → 转 ready → 挂 auto-merge/入队;每棒都重走,不是整条链只走一次;
   auto-merge 由 PM 挂、dev 永不碰。
2. **相邻两棒同碰一个文件时,交接的是语义,不是文本**:前棒在回报里写明它对共享文
   件改动的**性质**(改名/提取变量/增补断言,而非纯追加),PM 原样转告下一棒,并要
   求「两个 PR 的意图**叠加**,⛔ 禁止机械取一边」—— 取一边会各自绿、合起来错。
3. **两棒散文互锁时,分工由 PM 指派**:允许前棒给后棒留占位交接;PM 必须在**两侧**
   的接力指令里写明谁动、谁不动 —— 否则要么两边都动(冲突),要么两边都不动(过期
   散文),两种结果在 CI 上都是绿的。
