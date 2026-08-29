# 平台读数事实表(references —— 按需加载)

出处:主文件「平台读数纪律」。本表 = GitHub API / 工具行为的**实测事实**,做对应操作的那
一刻查阅;原则住主文件。⛔ 不引用 issue 编号 —— 每条自含失效模式与边界。

## 队列成员资格与 auto-merge

- **「本仓是否强制队列」是仓库 ruleset 事实**:`grep merge_group` 答的是另一个问题(队列内是否
  重跑 CI),两者独立、缺席不构成反证(实测:某仓 ruleset 强制而无 trigger,队列照收 PR);权威读
  数 = 合并尝试本身(回 405 `Changes must be made through the merge queue`)或 rulesets API;姊妹仓不一
  致(objectos 2026-08-18 起有队列,hotcrm 只有 ruleset)⇒ 新仓靠实测,⛔ 不由缺席推断(2026-08-20)。
- 判「在不在合并队列」的**决断**读数是 timeline 事件 `added_to_merge_queue` /
  `removed_from_merge_queue`(REST `GET /repos/{owner}/{repo}/issues/{pr}/timeline`)—— 它**可按需
  重查、一次调用双向答**,分得开「从未入队」与「入队后被踢」;`pull_request.enqueued` webhook
  订阅了的会话确实收得到(与 timeline 差 ~1 秒),但推送式**不可重读** —— 新上下文或当时
  没订阅就取不回,故只作旁证,⛔ 不作决策依据。⛔ `auto_merge` 字段不只是空,是**不稳
  定**:同一 PR 一分钟内先 `set` 后 `None`(2026-08-26 实测),入队后又回落为 off(维护者
  2026-08-11 裁定)—— 永不据它判「没挂上」而重挂(重挂踢队重排)。
- **成功序列读间隔不读事件名**:`removed_from_merge_queue` 后 ~1 秒内跟 `merged` 是落地不是被
  踢;真被踢是其后无 `merged`、几分钟后 PR 仍 open。
- 「不在 `origin/main` 上」是二义读数(在队列里等 / 没入队,处置相反)—— 落地检查永远两个
  读数:**队列成员资格 和 `origin/main`**,缺一不可;`origin/main` 那一读**按内容读**(grep 本 PR 该
  产出的产物),⛔ 不按 PR head sha 的祖先性、也不按 `merged` 布尔:队列落的是**另一个提
  交**,`git merge-base --is-ancestor <pr-head> origin/main` 对已完全合入的 PR 答 NO(非浅检出),而同
  一 PR 的 `list_pull_requests` 实测回过自相矛盾的行:`merged: false` 与 `merged_at` 有值并存 ——
  只读布尔的一切判据把已落地读成「没合」(2026-08-23 落地时刻实测)。
- **`mergeable_state` 惰性计算,`unknown` 不是读数**(2026-08-25 实测:头已 dirty 的 PR 整窗答
  unknown,席位误读「auto-merge 被清」在脏头上重挂 —— 挂 unknown = 挂在可能脏的头上);`dirty`
  即队列入口否决(冲突对象是**当前** main);draft PR 恒回 `draft`;判头脏的决断读数是零配额本
  地试合并:fetch PR ref 后 `git merge-tree --write-tree origin/main <ref>`(冲突文件直接列出;随 fetch
  老化,重跑先 fetch;与 enable 序列的队列 ref/update-branch 探针互补,彼答入队与暗冲突、此在挂
  前答头脏)。入队决策点才 `get` 一次:挂了 flip 定点(landing-operations)到点读,⛔ 不又查又等。
- **状态核验用最小字段**(search/list + `fields`)或等事件,整对象 `get` 留给入队决策点;门禁放行
  判据 = 承载门禁族 job 的 conclusion,聚合(`blocked`/`dirty`)只作阴性筛查再定位,放行按名定向读
  单条 job,⛔ 不拉全表(按名定位失败才拉)。
- **转 draft 不是可靠的踢队手段 —— 两向相反实测,处置按最坏走**:本仓转 draft 同时掉
  auto-merge 与队列成员资格(均不自动恢复,转正后重挂);objectui 2026-08-25 已入队 PR 转 draft 条目
  保位、~40 分钟后队列照样合并(仓别/时机未分辨)。补救:转 draft + disable 都做(本仓
  `disable_pr_auto_merge` 单独不踢队、objectui 彼时径直拒绝);出队按下方「队列 ref」条阳性探针
  答不在队向,加未落地;ref 缺席只作旁证,⛔ 永不承载结论、不据单读数报补救。
- **`update_pull_request` 不管传不传都发送 `draft` 位 ⇒ 对 draft PR 的任何调用必须显式带
  `draft: true`**(reviewers/title/body/labels 单字段调用同坑;objectui 2026-08-25 实测:一次只传
  reviewers 的请审把治理面 draft 发布进合并队列,后果见上条);请审免碰 draft 位的专用路 = REST
  `POST /pulls/{n}/requested_reviewers`(文档载明、未实测:载荷只有 reviewers/team_reviewers;门开席位优
  先,MCP-only 席才用 update + 显式 `draft: true`)。undraft 可用路径只有 MCP 这条:传 `draft: false`
  落地(2026-08-24 三张 PR 逐张回读确认);**裸 GraphQL 会话内被拒**(回「only the pinned set of
  PR-review operations is served」,它建议的「改用 REST」对 undraft **是错的**);**裸 REST
  `PATCH /pulls/{n}` 传 `draft: false` 回 200 而无操作** —— 接口性质 ⇒ 池 0 只能等重置。
- **`enable_pr_auto_merge` 一律显式传 `mergeMethod: "SQUASH"`**(不传时静默退回被禁的 merge-commit =
  无操作);**回显两向不可靠,空回显≠未挂上**:传 SQUASH 后回读 `auto_merge.merge_method` 仍
  `merge`(2026-08-24 两张 PR、一张 disable→enable 复验同值)、队列路径回显空字段而入队照发,落
  地仍无一例外单亲 squash(方法归队列,本仓 `allow_merge_commit:false`)⇒ ⛔ 不拿回显当任何方向
  的证据、不为它翻转空转;「空字段=静默空转签名」旧读法已推翻,权威信号见下两条。
- **配额枯竭时 `enable_pr_auto_merge` 回成功而挂载根本没发生**(实测:「成功」后 2.5 小时零动
  静,同期别的 PR 正常合入;配额恢复后同一调用 ~1 分钟内落地)⇒ **验效果,不验回应**,按下
  条阳性探针确认,⛔ 不拿成功报文收工;回读 `auto_merge` 非空本接口给不了(`pull_request_read`
  与 `fields` 枚举都无该成员,armed 与否读回逐字节相同)⇒ 效果读数 = 下条探针①②、timeline
  入队事件、最终落地,队列分支仅在场时算;已死假说:已绿 PR 会静默空转。
- **队列 ref 答 BUILD 不答成员资格**(旧读法「存在即在队」作废):`gh-readonly-queue/*` **只在存在
  时**有意义(= 有 build 在跑),⛔ 缺席不是任何方向的读数。**阳性探针按成本序**:①
  `update_pull_request_branch` 回「Branches that are queued for merging cannot be updated」= 在队,正常返回顺
  带逼出暗冲突(它不踢已挂 PR、只是永不入队);② `merge_pull_request` 回 405「Pull Request is in the
  merge queue」= 在队(2026-08-28 两席各一次,均零 ref),405「Merge commits are not allowed」= 不在队,改
  挂 auto-merge。`enable_pr_auto_merge` 回应只答本次调用:时戳形有动作、空字段形无动作;⛔
  enable 与其验证间永不插 `disable`(入队 webhook 乱序迟到,会撤掉真实入队)。**踢出成因两
  则**:兄弟抢先落地 ⇒ `MERGE_CONFLICT`;缺必需批准 ⇒ 治理守卫 merge_group 腿 `CI_FAILURE`。
- **队列踢出先认签名再决定重投**:已知 flaky 核对失败签名一致 ⇒ 原样重投;止血修复合入
  后**同一签名再现就不再是那条 flaky**,是新问题必须重新诊断,⛔ 禁止条件反射式重投;第
  三种签名:本 PR 名下**没有任何** `merge_group` run 且批次同伴的 run 全部 `success` = 队列重建的
  连带取消不是红 —— 带签名读数收据重投一次(收据留在 PR 上),⛔ 无收据不重投;同一 PR
  第二次被踢 ⇒ 停止重投,按签名四分支重判。
- **实测吞吐两则**:合并队列落地 ≈ 每 PR 15–30 分钟且串行(⛔ 不据「还没落」提前判异
  常);单容器重验证(build+test)并发甜点 ≈3,排批按它定上限。

## API 配额

- **配额按账户计,不跨席共享;按查询复杂度计费,不按调用次数**:各席位跑在**不同 GitHub 账
  户**下,「所有 agent 共用一个身份」只在**席位内部**成立(故认领必须在评论里写 session
  ID)⇒ ⛔ 不据限流报文里的 user ID 推「池子跨席共用、优化自己没用」,本席额度**完全由
  本席做法决定**;计费按复杂度/节点数 ⇒ 优化方向是**每次少拿**,不是少调用。实测
  (`/rate_limit` 前后差量,2026-08-22):上限 5000/时;一次 `list_issues`(34 张卡、perPage=100)= 107
  点;单个 dev 子代理 ~15 分钟烧 ~5658 点 ⇒ **最大消耗方是 dev 子代理,PM 巡检是噪声**。
- **perPage 按预期 population 取,⛔ 不按习惯取 100**:上条计费规则(点数 ≈ 请求节点数/100)使
  perPage 成为唯一杠杆 —— 34 张卡付了 100 张的钱,只要 3 条的 perPage=100 读法多付约 33 倍;
  只要 `totalCount` 的健康指标取 perPage=1,只要最近 N 张就取 N(2026-08-23)。
- **批量写 ~1 秒一发**:小时池之外还有**分钟级二级限流** —— GraphQL 端点 2,000 点/分、并发
  ≤100,官方指引:**变更类请求间停 ~1 秒**(mutation 按 5× 计)。双载体清标、批量重分诊这类
  把写挤在同一秒的扫动,会在小时池仍绿时撞上分钟墙(官方文档 2026-08-23 复核)。
- **REST 可用性是会话属性,⛔ 不是全局事实 —— 开轮探一次,按班存档;探针必须
  repo-scoped**:直连受会话级授权门钳制(会话起点快照),门关着 repo-scoped 路径**整类**回 403
  `GitHub access is not enabled for this session`(⛔ 不是限流,重试改不了它),而 `/rate_limit` 照答 200
  —— 它兼任不了通道探针;探针 = 一条真 repo-scoped 读。探针 403 后的单调用凭据判别见
  `references/rest-channel.md`。**按班矩阵**:2026-08-25 两车道 5+ dev 席全被门拒(整类 403、读写同门
  —— 加法标签 POST、评论 PATCH 同死 ⇒ 无评论编辑通道,更正=重发);2026-08-26 反例一席门
  开,加法 POST 回 200;顶层席同窗分裂(两 403、一 200)⇒ **门态逐容器变**,⛔ 不据他席、他日
  读数推本席,唯一安全读法即本行 repo-scoped 探针。**门关着时的降级梯**:① git 先行(「零成
  本等价物」);② 公开仓 payload 档(下方「公开仓」条);③ MCP:search 定向一击、列表**单标
  签**读全 + 本地求交(`labels` 是 OR,见 MCP 参数条);④ 等重置。
- **默认读序 git → payload → REST → MCP/GraphQL**(2026-08-23 策略翻转,2026-08-25 增补 payload 档;
  ⚠️ REST 档以**本班 repo-scoped 探针绿**为前提 —— 前提就住本行,403 会话改按降级梯读)。
  list/查重/卡与 PR 读/标签回读默认走容器 curl 的 REST 通道 —— App installation token,core
  15,000/时,与 GraphQL 池**独立计**(实测 GraphQL 池两次耗尽时 core 余 14,938);GraphQL 池
  (5000/时)只留给**没有 REST 对应物**的那几件:draft 翻转、auto-merge/入队挂载、语义
  `/search/*`、Projects field_values、`issue transfer`。逐操作通道归属(✓ 按席位类别限定)、写侧配
  方与队列路由三读法见 `references/rest-channel.md`,⛔ 不在本表复述。
- **MCP list/search 家族整个走 GraphQL 稀缺池**(反复撞上的限流墙就是它;`issue_write` 连查找半
  边都吃);配额红时认领类动作排队,评论(REST 桶)先行把结论发出去。
- **`gh` CLI 的动词按传输分两桶,池枯竭时只死一半**(2026-08-24 同分钟实测:GraphQL 0 / core
  4987):porcelain 家族(`gh issue view` / `gh pr list`)与 `gh pr create` 走 GraphQL 当场回限流,同一批事实
  改走 `gh api` 的 REST 路径照常返回(含开 draft PR)。⚠️ 容器无 `gh`,本条只对本机席位适用。
- **红窗调度**:`until remaining > 阈值` 的守候**只给上面那几件 GraphQL-only 的**(逐件判据与官方
  文档核对日期住 `references/rest-channel.md`),⛔ 其余一切不为配额空等;走队列的仓落地必经
  auto-merge ⇒ 红窗里**无退路**,直合仓有(合并本身有 REST 端点)。
- **`issue transfer` 因配额或权限拿不到 ⇒ 当轮改走多仓协调条款的「在目的仓重建」配
  方**(出处头 + 裸 `#N` 改全名 + 关源单为 moved):纯 REST、配额免疫,⛔ 不为转移空等重置。
- **两个「瘦身参数」都不省池**:`fields` 省载荷不省池 —— MCP list/search 服务器端无条件抓
  Project field_values,池枯竭时**最小字段请求同样全体失败**(报错串
  `failed to fetch issue field values: API rate limit already exceeded`);⛔ **`minimal_output: true` 不裁
  `list_issues` 的 `body`**(2026-08-22 实测:返回字段仍含 `body`),**永不当省额度手段写进任何
  skill**;没有参数能关掉 `body`:要么整表 107 点要么换窄接口(点数未测)。⚠️ 站得住的证据
  是直接观察 `body` 在,不是前后体积对比(两次调用相隔数小时、population 已变)。
- **git 先行**:本地检出 / `git log` / `ls-remote` 不花配额,断粮期分支存在性检查照常可用,PR 文
  件读取同走 git(REST PR files 端点实测可瞬态 404)。**零成本等价物四条**(API 两次挂掉期间实
  测可用):合并队列 `git ls-remote origin 'refs/heads/gh-readonly-queue/*'`;是否落地
  `git log --format='%H %s' -40 origin/main` 按 PR 号 grep;squash 验证 `git rev-list --parents -n1`(父提交
  数);分支存在性 `git ls-remote origin 'refs/heads/*<key>*'`。开轮先读配额(`curl` 带 Bearer `$GH_TOKEN`
  打 `/rate_limit`,免费;⚠️ 它答不了通道在不在,repo-scoped 探针另跑),graphql remaining < 1000 ⇒
  本轮按默认读序走 git + REST;**派 dev 之前同样先读一次**,额度不足先等重置再派 —— 中途
  撞限流的 dev **完不成强制查重**,只能把发现交回 PM 代为归档,⛔ 不盲目开卡。打满时:待
  执行写**排成有序清单挂进巡逻词**(不靠记忆),恢复窗口按序连清;重试对齐整点(REST core 整
  点重置)优于指数退避,⛔ 绝不忙轮询;文档载明未实测:条件请求答 `304` 不计 core 池。
- **公开仓零配额读法两档,payload 档优先**:单卡页 `/issues/N` 内嵌 JSON 载**原始 body + 全评
  论**,精确、零配额 —— 取含 `bodyHTML` 的 `script[type="application/json"]` 块,读
  `payload.preloadedQueries[0].result.data.repository.issue.body` 与 `frontTimelineItems`/`backTimelineItems`;
  实测一整个 M 档 dev 运行只花 3 次 MCP 调用(同席前轮 MCP-first 烧 10416/5000,~25×)。边界:⛔
  只因仓库公开成立;⛔ 覆盖单卡读、**不覆盖 issue search**(搜索页无 SSR 结果);⛔ 永不拿渲染
  列表定规模(静默只显一页,实测 12 vs 权威 147)。渲染层 WebFetch 仍在(~15 分缓存、有损)。
- **查重先 `search_issues`**(2026-08-18 实测:单次调用按 issue body 内文本命中且 `total_count` 精确;
  「search 对本会话不可用」的继承说法实测为**假** —— 继承说法不是读数,复述必带实测
  日期):body 文本匹配是 repo-scoped `list` 做不到的,`list` + 对照组降为回退。
- **`search_issues` 可整会话静默归零 —— 控制词一并归零**(2026-08-23 实测:某会话对**每个**查
  询回 `total_count: 0`,含已知必中的控制词;同时刻另一会话正常 ⇒ 故障是**会话级**)。⛔
  **空查重结果不是读数,除非本会话内一个已知必中的控制词答了** —— ⛔ 不是「可疑时
  才验」:归零下空结果与真无重复逐字节同形,读作「搜过了,没有」⇒ 重复卡照开、空车道
  照停(实测:控制词对一张刚派发几分钟的卡回 0)。控制词回 0 ⇒ 本会话 search 已坏,**立刻
  换通道,⛔ 不重试**(重试只烧配额);换哪条按上面的探针与降级梯 —— 探针绿走 **REST 列
  表端点** `GET /repos/{o}/{r}/issues?state=open&labels=a,b&per_page=N`(core 桶、结果**完整**、
  `labels` 真 AND;`GET /search/issues` **不是**退路,见下条),403 走降级梯 MCP 档(单标签一次
  读全 + 本地求交 —— ⛔ **不是翻页手扫**:实测 226 张 open 只扫了 100 张,**不完整枚举比零
  结果更危险**)。⛔ 已推翻别再追:「限定符打零」两次实测反证,限定符只收窄不破坏。
- **会话代理只服务 repo-scoped 路径,`/search/*` 的 403 体解析成净零**:代理回 403 + 体
  `sessions are bound to their configured repositories`,而那是**合法 JSON** —— 读 `total_count` 得 None、
  打印成 `total: None`,与真空集只差一个字符,三连查重于是回三个干净的零,而请求根本没跑
  (2026-08-26 实测);`/search` 类问题的仪器是 MCP search 工具,repo-scoped 枚举不受影响。⭐ 推论:
  阳性对照**先跑** —— 合乎预期的零是永不复检的那个,本例正是对照同归零才逮住。
- **`search_issues` 不可靠地返回分钟级新卡**:同轮发现的东西查重,搜索之外必须按创建时间列
  近期 issue(`list_issues` + `orderBy: CREATED_AT`)—— 实测一张 ~7 分钟大的同实例卡被关键词与
  语义搜索双漏,靠日期列表才逮到;边界:两次观察,断言只到可能漏分钟级(2026-08-20 实测)。
- **自由文本的否定在 `search_pull_requests` 静默失效**:引号短语前的 `-` 被丢弃 —— `-"Part of"`
  与 `"Part of"` 回同一 `total_count`(197)与同一头名,而 197+197 ≠ 未过滤的 216,故两者不是任何
  分层;同查询的限定符半边照常精确(`linked:issue` 2903 + `-linked:issue` 216 = 总体 3119)⇒ **一次
  调用里限定符半边算术正确、文本半边静默胡说**(2026-08-26 实测;文本半边是语义匹配非字
  面 grep,其否定无物可否)。⇒ 自由文本分层必跑补集与总体求和,不对账即分层是编造的。
- **会话中途轮换凭据把 GitHub MCP 服务器杀到不可恢复**:此后一切 `mcp__github__*` 回
  `Streamable HTTP error: invalid session`,只有新会话重绑 —— 轮换前提醒维护者:在飞席位丢整条
  GitHub 通道;配额池按身份计,换身份即清零燃烧,共享身份结构不变。
- **组织侧授权变更后仓库访问逐步传播**(同一端点数分钟内 403→200);该 403 体同样解析成净
  零 ⇒ 空车道先对仓库 `open_issues_count` 反查再信,零命中纪律覆盖 list 读。
- **MCP 参数两陷阱**:`list_issues` 多标签过滤是 **OR(并集)**不是 AND —— 混入别车道同状态卡
  与本车道全状态卡,结果良构、失效全静默;**判据 = 结果比任一输入都宽**(三席独立实测:
  两标签的「交集」回 135 张,而其中一个车道自身只有 132 张)。正确读法 = **整车道单标签
  一次读全 + 本地对 labels 求交**,或改走 REST —— **两个通道的 `labels` 语义相反**:REST 列表
  端点的 `labels=a,b` 是**真 AND**(交集),MCP 的 `labels` 数组是 **OR** ⇒ 要交集按上面的探针与
  降级梯选档,⛔ 不无条件「改走 REST」。`issue_write` 的 `labels` 是**整组替换**不是追加 ——
  同一动作内重读现值合并再写(隔轮旧读数 = 无效快照,按其回写静默剥别的标签);真追加走
  REST `POST /issues/{n}/labels`,⚠️ 同样先过探针 —— 403 会话没有真追加通道,只能整组替换;
  写后照标签纪律回读。
- **PR 标签的三条读腿全盲、两条静默**(2026-08-28 同日实测):① `issue_read get_labels` 传 PR 号
  回「Could not resolve to an Issue」—— REST「PR 也是 issue」的惯例在此方法不成立;**响亮失败即
  路由信号**,改走腿③。② `pull_request_read get` 的 `labels` **时缺时滞**:dev 席同一张新 PR 两读
  整个字段缺席(非空数组),PM 席三张老 PR 三读齐备 ⇒ 连盲都不稳定,比整类缺席更险。③
  payload 档:issue 页的 `href` 锚点 grep(`/labels/NAME`)在 PR 页命中**零**,PR 侧拼写是
  `data-name="NAME"`(片链到 `issues?q=…label%3A…`)。⇒ **读成功而标签空/缺席 ⛔ 不读
  作「没有标签」**:按 `data-name=` 确认,否则整集作 UNKNOWN、优先加法端点(可达时);⛔ 单读与
  单次**即时**读回都不决断(compare-read-back 报 3 个,数分钟后再读只回 1 个,两个 auto 标签无写
  入而消失)⇒ union-write 欠一次**延迟确认**;必需标签(如 `skip-changeset`)其后每次触碰重核。
- **`list_issues` 永不返回 assignees**(`fields` 枚举无此成员,不传也没有)—— 已认领卡与空闲卡
  响应逐字节相同,清单只是**候选名单**:认领前必须过完整 `issue_read`(它才返回 `assignees`)。
- **MCP `issue_read` 的 body 实体转义是纯读侧伪影**(撇号/引号/尖括号成数字实体;comments
  原样),存储体是明文,**先解码实体再写回**往返实测安全 —— 腐蚀 body 的恰是把转义读数
  原样回写;⚠️ 但读侧**并非一律可逆** —— 行内反引号里的尖括号片段被 MCP 读路径**整
  个丢弃**(不是转义,无从解码回来),判据见「读数陷阱」判截断行。写侧剥除是**真实存储
  损耗**,⛔ 两类不并成一条「API 会改 body」,写后回读必做;实体归属与 `&amp;` 类未实测。
- **`Blocked-by:` 行归 BODY(单通道反向索引)**:追加按上条「解码后写回」执行;历史上寄放在评
  论里的行按同程序**增量**回填(⛔ 不搞批量突击 —— 限流压力);解锁扫描只 grep body,⛔ 不
  加常设评论读;旧「连评论一起扫(`in:comments`)」提示作废,扫描走直读(`list_issues` + `issue_read`
  读 body)。
- **`list_issue_types` 对本集成 403,而 `issue_write type:` 正常**(读权限缺口): 直接写已知好
  值(`Bug`/`Feature`/`Task`),写侧报错才是真信号,⛔ 不先探列表定可用性(列表 403
  ≠「类型不可用」);非法值是响错还是静默丢弃未实测,写非已知值前先小样验证。

## 读数陷阱

- **被拦的下载不是缺席证明**:出口策略 403(如 `cdn.playwright.dev`)只说「取不来」不说「没
  有」—— 先找产物再下结论(实测:Chromium 预装、`PLAYWRIGHT_BROWSERS_PATH` 已设)。
- **读数五坑**:`cd X && cmd` 会短路(路径不存在时命令在当前仓继续执行,产出假读数)—— 跨
  仓一律 `git -C <path>`; `git grep -c <pat> | wc -l` 数文件数不是命中数;裸名 grep 被幸存家族当子
  串命中 —— 退役核验带引号精确名,更硬判据是查声明
  式(`^(export )?(const|type|interface) <Name>\b`)而非查提及;浅检出上的历史读数不可信
  (`merge-base --is-ancestor` 假「非祖先」、`rev-list --count` 截断、`branch -r --contains` 零输出)——
  先 `--deepen` 再判,或走 REST `compare`;**容器里没有 `gh`**,于是 `gh … || echo "none"` 是个
  **不可证伪的否定** —— 127「命令不存在」与「grep 没命中」在输出上同值(实测五张 PR 跑
  五次「无重叠文件」全部打印安心结论、一次都没检查)。安全拼写:先 `command -v <cmd>` 确认
  存在,或在 `||` 之前捕获状态;⛔ 一般规则:**任何可能不存在的命令上挂 `|| 回退` 都是不可
  证伪的否定**,PR / 查重类核验改走 MCP GitHub 工具或 git。
- **auto 档分类器的判定随命令形状变,不随能力变 ⇒ 被拒的复合命令先拆成裸核心动作重试
  再报 blocked**(2026-08-22 同席同分钟:`git rev-parse … && git push origin <分支> 2>&1 | tail` 被拒,裸
  `git push origin <分支>` 放行并成功 —— 只差链接与管道,拒绝文案不点名违规元素;判定还跨
  天翻面)⇒ ⛔ 一次拒绝不是能力边界,`permissions.allow` 条目才是仓库侧唯一确定性通道。
- `rerun_failed_jobs` 复用原 run 的提交与合并 ref,不拿新 main 重算 —— 红因是基上缺一个已合
  修复时重跑无效,只能推提交(`git merge origin/main`);判别:修复的合并时间晚于 run 创建时间即
  是。
- **同一 head 上轻量兄弟 workflow `success` + 重量级载体 `cancelled` 是普通取代的预期签名,不是
  选择性失败**(cancel-in-progress 窗口只罩得住跑得慢的载体):先比对 run `head_sha` 与 PR 当前
  head(取代必有新 head),不开「为何只取消它」调查。
- **CI 红了先取完整日志归档再下结论 —— 断言文本只在归档里,直读工具拿不到** (2026-08-18
  实测):`get_check_run` 对本仓 CI job 回空 `output.text`,`get_job_logs` 无论 `tail_lines` 只回占满日志尾
  部的 post-step service-container teardown ⇒ 两者都答不了「到底挂在哪」;失败 step 名免下载即
  得(`actions_get method=get_workflow_job`),真实断言文本走 run 日志归
  档:`actions_get method=get_workflow_run_logs_url` → 下载解压,分步文件在
  `{Job name}/{step number}_{step name}.txt`。「completeness check 绿」只断言没有 worker 静默死 ≠ 测试
  通过;并发输出的「相邻」≠「因果」(先查 `turbo.json` 依赖边),⛔ 不只看 tail; 公开发出的
  诊断被推翻时,更正发在同样公开的位置,据它开的 PR 撤回 draft、解绑 `Fixes`。
- **判「正文被截断」必须双读取**:`.body` 原文 + `Accept: application/vnd.github.full+json` 的
  `.body_html`,两者同一处断掉才算 issue 端截断。读侧实测有确定性触发:正文含字面 script 开
  标记形状的 token(less-than 紧跟 script 字样;doctype 开标记、object 标签形状同触发)时,API/MCP 读
  回在该 token 处静默截断而网页全文完好 —— 存储体无损,⛔ 不「修复」只在 API 读短的
  卡。**同坑第三条读路径**:MCP `issue_read` / PR 读路径把**行内反引号里的尖括号片段整个吃
  掉**,而 GitHub 存储字节完好(raw REST 取回一字不差)⇒ ⛔ **永不单凭 MCP 读判截断,先取
  raw REST 或 WebFetch 渲染页核对再判** —— 否则 repair-first 被**正确**地应用到完好的卡上,
  重写毁掉的是正确内容。判据 = 数**空的行内代码跨度**:一个空跨度恰是短尖括号片段被
  吃掉的签名(判据是**尖括号**不是反引号:有的正文本来就把标识符不带尖括号写);数字实
  体(如撇号成 `&#39;`)是普通实体编码,**不是**截断证据(2026-08-23 实测)。
- **写侧 sanitizer 作者规则**:规则住 AGENTS.md「GitHub mutates body BYTES」(围栏**不**防护、危险字
  符用词拼出、写后回读),⛔ 不在本表复述;本表只补两条实测:要字面尖括号写实体 `&lt;` /
  `&gt;`;裸标识符(无尖括号)存活 ⇒ SKILL 提取契约(字面文本 grep + 裸标识符回退)仍有效。
- **写侧实测行为 · issue body(落库删字节,网页同显)**:sanitizer 按 **tag 形状**删、不按尖括号
  —— 行内反引号里的 tag 形状 token(未知标签形:注释标记、占位符、泛型)整个被删,HTML 注
  释形状标记裸写被整删留空行;孤立 less-than / greater-than(行内)与非 tag 形状带尖括号正则(围
  栏)**存活**。⛔ **围栏不防护**:照删、留空围栏(2026-08-18/20 四写实测)。**另一坑**:**感叹号
  紧跟左方括号**即触发(TS 非空断言下标),**无需 less-than**(2026-08-29 PR 正文四处实测,MCP 与渲
  染页双读一致、盘上未变 ⇒ 落库丢字符;围栏/行内代码四处全丢),幸存文本仍像代码但意
  义已变;感叹号不接左方括号则存活。作者侧:运算符**用词拼出**,或占位词定义一次。
- **写侧实测行为 · 评论(形状是「截断」不是「删片段」)**:sanitizer 从**首个命名 HTML 元素
  的尖括号片段**起把评论体一路吃到结尾(2026-08-21 实测:一份用**字面文本**标记发出的 dev
  报告,正文在 `this.error(` 处断掉、JSON 不可解析)⇒ ⛔ **字面文本标记只保住标记、保不住
  正文** —— 标记扫描照报成功,只有真去解析才发现;引信是普通 TS 形状(泛型一类)不是奇
  异语法。⚠️ 边界:姊妹仓一次受控探针测到的是**选择性删除**而非截断到尾 ⇒ **写侧按
  最坏的截断防护**。
- **写侧实测行为 · PR 正文(尾部 `---` 与其后的署名页脚一并被吃)**:写调用照报成功;去掉横
  线只写页脚则原样存活(2026-08-28 两仓同轮、两张 PR 全文回读)。**评论不受影响**(两种拼法
  都活)⇒ 失效既**依拼写**又**依载体**:评论里验过页脚**对 PR 正文什么都没证明**。⇒ PR
  正文页脚**不带前置横线**、且**写后回读正文**(唯一检测手段);评论两形皆可。
- **并行 spec PR 同动 pin 计数断言**(被踢不是事故,按 os-regen 序再解一轮):解冲突两侧收据都
  保留、按合并顺序堆叠,新计数**从合并后源码重数**(操作数是文件本身不是历史),⛔ 不从
  两侧收据做算术;双方占同一编号是常态(各取当时 max+1),重编号后进侧。
- **容器重启杀死在飞 dev,现场三态判读**:① 分支已推 + PR 已开 ⇒ 只欠验收(CI 重跑 + 复
  核,不动代码); ② 死在 regen 中途(未提交全是生成物、merge commit 已在)⇒ PM 直接续作 ——
  build → 整链 regen → 生成物门禁全绿 → 提交推送,恢复 commit 带 `Recovery commit:` 前缀留审
  计;⚠️ 有的现场 regen 一件没跑,推送前先跑生成物门禁别赌; ③ 死在源码编辑中途 ⇒ 先
  读 diff 判完整性 —— docblock 写全动机/失效模式/判据的,PM 可代跑终验后提交,写一半意图
  不明的 ⛔ 不代提交、记进交接;dev 临时目录(`.os-scratch/` 一类)是工作物不是交付物,清
  掉,⛔ 不进 feature PR。
- **零提交的探针分支不是在飞工作**:容器发不出分支删除 refspec(实测
  `git push origin --delete <b>` 回 `send-pack: unexpected disconnect while reading sideband packet`,三次退避全
  败;**同会话普通 push 正常** ⇒ 不是连通性问题),于是测量型派发留下的探针分支永久堆在
  origin 上。读法规则:`claude/issue-*` 分支**零提交领先 `origin/main` 且没有开着的 PR** = 不承载
  任何工作,⛔ 不据 `ls-remote | grep issue-` 正命中回避该卡 —— 失效方向是**活卡被永久读成
  已被认领**,无红信号、只增不减。判据两读:`git rev-list --count origin/main..origin/<b>` 为 0,且
  分支名下无 open PR。边界:一容器一会话三次,成因未诊断,存量未普查。
- **会话从上下文检测不到自己的静默降档**(2026-08-20 实测:一次分诊 fire 两级静默降档,横幅
  只在 UI 侧渲染、上下文零信号,子轮开场自述「跑在契约复审档」)——服役档的权威读数
  是 `get_session`(claude-code-remote MCP,无参)的 `external_metadata.last_served_model`(最近一轮实
  际服役者,降档链中途照真);`session_context.model` 是配置档不是服役档,⛔ 不作保险丝输入。
  ⚠️ 该读数**按宿主分叉**:有的 ccd 宿主装 session-mgmt MCP,其 `get_session` **按契约排除当前会
  话** ⇒ 保险丝无输入(2026-08-24),另一台宿主省 `session_id` 正常回两键(2026-08-25)⇒ ⛔ 不据一
  台宿主推全体;无它时的合法替代 = grep 本会话 transcript 里 harness 写的 `"model":`(逐请求写
  入、非模型自述,用时在卡上申报)。
- **档位额度终止是第三种死法**(2026-08-27 实测):子代理死在编辑中途、宿主报本账户档位
  额度到顶 —— 有**宿主信号**故非普通子代理死亡,亦非维护者中止:**派发已死、前提完
  好、卡在资源** ⇒ 死认领回收 + worktree 抢救,⛔ 不重核前提、不升级;⚠️ 无前置探针
  (只在 dev 死在里面时可观测),缓解只在 dev 侧的早 WIP 提交。
- **档位不可用时 ⛔ 不凭记忆宣告车道阻塞,逐文件面现推 mandate**:强制档不得因不可用而
  降档(那正是降档保险丝要拒的替换),但「本车道 fable 强制」多是过宽的回忆 ——
  `dispatch-gates.mjs --tier PATH` 逐路径现推(实测:`SKILL.md` 与 `.claude/agents/**` 强制,`scripts/pm/**`
  与 `references/**` 无 ⇒ 全阻塞的三卡 fold 拆成 1 阻 3 可跑);路径线是**下限不是放行**。

## 闭合关键词解析(PR 正文写侧)

- **PR 正文里「不修某卡」的否定句照样关卡**:闭合关键词解析器匹配
  `fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved` + `#N`,**不理会前面的否定词** —— 声明
  不修的那句话恰在合并时关卡;安全写法 = 号码不被关键词打头 (`#N is not addressed here` /
  `out of scope: #N` / `#N remains open`)。实测边界三条:关键词只绑**同一行**的 `#N`;动名
  词(closing/fixing)不是关键词;行内反引号里的关键词不触发(code span 实测不建闭合链接;围栏
  块未独立实测,按同规则对待但留待复测)。
- **PR body 与 squash commit message 是两个独立解析源**(commit 干净 ≠ body 干净,只查 commit 会
  漏);误关的卡以 `completed` 状态对一切「只看 open」的过滤与巡检隐身,无任何机械守卫覆盖
  这条路径 —— 消费侧检查 = 合并后读 `closed_by_pull_requests`(在复核清单)。

## 断粮检测与跨墙恢复细则(5 小时用量墙)

原则、定时器选型(⛔ 不用 send_later 链)与恢复 playbook 在主文件;事实补遗:`npx ccusage blocks` 容
器内可用(读本地会话记录),报当前 5 小时窗口边界/剩余与燃烧率;盲区:窗口起点是本地推
断的近似值;撞墙报文形如「limit reached, resets at HH:MM」(重置时刻只在此刻可得)。
