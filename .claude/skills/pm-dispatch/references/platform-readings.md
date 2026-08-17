# 平台读数事实表(references —— 按需加载)

出处:主文件「平台读数纪律」。本表是 GitHub API / 工具行为的**实测事实**,在做对应
操作的那一刻查阅;原则住在主文件。⛔ 本表不引用 issue 编号 —— 每条自含失效模式与边
界。

## 队列成员资格与 auto-merge

- 判「在不在合并队列」看 timeline 事件 `added_to_merge_queue`(REST
  `GET /repos/{owner}/{repo}/issues/{pr}/timeline`),⛔ 不看 `auto_merge` 字段 ——
  入队后它回落为 off,零信息量(维护者 2026-08-11 裁定)。队列分支读法
  (`git ls-remote --heads origin 'refs/heads/gh-readonly-queue/*'`)正命中是「已
  入队」的充分证据,反向推断作废 —— 队列满载时 PR 已入队而分支尚未建出。
- **成功序列读间隔不读事件名**:`removed_from_merge_queue` 后 ~1 秒内跟 `merged`
  是落地不是被踢;真被踢是其后无 `merged`、几分钟后 PR 仍 open。
- 「不在 `origin/main` 上」是二义读数(在队列里等 / 没入队,处置相反)—— 落地检查
  永远两个读数:**队列成员资格 和 `origin/main`**,缺一不可。
- **`mergeable_state` 惰性计算**:首次 GET 可能回 `unknown` —— 重读一次拿真值;
  `dirty` 即队列入口否决(冲突对象是**当前** main);draft PR 恒回 `draft`
  (「draft+clean」组合不存在);本地试合并随 fetch 老化,该字段不老化。只在入队
  决策点 `get` 一次:挂了 flip 定点(landing-operations)就到点再读,⛔「又查又等」双份支出。
- **状态核验用最小字段**(search/list + `fields`)或等事件,整对象 `get` 留给入队
  决策点;门禁放行判据 = 承载门禁族 job 的 conclusion,聚合(`blocked`/`dirty`)
  只作阴性筛查再定位,放行按名定向读单条 job,⛔ 不拉全表(按名定位失败才拉)。
- **PR 转回 draft 会同时掉 auto-merge 与队列成员资格,且不自动恢复**;转正后必须
  重新挂。反方向同理:要真踢出队列,只有转 draft —— `disable_pr_auto_merge` 单独
  调用**不解除队列成员资格**,PR 照样落地。
- **`enable_pr_auto_merge` 一律显式传 `mergeMethod: "SQUASH"`**:不传时静默退回被
  禁的 merge-commit 方式,等于无操作。**回显两向不可靠**(实测:队列路径回显空而
  入队照发;显式传 SQUASH 回显 `MERGE`,队列侧改写,落地仍每 PR 一提交)⇒ 权威信
  号只有 timeline 入队事件与最终 MERGED,⛔ 不拿回显当任何方向的证据。
- enable 后的验证序列:① 先验队列分支(给条目 ~20–30s 建出);② 分支在 ⇒ 结束,
  ⛔ 不翻转;③ 等待后仍缺席**且队列已见 churn**(更新的条目建出了分支而你的没有 ——
  截断下单纯缺席不充分)⇒ 翻转一次(`disable` → `enable`),翻转后仍以 timeline
  事件验证;④ ⛔ enable 与它的队列验证之间永不插 `disable` ——「入队」webhook 可能
  乱序迟到,armed 窗口里补的 disable 会把已发生的真实入队撤掉。
- **队列踢出先认签名再决定重投**:已知 flaky 核对失败签名一致 ⇒ 原样重投;止血修
  复合入后**同一签名再现就不再是那条 flaky**,是新问题,必须重新诊断,⛔ 禁止条件
  反射式重投。第三种签名:本 PR 名下**没有任何** `merge_group` run 且批次同伴的
  run 全部 `success` = 队列重建的连带取消,不是红 —— 带签名读数收据重投一次(收据
  留在 PR 上),⛔ 无收据不重投;同一 PR 第二次被踢 ⇒ 停止重投,按签名四分支重判。
- **实测吞吐参数两则**:合并队列落地延迟 ≈ 每 PR 15–30 分钟且串行(⛔ 不据「还没
  落」提前判异常);单容器重验证(build+test)并发甜点 ≈3,排批按它定并发上限。

## API 配额

- GraphQL 配额(5000/时)极易打满,**MCP list 家族(`list_issues` 等)整个走
  GraphQL 池** —— 反复撞上的限流墙就是它;读与评论一律走 REST(core 15000/时,独
  立计);只有无 REST 对应物的写才花 GraphQL,`issue_write` 连查找半边都吃 —— 配额
  红时认领类动作整体排队,评论(REST)先行把结论发出去。
- **git 先行**:能从本地检出 / `git log` / `ls-remote` 读到的状态不花配额;开轮先
  读配额(免装 gh CLI:`curl -H "Authorization: Bearer $GH_TOKEN"
  https://api.github.com/rate_limit`),graphql remaining < 1000 ⇒ 本轮降级为 git
  先行 + 只做必要写。打满时:待执行写**排成有序清单挂进巡逻词**(不靠记忆),恢复
  窗口按序连清;重试对齐整点(REST core 整点重置)优于指数退避,⛔ 绝不忙轮询;
  search 与 core 独立计,一侧打满另一侧可作退路;REST core 共享身份下同样会打满
  ——「走 REST」≠「不限量」。
- **MCP 参数两陷阱**:`list_issues` 多标签过滤是 **OR(并集)**不是 AND —— 双标签
  查询混入别车道同状态卡与本车道全状态卡,结果良构、规模合理,失效全静默;正确读
  法 = **整车道单标签一次读全 + 本地对 labels 求交**(正确性要求,不是风格偏好)。
  `issue_write` 的 `labels` 是**整组替换**不是追加 —— 写标签前**同一动作内**重读现
  值合并再写,隔轮/隔小时的旧读数视为无效快照(按其回写会静默剥掉别的标签);真追加走 REST `POST /issues/{n}/labels`;写后照标签纪律回读。
- **`list_issues` 永不返回 assignees**(`fields` 枚举无此成员;不传 `fields` 也没
  有)—— 已认领卡与空闲卡在响应里逐字节相同,车道清单因此回答不了「哪张能认领」,
  失效完全静默。清单只是**候选名单**:每一条在认领前必须过一次完整 `issue_read`
  (它才返回 `assignees`),⛔ 不把 `list_issues` 结果当候选集直接认领。
- **MCP `issue_read` 的 body 实体转义是纯读侧伪影**(撇号/引号/尖括号成实体;
  comments 原样),存储体未变;**先解码实体再写回**的往返实测安全(无双重转义),
  腐蚀 body 的是把转义读数原样回写。写侧真损耗:HTML 注释写入时被**静默剥除**,要存活的内容一律写成可见 markdown。
- **`Blocked-by:` 行归 BODY(单通道反向索引)**:追加按上条「解码后写回」执行;历
  史上寄放在评论里的行按同程序**增量**回填(⛔ 不搞批量突击 —— 限流压力);解锁扫
  描只 grep body,⛔ 不加常设评论读;旧「连评论一起扫(`in:comments`)」提示作废,
  扫描走直读(`list_issues` + `issue_read` 读 body)。
- **`list_issue_types` 对本集成 403,而 `issue_write type:` 正常**(读权限缺口):
  直接写已知好值(`Bug`/`Feature`/`Task`),写侧报错才是真信号,⛔ 不先探列表定可
  用性(列表 403 ≠「类型不可用」);非法值是响错还是静默丢弃未实测,写非已知值前先小样验证。

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
- **同一 head 上轻量兄弟 workflow `success` + 重量级载体 `cancelled` 是普通取代的
  预期签名,不是选择性失败**(cancel-in-progress 窗口只罩得住跑得慢的载体):先
  比对 run `head_sha` 与 PR 当前 head(取代必有新 head),不开「为何只取消它」调查。
- **CI 红了先取完整日志归档再下结论**:「completeness check 绿」只断言没有 worker
  静默死,≠ 测试通过;并发输出的「相邻」≠「因果」(先查 `turbo.json` 依赖边);
  ⛔ 不只看 tail。公开发出的诊断被推翻时,更正发在同样公开的位置,据它开的 PR 撤回
  draft、解绑 `Fixes`。
- **判「正文被截断」必须双读取**:`.body` 原文 + `Accept:
  application/vnd.github.full+json` 的 `.body_html`,两者在同一处断掉才算 issue 端
  截断;任何单一读法的尾部缺失先算读取端截断(工具输出上限、分页、切片)。写侧另
  一半:sanitizer 会在**写入时就地删除**短 `<…>` 片段(HTML 注释标记、`<n>` 类占
  位符、泛型),反引号与围栏**不提供保护** —— 要保留字面尖括号一律写 HTML 实体
  `&lt;` / `&gt;`;含这类片段的正文,写后回读逐个确认仍在(失效完全静默)。
- **并行 spec PR 同动 pin 计数断言**(被踢不是事故,按 os-regen 序再解一轮):解
  冲突两侧收据都保留、按合并顺序堆叠,新计数**从合并后源码重数**(操作数是文件本
  身,不是历史),⛔ 不从两侧收据做算术;双方占同一编号是常态(各取
  当时 max+1),重编号后进侧。
- **容器重启杀死在飞 dev,现场三态判读**:① 分支已推 + PR 已开 ⇒ 只欠验收(CI 重
  跑 + 复核,不动代码);② 死在 regen 中途(未提交全是生成物、merge commit 已在)
  ⇒ PM 直接续作 —— build → 整链 regen → 生成物门禁全绿 → 提交推送,恢复 commit 带
  `Recovery commit:` 前缀留审计;⚠️ 有的现场 regen 一件没跑,推送前先跑生成物门禁
  别赌;③ 死在源码编辑中途 ⇒ 先读 diff 判完整性 —— docblock 写全动机/失效模式/判
  据的,PM 可代跑终验后提交;写一半意图不明的 ⛔ 不代提交,记进交接。dev 临时目录
  (`.os-scratch/` 一类)是工作物不是交付物,清掉,⛔ 不进 feature PR。

## 闭合关键词解析(PR 正文写侧)

- **PR 正文里「不修某卡」的否定句会关掉那张卡**:GitHub 的闭合关键词解析器匹配
  `fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved` + `#N`,**不理会
  前面的否定词** —— 声明不修的那句话恰恰在合并时关卡。安全写法:把号码放在没有关
  键词打头的位置 —— `#N is not addressed here` / `out of scope: #N` /
  `#N remains open`。实测解析边界三条:关键词只绑**同一行**的 `#N`;动名词
  (closing/fixing)不是关键词;行内反引号里的关键词不触发(code span 实测不建闭
  合链接;围栏块未独立实测,按同规则对待但留待复测)。
- **PR body 与 squash commit message 是两个独立解析源**:commit message 干净不代
  表 body 干净 —— 只查 commit 会漏。误关的卡以 `completed` 状态对一切「只看
  open」的过滤与巡检隐身,没有任何机械守卫覆盖这条路径;消费侧检查 = 合并后读
  `closed_by_pull_requests`(在复核清单)。

## 断粮检测与跨墙恢复细则(5 小时用量墙)

原则、定时器选型(⛔ 不用 send_later 链)与恢复 playbook 在主文件;事实补遗:
`npx ccusage blocks` 容器内可用(读本地会话记录),给当前 5 小时窗口边界/剩余时间
与燃烧率(预警);第三盲区:窗口起点是本地推断的近似值;撞墙时 API 调用失败、宿主
报「limit reached, resets at HH:MM」(重置时刻主文件已述:那一刻可得、记下来)。
