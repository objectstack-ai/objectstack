# 平台读数事实表(references —— 按需加载)

出处:主文件「平台读数纪律」。本表 = GitHub API / 工具行为的**实测事实**,做对应操作的那一刻查阅;
原则住主文件。⛔ 不引用 issue 编号 —— 每条自含失效模式与边界。

## 队列成员资格与 auto-merge

- **「本仓是否强制队列」是仓库 ruleset 事实**:`grep merge_group` 答的是另一个问题
  (队列内是否重跑 CI),两者独立、缺席不构成反证(实测:某仓 ruleset 强制而无
  trigger,队列照收 PR、由 PR 上下文的 check run 满足);权威读数 = 合并尝试本身(回
  405 `Changes must be made through the merge queue`)或 rulesets API;姊妹仓不一致(objectos 2026-08-18 起有队列,hotcrm 只有 ruleset)⇒ 新仓落地约定靠实测确立,⛔ 不由缺席推断(2026-08-20 实测)。
- 判「在不在合并队列」看 timeline 事件 `added_to_merge_queue`(REST
  `GET /repos/{owner}/{repo}/issues/{pr}/timeline`),⛔ 不看 `auto_merge` 字段 ——
  入队后它回落为 off,零信息量(维护者 2026-08-11 裁定)。队列分支(ls-remote 拼写见
  「零成本等价物」)正命中即已入队,缺席不作反证 —— 队列满载时分支尚未建出。
- **成功序列读间隔不读事件名**:`removed_from_merge_queue` 后 ~1 秒内跟 `merged` 是落地不是被踢;真被踢是其后无 `merged`、几分钟后 PR 仍 open。
- 「不在 `origin/main` 上」是二义读数(在队列里等 / 没入队,处置相反)—— 落地检查
  永远两个读数:**队列成员资格 和 `origin/main`**,缺一不可;`origin/main` 那一读**按内容读**(grep 本 PR 该产出的产物),⛔ 不按 PR head sha 的祖先性、也不按 `merged` 布尔:队列落的是**另一个提交**,于是 `git merge-base --is-ancestor <pr-head> origin/main` 对一个已完全合入的 PR 答 NO(非浅检出,与「读数陷阱」浅检出坑不同因),而同一 PR 的 `list_pull_requests` 在 `fields` 投影下实测回过自相矛盾的一行:`merged: false` 与 `merged_at` 有值 + `state: closed` 并存 —— 只读布尔的一切判据把已落地读成「没合」(2026-08-23 落地时刻实测)。
- **`mergeable_state` 惰性计算**:首次 GET 可能回 `unknown` —— 重读一次拿真值;
  `dirty` 即队列入口否决(冲突对象是**当前** main);draft PR 恒回 `draft`
  (「draft+clean」组合不存在);本地试合并随 fetch 老化,该字段不老化。只在入队
  决策点 `get` 一次:挂了 flip 定点(landing-operations)就到点再读,⛔「又查又等」双份支出。
- **状态核验用最小字段**(search/list + `fields`)或等事件,整对象 `get` 留给入队
  决策点;门禁放行判据 = 承载门禁族 job 的 conclusion,聚合(`blocked`/`dirty`)只作阴性筛查再定位,放行按名定向读单条 job,⛔ 不拉全表(按名定位失败才拉)。
- **PR 转回 draft 同时掉 auto-merge 与队列成员资格,均不自动恢复**(转正后必须重
  新挂);反方向同理:要真踢出队列只有转 draft —— `disable_pr_auto_merge` 单独调用**不解除队列成员资格**,PR 照样落地。
- **`enable_pr_auto_merge` 一律显式传 `mergeMethod: "SQUASH"`**(不传时静默退回被
  禁的 merge-commit 方式 = 无操作);**回显两向不可靠**(实测:队列路径回显空而入
  队照发;显式传 SQUASH 回显 `MERGE`,落地仍每 PR 一提交)⇒ 权威信号只有 timeline 入队事件与最终 MERGED,⛔ 不拿回显当任何方向的证据。
- **配额枯竭时 `enable_pr_auto_merge` 回成功而挂载根本没发生**(实测:12:01Z 一次「成功」后 2.5 小时零动静 —— 同期别的 PR 正常合入,合并通路是好的;~14:33Z 配额恢复后同一调用 ~1 分钟内落地)⇒ **验效果,不验回应**:挂载后按下条序列以队列分支 / timeline 入队事件确认,⛔ 不拿成功报文收工。⚠️ 「回读 `auto_merge` 非空」这条自然写法**本接口给不了**:`pull_request_read` 无该字段、`fields` 枚举也无此成员(armed 与未 armed 读回逐字节相同:`open` / `draft:false` / `mergeable_state: clean`),入队后它又回落为 off ⇒ 可用效果读数只有队列分支、timeline 入队事件、最终落地三种。已死假说记此免得重犯:auto-merge **不会**在已绿 PR 上静默空转(恢复窗口里两个全绿 PR 挂上即合)。
- enable 后的验证序列:① 先验队列分支(给条目 ~20–30s 建出);② 分支在 ⇒ 结束,⛔ 不翻转;
  ③ 等待后仍缺席**且队列已见 churn**(更新的条目建出了分支而你的没有 —— 截断下单纯缺席不充分;
  首挂静默不入队实测存在,churn 后翻转即愈)⇒ 翻转一次(`disable` → `enable`),仍以 timeline 事件验证;
  ④ ⛔ enable 与它的队列验证之间永不插 `disable` ——「入队」webhook 可能乱序迟到,armed 窗口里补的 disable 会撤掉已发生的真实入队。
- **队列踢出先认签名再决定重投**:已知 flaky 核对失败签名一致 ⇒ 原样重投;止血修
  复合入后**同一签名再现就不再是那条 flaky**,是新问题必须重新诊断,⛔ 禁止条件反
  射式重投;第三种签名:本 PR 名下**没有任何** `merge_group` run 且批次同伴的 run
  全部 `success` = 队列重建的连带取消不是红 —— 带签名读数收据重投一次(收据留在
  PR 上),⛔ 无收据不重投;同一 PR 第二次被踢 ⇒ 停止重投,按签名四分支重判。
- **实测吞吐两则**:合并队列落地 ≈ 每 PR 15–30 分钟且串行(⛔ 不据「还没落」提前判异常);单容器重验证(build+test)并发甜点 ≈3,排批按它定上限。

## API 配额

- **配额按账户计,不跨席共享;按查询复杂度计费,不按调用次数**:各席位跑在**不同 GitHub 账户**下,「所有 agent 共用一个身份」只在**席位内部**成立(一个席位派出的每个 dev 都以该席身份发言 —— 这正是认领必须在评论里写 session ID 的理由)⇒ ⛔ 不据限流报文里的 user ID 推「池子跨席共用、优化自己没用」(实测推翻),本席额度**完全由本席做法决定**,优化有效且是唯一有效手段;计费按复杂度/节点数 ⇒ 优化方向是**每次少拿**,不是少调用。实测(`/rate_limit` 前后差量,该端点自身不计费):上限 5000/时;单个 dev 子代理 ~15 分钟烧 ~5658 点;一次 `list_issues`(34 张卡、perPage=100)= 107 点;耗尽时刻 GraphQL used 10461(超上限一倍)而 REST core used 7 ⇒ **最大消耗方是派出去的 dev 子代理,PM 巡检相比之下是噪声**(2026-08-22 实测)。
- GraphQL 配额(5000/时)极易打满,**MCP list/search 家族整个走 GraphQL 池** ——
  反复撞上的限流墙就是它;「读与评论走 REST(core 15000/时,独立计)」预设会话真有
  REST 通道:MCP 读工具无 REST 替身,直连 REST 受会话级授权门(会话起点快照,403
  `GitHub access is not enabled for this session`)与出口代理(只放 repo-scoped
  路径,`/search/*` 被拒、`/rate_limit` 例外)钳制 —— **纯 MCP 会话撞上枯竭池 =
  重置前没有任何 list 通道**,降级读法 = 下文 git 先行与 WebFetch 两行;只有无
  REST 对应物的写才花 GraphQL,`issue_write` 连查找半边都吃 —— 配额红时认领类动作排队,评论(REST 池)先行把结论发出去。
- **两个「瘦身参数」都不省池**:`fields` 省载荷不省池 —— MCP list/search 服务器端无条件抓 Project field_values,池枯竭时**最小字段请求同样全体失败**(报错串 `failed to fetch issue field values: API rate limit already exceeded`);
  ⛔ **`minimal_output: true` 不裁 `list_issues` 的 `body`**(2026-08-22 实测:返回字段仍含 `body`,首条 3258 字符、整体 122,685 字符仍超单次工具输出上限被落盘)—— 工具描述的反向暗示是假的,**永不当省额度手段写进任何 skill**;只要 number/labels/title 时也没有任何参数能关掉 body:要么接受整表 107 点,要么换更窄接口(`search_issues` 点数未实测)。⚠️ 前后体积对比不作证据(两次调用相隔数小时、population 已变),站得住的是直接观察 `body` 在。
- **git 先行**:本地检出 / `git log` / `ls-remote` 不花配额,断粮期分支存在性检查照常可用,PR 文件读取同走 git(REST PR files 端点实测可瞬态 404);
  **零成本等价物四条**(API 两次挂掉期间实测全程可用):合并队列 `git ls-remote origin 'refs/heads/gh-readonly-queue/*'`;是否落地 `git log --format='%H %s' -40 origin/main` 按 PR 号 grep;squash 验证 `git rev-list --parents -n1`(父提交数);分支存在性 `git ls-remote origin 'refs/heads/*<key>*'`。
  开轮先读配额(`curl` 带 Bearer `$GH_TOKEN` 打 `/rate_limit`,该端点免费;容器内**没有** `gh`,见「读数陷阱」),graphql remaining < 1000 ⇒ 本轮降级为 git 先行 + 只做必要写;
  **派 dev 之前同样先读一次**:额度不足先等重置再派 —— 中途撞限流的 dev **完不成强制查重**,只能把发现交回 PM 代为归档;限流窗口里「必须查重才能归档」的动作等待,⛔ 不盲目开卡。
  打满时:待执行写**排成有序清单挂进巡逻词**(不靠记忆),恢复窗口按序连清;重试对齐整点(REST core 整点重置)优于指数退避,⛔ 绝不忙轮询;
  search 与 core 独立计,一侧打满另一侧可作退路;REST core 共享身份下同样会打满;文档载明、未实测:条件请求答 `304` 不计 core 池(仅当直连 REST 获准才相关)。
- **公开仓降级读法:WebFetch github.com 网页零 API 配额**(带 label 过滤的 issue
  列表、issue 全文含评论、PR 页含 checks,实测撑得起整轮盘点);边界:~15 分钟缓存、列表行不含 assignee、内容是渲染层。
- **查重先 `search_issues`**(2026-08-18 23:3xZ 实测:单次调用按 issue body 内文本命中且 `total_count` 精确 ——「search API 对本会话不可用/回错误对象」的继承说法实测为**假**;继承说法不是读数,复述必须带实测日期):body 文本匹配是 repo-scoped `list` 做不到的(全量抓取再 grep 才等价),`list` + 对照组降为回退。
- **`search_issues` 可整会话静默归零 —— 控制词一并归零**(2026-08-23 实测:某会话对**每个**查询回 `total_count: 0`,含已知必中的控制词;同时刻另一会话同工具正常 ⇒ 故障是**会话级**,不是工具/平台级)。诊断:结果可疑时先跑一个带 `repo:` 限定、已知必中的控制词;回 0 ⇒ 本会话 search 已坏,**立刻换通道,⛔ 不重试**(重试只烧配额)。正确退路 = **REST 列表端点** `GET /repos/{o}/{r}/issues?state=open&labels=a,b&per_page=100&page=N`(走 core 桶、结果**完整**;`GET /search/issues` **不是**退路 —— 出口代理按设计只放 repo-scoped 路径);⛔ **不要用 MCP `list_issues` 手扫**:它走 GraphQL 稀缺桶,且分页手扫极易半途而废(实测 226 张 open 只扫了 100 张)—— **不完整枚举比零结果更危险,它读作「搜过了,没有」**。⛔ 已推翻的候选机理,别再追:「查询串里带 GitHub 限定符(`repo:`/`is:open`)把语义 search 打成零」—— 两次实测反证:带 `repo:` 的控制词回 `total_count: 5`;另一席同工具两腿对照,`repo:… is:open …` 回 1(精确命中)而裸词回 13(语义扩散),限定符在那儿**收窄**结果而非破坏。归零机理仍未定(候选:scope 过滤层静默清空 / search 桶 403 被 MCP 层吞成空结果),要定它必须在复现会话里抓原始响应。
- **`search_issues` 不可靠地返回分钟级新卡**:同轮发现的东西查重,搜索之外必须按创建时间列近期 issue(`list_issues` + `orderBy: CREATED_AT`)—— 实测一张 ~7 分钟大的同实例卡被关键词与语义搜索双双漏掉,靠按日期列表才逮到;边界:两次观察、索引延迟未实测,断言只到「search 可能漏掉分钟级 issue」,更硬的窗口要另测(2026-08-20 实测)。
- **会话中途轮换凭据把 GitHub MCP 服务器杀到不可恢复**:此后一切 `mcp__github__*`
  回 `Streamable HTTP error: invalid session`(含几分钟前还好的工具),只有新会话
  重绑 —— 轮换前提醒维护者:在飞席位丢的是整条 GitHub 通道;配额池按身份计,换身份即清零燃烧,共享身份结构不变。
- **组织侧授权变更后仓库访问逐步传播**(同一端点数分钟内 403→200);403 错误对象存
  盘仍是合法 JSON,期待列表的脚本会静默报假「0 issues」—— 零命中纪律覆盖 list 读:空车道先对仓库 `open_issues_count` 反查再信。
- **MCP 参数两陷阱**:`list_issues` 多标签过滤是 **OR(并集)**不是 AND —— 混入别
  车道同状态卡与本车道全状态卡,结果良构、失效全静默;正确读法 = **整车道单标签一
  次读全 + 本地对 labels 求交**,或改走 REST —— **两个通道的 `labels` 语义相反**:REST 列表端点的 `labels=a,b` 是**真 AND**(交集),MCP `list_issues` 的 `labels` 数组是 **OR**,要交集就用 REST(2026-08-23 两席各自独立实测 OR 侧:一席请求 `domain:ui` ∩ `pm:queue` 回来 154 张、含 `domain:spec`/`domain:devx`/`pm:blocked`,另一席 `[domain:skills, finding]` 回来别车道的 finding 卡)。`issue_write` 的 `labels` 是**整组替换**不是追加
  —— 同一动作内重读现值合并再写(隔轮旧读数 = 无效快照,按其回写静默剥别的标签);真追加走 REST `POST /issues/{n}/labels`;写后照标签纪律回读。
- **`list_issues` 永不返回 assignees**(`fields` 枚举无此成员,不传也没有)—— 已
  认领卡与空闲卡响应逐字节相同,清单只是**候选名单**:每条认领前必须过完整 `issue_read`(它才返回 `assignees`),⛔ 不把清单当候选集直接认领。
- **MCP `issue_read` 的 body 实体转义是纯读侧伪影**(撇号/引号/尖括号成数字实体;
  comments 原样),存储体是明文,**先解码实体再写回**往返实测安全(无双重转义)——
  腐蚀 body 的恰是把转义读数原样回写;⚠️ 但读侧**并非一律可逆** —— 行内反引号里的尖括号片段被 MCP 读路径**整个丢弃**(不是转义,无从解码回来),判据与处置见「读数陷阱」判截断行;写侧剥除(HTML 注释、tag
  形状片段 —— 细则见「读数陷阱」写侧行)是**真实存储损耗**,⛔ 两类不并成一条「API 会改 body」,写后回读因此必做;实体归属(MCP 还是 GitHub API)与 `&amp;` 类未实测。
- **`Blocked-by:` 行归 BODY(单通道反向索引)**:追加按上条「解码后写回」执行;历
  史上寄放在评论里的行按同程序**增量**回填(⛔ 不搞批量突击 —— 限流压力);解锁扫
  描只 grep body,⛔ 不加常设评论读;旧「连评论一起扫(`in:comments`)」提示作废,扫描走直读(`list_issues` + `issue_read` 读 body)。
- **`list_issue_types` 对本集成 403,而 `issue_write type:` 正常**(读权限缺口):
  直接写已知好值(`Bug`/`Feature`/`Task`),写侧报错才是真信号,⛔ 不先探列表定可
  用性(列表 403 ≠「类型不可用」);非法值是响错还是静默丢弃未实测,写非已知值前先小样验证。

## 读数陷阱

- **读数五坑**:`cd X && cmd` 会短路(路径不存在时命令在当前仓继续执行,产出假读数)—— 跨仓一律 `git -C <path>`;
  `git grep -c <pat> | wc -l` 数文件数不是命中数;裸名 grep 被幸存家族当子串命中 —— 退役核验带引号精确名,
  更硬判据是查声明式(`^(export )?(const|type|interface) <Name>\b`)而非查提及;浅检出上的历史读数不可信
  (`merge-base --is-ancestor` 假「非祖先」、`rev-list --count` 截断、`branch -r --contains` 零输出)—— 先 `--deepen` 再判,或走 REST `compare`;
  **容器里没有 `gh`**(实测:`command -v gh` 退出 1、`/usr/bin/gh` 与 `/usr/local/bin/gh` 都不存在),于是 `gh … || echo "none"` 是个**不可证伪的否定** —— 127「命令不存在」与「grep 没命中」在输出上同值,实测五张 PR 上跑五次「无重叠文件」全部打印安心结论、一次都没检查,险些作为已核验声明进 PR 正文(与隔管道读退出码同类:仪器对两种结局回同一个值,重跑多少次都不自相矛盾)。安全拼写:先 `command -v <cmd>` 确认存在,或在 `||` 之前捕获状态;⛔ 一般规则:**任何可能不存在的命令上挂 `|| 回退` 都是不可证伪的否定**,PR / 查重类核验改走 MCP GitHub 工具或 git。
- **`refs/remotes/origin/main` 全 worktree 共享,别的 agent 一次 fetch 就推进它**(worktree 只隔离工作树与 HEAD,`.git/` 下 refs、stash 栈、config、hooks 皆共享):`git reset --soft origin/main` 把你分支点之后**他人已合并的文件**整批 stage 成你的改动 —— 报成功、唯一症状是 `git status` 里的他人文件(实测一次 stage 进四个 agent 的合并文件,commit 前才逮住);「我从哪开始」的 reset/diff/log/rebase 一律锚建分支时记录的 base sha(`BASE=$(git rev-parse HEAD)`),⛔ 永不锚 `origin/main`。
- `rerun_failed_jobs` 复用原 run 的提交与合并 ref,不拿新 main 重算 —— 红因是基上
  缺一个已合修复时重跑无效,只能推提交(`git merge origin/main`);判别:修复的合并时间晚于 run 创建时间即是。
- **同一 head 上轻量兄弟 workflow `success` + 重量级载体 `cancelled` 是普通取代的
  预期签名,不是选择性失败**(cancel-in-progress 窗口只罩得住跑得慢的载体):先比对 run `head_sha` 与 PR 当前 head(取代必有新 head),不开「为何只取消它」调查。
- **CI 红了先取完整日志归档再下结论 —— 断言文本只在归档里,直读工具拿不到**
  (2026-08-18 实测):`get_check_run` 对本仓 CI job 回空 `output.text`,`get_job_logs` 无论 `tail_lines` 只回占满日志尾部的 post-step service-container teardown ⇒ 两者都答不了「到底挂在哪」;失败 step 名免下载即得(`actions_get method=get_workflow_job`),真实断言文本走 run 日志归档:`actions_get method=get_workflow_run_logs_url` → 下载解压,分步文件在 `{Job name}/{step number}_{step name}.txt`。
  「completeness check 绿」只断言没有 worker 静默死 ≠ 测试通过;并发输出的「相邻」≠「因果」(先查 `turbo.json` 依赖边),⛔ 不只看 tail;
  公开发出的诊断被推翻时,更正发在同样公开的位置,据它开的 PR 撤回 draft、解绑 `Fixes`。
- **判「正文被截断」必须双读取**:`.body` 原文 + `Accept:
  application/vnd.github.full+json` 的 `.body_html`,两者同一处断掉才算 issue 端截断。读侧实测有确定性触发:正文含字面 script 开标记形状的 token(less-than 紧跟 script 字样;doctype 开标记、object 标签形状同触发)时,API/MCP 读回在该 token 处静默截断而网页全文完好 —— 存储体无损,⛔ 不「修复」只在 API 读短的卡:先 WebFetch 渲染页核对全文,重写会毁掉本来正确的正文。
  **第三条读路径,同一个坑、读路径对调**:MCP `issue_read` / PR 读路径把**行内反引号里的尖括号片段整个吃掉**,而 GitHub 存储字节完好(raw REST 取回一字不差)⇒ ⛔ **永不单凭 MCP 读判截断,先取 raw REST 核对再判** —— 否则「repair-first」规则被**正确**地应用到一张完好的卡上,重写毁掉的是正确内容(同日三席独立观察,一次已到差点重写的地步,拦住它的只是那位 dev 自己的核验习惯 —— 无任何机械守卫)。判据 = 数**空的行内代码跨度**:一个空的行内代码恰是短尖括号片段被吃掉的签名(对照:一份读作 0 空跨度、10 个存活字面尖括号 tag 的正文即完好;阴性对照 —— 有的正文本来就把标识符不带尖括号写,所以判据是**尖括号**不是反引号);数字实体(撇号 / 引号成 `&#39;` / `&#34;`)是普通实体编码,**不是**截断证据(2026-08-23 实测)。
- **落库删字节,网页同显、围栏不防护**:「less-than + 感叹号 + 左方括号」序列(markup-declaration 开标记,恰是负向后行断言接字符类的形状)里的感叹号在存储层被删,幸存文本仍像代码但意义已变;裸「less-than + 感叹号」存活;作者规则并入下一条。
- 写侧另一半:sanitizer 在**写入时按 tag 形状删,不按尖括号**(2026-08-18 issue body 实测):行内反引号里的 tag 形状 token(读作未知 HTML 标签者 —— 注释标记、`<n>` 类占位符、泛型)整个被删;孤立 less-than / greater-than 在行内代码**存活**;⛔ **围栏不防护 tag 形状 token**(2026-08-20 issue body 三写实测,推翻旧「围栏块整体存活」读数):HTML 注释形状标记裸写被整删留空行,入围栏照删留空围栏;非 tag 形状的带尖括号正则在围栏中实测存活(2026-08-18,上一条删感叹号仍另计);同日实测同类标记在**评论**里存活,但 ⛔ 不据此推「评论豁免」(下条:评论体照样被整段截断);裸标识符(无尖括号)存活 ⇒ SKILL 提取契约(字面文本 grep + 裸标识符回退)仍有效;写返回 200,损耗只在回读可见。
  作者规则一条管三坑:必须字面携带 tag/script/markup-declaration 形状的文本进围栏并把危险字符用词拼出,或改花括号占位符(`{n}`)/整句用词描述;要字面尖括号写实体 `&lt;` / `&gt;`;含尖括号的任何写后回读逐个确认(失效完全静默;⛔ 回读不豁免评论 —— 2026-08-18/19 四次评论写入里那次未归因的标记缺席,归因在下条)。
- **评论体也会被毁,形状是「截断」不是「删片段」**:sanitizer 从**首个命名 HTML 元素的尖括号片段**起,把评论体一路吃到结尾(2026-08-21 实测:一份用**字面文本**标记发出的 dev 报告评论,正文在 `this.error(` 处断掉、JSON 不可解析;同机制把记录此事的卡自己的正文也截在同一处)⇒ ⛔ **字面文本标记只保住标记、保不住正文** —— 标记扫描照报成功,人看着像正常收尾,只有真去解析才发现;引信是普通 TS 形状(`Promise<object>`、`Array<link>` 一类),不是奇异语法。安全过程:标识符一律进反引号,尖括号写实体或用词拼出,写后**回读尾部**确认正文结束在它该结束的地方,⛔ 只回读标记不算验证。⚠️ 边界:姊妹仓一次五形受控探针测到的是**选择性删除**(所有位置的 tag/注释被移除,不能开标签的尖括号实体化存活)而非截断到尾 —— 两种形状都实测过,写侧一律按最坏的截断防护。
- **并行 spec PR 同动 pin 计数断言**(被踢不是事故,按 os-regen 序再解一轮):解冲
  突两侧收据都保留、按合并顺序堆叠,新计数**从合并后源码重数**(操作数是文件本身不是历史),⛔ 不从两侧收据做算术;双方占同一编号是常态(各取当时 max+1),重编号后进侧。
- **容器重启杀死在飞 dev,现场三态判读**:① 分支已推 + PR 已开 ⇒ 只欠验收(CI 重跑 + 复核,不动代码);
  ② 死在 regen 中途(未提交全是生成物、merge commit 已在)⇒ PM 直接续作 —— build → 整链 regen → 生成物门禁全绿 → 提交推送,
  恢复 commit 带 `Recovery commit:` 前缀留审计;⚠️ 有的现场 regen 一件没跑,推送前先跑生成物门禁别赌;
  ③ 死在源码编辑中途 ⇒ 先读 diff 判完整性 —— docblock 写全动机/失效模式/判据的,PM 可代跑终验后提交,
  写一半意图不明的 ⛔ 不代提交、记进交接;dev 临时目录(`.os-scratch/` 一类)是工作物不是交付物,清掉,⛔ 不进 feature PR。
- **零提交的探针分支不是在飞工作**:容器发不出分支删除 refspec(实测 `git push origin --delete <b>` 回 `send-pack: unexpected disconnect while reading sideband packet`,三次退避全败;**同会话普通 push 正常** ⇒ 不是连通性问题),于是测量型派发留下的探针分支永久堆在 origin 上。读法规则:`claude/issue-*` 分支**零提交领先 `origin/main` 且没有开着的 PR** = 不承载任何工作,⛔ 不据 `ls-remote | grep issue-` 的正命中回避该卡 —— 失效方向是**活卡被永久读成已被认领**(无红信号、只增不减,认领前的在飞预检恰恰依赖它)。判据两读:`git rev-list --count origin/main..origin/<b>` 为 0,且该分支名下无 open PR。边界:一容器一会话三次,成因未诊断(代理 / 服务端钩子 / 分支保护未分辨),origin 上此类孤儿分支存量未普查。
- **会话从上下文检测不到自己的静默降档**(2026-08-20 实测:一次分诊 fire 两级静默降档 Fable→Opus 5→Opus 4.8,降档横幅只在 UI 侧渲染、会话上下文零信号,子轮开场仍自述「跑在契约复审档」)——服役模型的权威读数是 `get_session`(claude-code-remote MCP,无参)的 `external_metadata.last_served_model`(记录最近一轮实际服役者,降档链中途照真);`session_context.model` 是**配置**档不是服役档,⛔ 不作保险丝输入。

## 闭合关键词解析(PR 正文写侧)

- **PR 正文里「不修某卡」的否定句照样关卡**:闭合关键词解析器匹配
  `fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved` + `#N`,**不理会
  前面的否定词** —— 声明不修的那句话恰在合并时关卡;安全写法 = 号码不被关键词打头
  (`#N is not addressed here` / `out of scope: #N` / `#N remains open`)。实测边
  界三条:关键词只绑**同一行**的 `#N`;动名词(closing/fixing)不是关键词;行内反引号里的关键词不触发(code span 实测不建闭合链接;围栏块未独立实测,按同规则对待但留待复测)。
- **PR body 与 squash commit message 是两个独立解析源**(commit 干净 ≠ body 干净,
  只查 commit 会漏);误关的卡以 `completed` 状态对一切「只看 open」的过滤与巡检隐
  身,无任何机械守卫覆盖这条路径 —— 消费侧检查 = 合并后读 `closed_by_pull_requests`(在复核清单)。

## 断粮检测与跨墙恢复细则(5 小时用量墙)

原则、定时器选型(⛔ 不用 send_later 链)与恢复 playbook 在主文件;事实补遗:`npx ccusage blocks` 容器内可用(读本地会话记录),报当前 5 小时窗口边界/剩余与燃烧率;
盲区:窗口起点是本地推断的近似值;撞墙报文形如「limit reached, resets at HH:MM」(重置时刻只在此刻可得 —— 主文件原则的实测形状)。
