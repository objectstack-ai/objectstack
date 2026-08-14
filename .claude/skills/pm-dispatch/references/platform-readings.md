# 平台读数事实表(references —— 按需加载)

出处:主文件「平台读数纪律」。本表是 GitHub API / 工具行为的**实测事实**,在做对应
操作的那一刻查阅;原则(判据取命令输出、零命中反查、定时器文本纪律等)住在主文
件。⛔ 本表不引用 issue 编号 —— 每条自含失效模式与边界。

## 队列成员资格与 auto-merge

- 判「在不在合并队列」看 timeline 事件 `added_to_merge_queue`(REST
  `GET /repos/{owner}/{repo}/issues/{pr}/timeline`),⛔ 不看 `auto_merge` 字段 ——
  入队后它回落为 off,零信息量(维护者 2026-08-11 裁定)。队列分支读法
  (`git ls-remote --heads origin 'refs/heads/gh-readonly-queue/*'`)正命中仍是
  「已入队」的充分证据,反向推断作废 —— 队列满载时 PR 已入队而分支尚未建出。
- **成功序列读间隔不读事件名**:`removed_from_merge_queue` 后 ~1 秒内跟着
  `merged` 是落地,不是被踢;真被踢的形状是其后没有 `merged`、几分钟后 PR 仍
  open。
- 「判据不在 `origin/main` 上」是二义读数 —— 同时兼容「在队列里等」与「压根没入
  队」,两者处置相反。落地检查永远两个读数:**队列成员资格 和 `origin/main`**,缺
  一不可。
- **PR 转回 draft 会同时掉 auto-merge 与队列成员资格,且不自动恢复**;转正后必须
  重新挂。反方向同理:要真踢出队列,只有转 draft —— `disable_pr_auto_merge` 单独
  调用**不解除队列成员资格**,PR 照样落地。
- **`enable_pr_auto_merge` 一律显式传 `mergeMethod: "SQUASH"`**:不传时静默退回
  被禁的 merge-commit 方式 —— 等于无操作。但**回显在两个方向都不可靠**:实测队列
  路径上回显为空(`method: `)而 timeline 的入队事件照发、PR 照落地;也实测显式
  传 SQUASH 后回显 `MERGE`(参数被治理 `main` 的合并队列侧改写,落地历史仍是每
  PR 一提交)。⇒ 权威信号只有队列成员资格的 timeline 事件与最终 MERGED 状态,
  ⛔ 不拿回显当任何方向的证据,也不读 `auto_merge` 字段。
- `enable_pr_auto_merge` 的空字段返回(`method: , enabled at `)对「入没入队」零区
  分度,签名本身不构成任何方向的证据。序列:① 先验队列分支(给条目 ~20–30s 建
  出);② 分支在 ⇒ 结束,⛔ 不翻转;③ 等待后仍缺席**且队列已见 churn**(更新的条
  目建出了分支而你的没有 —— 截断下单纯缺席不充分)⇒ 翻转一次(`disable` →
  `enable`),翻转后仍以 timeline 事件验证;④ ⛔ enable 与它的队列验证之间永不插
  `disable` ——「入队」webhook 可能乱序迟到,armed 窗口里补的 disable 会把已发生的
  真实入队撤掉。
- **队列踢出先认签名再决定重投**:已知 flaky 核对失败签名一致 ⇒ 原样重投;但止血
  修复合入后**同一签名再现就不再是那条 flaky**,是新问题,必须重新诊断,⛔ 禁止条
  件反射式重投。第三种签名:本 PR 名下**没有任何** `merge_group` run 且批次同伴的
  run 全部 `success` = 队列重建的连带取消,不是红 —— 带签名读数收据重投一次(收据
  留在 PR 上),⛔ 无收据不重投;同一 PR 第二次被踢移交队列管家。
- **实测吞吐参数两则**:合并队列落地延迟 ≈ 每 PR 15–30 分钟且串行 —— 多 PR 在队
  时按此估算落地窗口,⛔ 不据「还没落」提前判异常;单容器重验证(build+test)并
  发甜点 ≈3 —— 排批时按它定同容器重验证卡的并发上限,再高互相争用、再低闲置。

## API 配额

- GraphQL 配额(5000/时)极易打满,读与评论一律走 REST(core 15000/时,独立
  计);只有无 REST 对应物的写才花 GraphQL。`issue_write` 连查找半边都吃
  GraphQL —— 配额红时认领类动作整体排队,评论(REST)先行把结论发出去。
- 配额打满:待执行写操作**排成有序清单挂进巡逻词**(不靠记忆),轮询
  `gh api rate_limit` 的对应资源,恢复窗口按序连清(ready → auto-merge → 入队可
  一气完成);重试对齐整点(REST core 整点重置)优于指数退避,⛔ 绝不忙轮询。
  search 与 core 是独立配额,一侧打满另一侧可作退路;REST core 在共享身份下同样
  会打满 ——「走 REST」≠「不限量」。
- **MCP 参数两陷阱**:`list_issues` 多标签过滤是 **OR** 不是 AND(要 AND 走 REST
  search 的 `label:a label:b`,或本地求交);`issue_write` 的 `labels` 是**整组替
  换**不是追加 —— 不先读现值合并再写,会静默剥掉别的标签(状态机丢位);真追加走
  REST `POST /issues/{n}/labels`;写后照标签纪律回读。
- **`list_issues` 永不返回 assignees**(`fields` 枚举无此成员;不传 `fields` 响应
  里同样没有)—— 已认领卡与空闲卡在响应里逐字节相同,车道清单因此**回答不了**
  「哪张能认领」这个它被用来回答的问题,失效完全静默、长得就像成功。清单只是
  **候选名单**:每一条在认领前都必须过一次完整 `issue_read`(它才返回
  `assignees`),⛔ 不把 `list_issues` 结果当候选集直接认领。
- **MCP `issue_read` 的 body 是 HTML 实体转义过的**(撇号/引号/尖括号成实体),而
  comments 原样返回。⇒ MCP 座位做 body 往返(读 → 改 → `issue_write` 整体写回)不
  安全:写回的是转义实体,或凭猜反转义 —— 长正文围栏里的箭头等显示编码不可靠逆
  转,且同一套工具里无从对账真原文。机器可 grep 的行(`Blocked-by:` 一类)可能因
  此落在评论首行而非 body —— 解锁扫描必须连评论一起扫(`in:comments`);确要改写
  body,先经 REST 取原始 body 对账再写。

## 读数陷阱

- **读数四坑**:`cd X && cmd` 会短路(路径不存在时命令在当前仓继续执行,产出假读
  数)—— 跨仓一律 `git -C <path>`;`git grep -c <pat> | wc -l` 数的是文件数不是命
  中数;裸名 grep 被幸存家族当子串命中 —— 退役核验带引号精确名,更硬的判据是查声
  明式(`^(export )?(const|type|interface) <Name>\b`)而不是查提及;浅检出上的历
  史读数不可信(`merge-base --is-ancestor` 假「非祖先」、`rev-list --count` 截
  断、`branch -r --contains` 零输出)—— 先 `--deepen` 再判,或走 REST `compare`。
- `rerun_failed_jobs` 复用原 run 的提交与合并 ref,不拿新 main 重算 —— 红因是基上
  缺一个已合修复时重跑无效,只能推提交(`git merge origin/main`);判别:修复的合
  并时间晚于 run 创建时间即是。
- **同一 head 上轻量兄弟 workflow `success` + 重量级载体 `cancelled`,是普通取代
  的预期签名,不是选择性失败**:兄弟 run 秒级跑完,载体要 10–15 分钟,新推送的
  cancel-in-progress 窗口只罩得住后者。见到它先比对 run 的 `head_sha` 与 PR 当前
  head(取代必有新 head),而不是开「为什么只取消了它」的调查。
- **CI 红了先取完整日志归档再下结论**:「completeness check 绿」只断言没有
  worker 静默死,≠ 测试通过;并发输出的「相邻」≠「因果」(先查 `turbo.json` 依赖
  边);⛔ 不只看 tail。公开发出的诊断被推翻时,更正发在同样公开的位置,据它开的
  PR 撤回 draft、解绑 `Fixes`。
- **判「正文被截断」必须双读取**:`.body` 原文 + `Accept:
  application/vnd.github.full+json` 的 `.body_html`,两者在同一处断掉才算 issue 端
  截断;任何单一读法的尾部缺失先算读取端截断(工具输出上限、分页、切片)。写侧另
  一半:sanitizer 会在**写入时就地删除**短 `<…>` 片段(HTML 注释标记、`<n>` 类占
  位符、泛型),反引号与围栏**不提供保护**,正文其余完好、双读取一致读作「完整」
  —— 要保留字面尖括号一律写 HTML 实体 `&lt;` / `&gt;`;含这类片段的正文,写后回读
  逐个确认仍在(失效完全静默)。
- **并行 spec PR 同动 pin 计数断言**(被踢不是事故,按 os-regen 序再解一轮):解
  冲突两侧收据都保留、按合并顺序堆叠,新计数**从合并后源码重数**(the file, not
  the history, is the operand),⛔ 不从两侧收据做算术;双方占同一编号是常态(各取
  当时 max+1),重编号后进侧。
- **容器重启杀死在飞 dev,现场三态判读**:① 分支已推 + PR 已开 ⇒ 只欠验收(CI 重
  跑 + 复核,不动代码);② 死在 regen 中途(未提交的全是生成物、merge commit 已
  在)⇒ PM 直接续作 —— build → 整链 regen → 生成物门禁全绿 → 提交推送,恢复
  commit 带 `Recovery commit:` 前缀留审计;⚠️ 有的现场 regen 一件没跑,推送前先跑
  生成物门禁别赌;③ 死在源码编辑中途 ⇒ 先读 diff 判完整性 —— docblock 把动机/失效
  模式/判据写全的,PM 可代跑其终验后提交;写了一半意图不明的 ⛔ 不代提交,记进交
  接。dev 的临时目录(`.os-scratch/` 一类)是工作物不是交付物,清掉,⛔ 不进
  feature PR。

## 闭合关键词解析(PR 正文写侧)

- **PR 正文里「不修某卡」的否定句会关掉那张卡**:GitHub 的闭合关键词解析器匹配
  `fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved` + `#N`,**不理会前
  面的否定词** ——「nothing here fixes #N」在合并时照关 #N,而写这句话的动机恰恰是声
  明不修;好实践(读了兄弟卡、显式划界)反而制造了失效。安全写法:把号码放在没有关
  键词打头的位置 —— `#N is not addressed here` / `out of scope: #N` /
  `#N remains open`。实测的解析边界三条:关键词只绑**同一行**的 `#N`;动名词
  (closing/fixing)不是关键词,散文里出现不触发;行内反引号里的关键词不触发
  (code span 实测不建闭合链接;围栏块未独立实测,按同规则对待但留待复测)。
- **PR body 与 squash commit message 是两个独立解析源**:commit message 只有
  `Fixes` 首行、看起来干净,不代表 body 干净 —— 只查 commit 会漏。误关的卡以
  `completed` 状态对一切「只看 open」的过滤与巡检隐身,没有任何机械守卫覆盖这条路
  径(duplicate-fix-guard 比的是两个 PR 抢同一张卡,这是一个 PR 多关了一张没人抢的
  卡);消费侧检查 = 合并后读 `closed_by_pull_requests`(在复核清单)。

## 断粮检测与跨墙恢复细则(5 小时用量墙)

- **检测**:`npx ccusage blocks` 在容器内可用(读本地会话记录),两个有用读数 ——
  当前 5 小时窗口的边界/剩余时间,与燃烧率(预警)。三个盲区连着读:单容器视野(云
  卡在自己容器里烧同一账号的额度,这里看不见);估的是成本不是套餐余量(没有任何面
  向 agent 的接口暴露账号级剩余额度);窗口起点是本地推断的近似值。**权威的墙信号是
  失败本身**:撞墙时 API 调用失败、宿主报「limit reached, resets at HH:MM」—— 重置
  时刻通常在撞墙那一刻可得,只是事前查不到;把它记下来。
- **定时器选型**:拿到重置时刻 ⇒ 一发定点(reset + 缓冲)优先,一枪精确胜过逐小时轮
  询;没有重置时刻 ⇒ 挂每小时 cron Routine(`create_trigger`,cron 型),⛔ 不用
  send_later 链 —— send_later 是一次性触发器,fire 后自灭(平台文档:run-once,
  fire 后自禁用),投进死窗口的那一发是否会被平台重试**未实测且文档未承诺**,按保守
  设计,一次性链条可能在断粮窗口内烧掉唯一一发而断链,恰好断在它存在的意义上;
  cron 每小时重发,第一枪成功的 fire 跑恢复,然后**删除 cron**(自清理是纪律的一部
  分 —— 幸存 cron 是孤儿定时器)。fired 文本照定时器写法纪律:幂等开头、只写判据。
- **恢复 playbook**(链的是既有规则不是新规则):逐个探在飞云卡(它们死在墙上;
  draft-PR-early 契约守住时零信息丢失)→ 走直接验收兜底或 transcript 复活 → 重挂常
  规巡检定时器 → 照常跑轮。
