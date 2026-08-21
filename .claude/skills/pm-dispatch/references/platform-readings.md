# 平台读数事实表(references —— 按需加载)

出处:主文件「平台读数纪律」。本表是 GitHub API / 工具行为的**实测事实**,在做对应
操作的那一刻查阅;原则住在主文件。⛔ 本表不引用 issue 编号 —— 每条自含失效模式与边
界。

## 队列成员资格与 auto-merge

- **「本仓是否强制队列」是仓库 ruleset 事实**:`grep merge_group` 答的是另一个问题
  (队列内是否重跑 CI),两者独立、缺席不构成反证(实测:某仓 ruleset 强制而无
  trigger,队列照收 PR、由 PR 上下文的 check run 满足);权威读数 = 合并尝试本身(回
  405 `Changes must be made through the merge queue`)或 rulesets API;姊妹仓不一致(objectos 2026-08-18 起有队列,hotcrm 只有 ruleset)⇒ 新仓落地约定靠实测确立,⛔ 不由缺席推断(2026-08-20 实测)。
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
- **PR 转回 draft 同时掉 auto-merge 与队列成员资格,均不自动恢复**(转正后必须重
  新挂);反方向同理:要真踢出队列只有转 draft —— `disable_pr_auto_merge` 单独调用**不解除队列成员资格**,PR 照样落地。
- **`enable_pr_auto_merge` 一律显式传 `mergeMethod: "SQUASH"`**(不传时静默退回被
  禁的 merge-commit 方式 = 无操作);**回显两向不可靠**(实测:队列路径回显空而入
  队照发;显式传 SQUASH 回显 `MERGE`,落地仍每 PR 一提交)⇒ 权威信号只有 timeline 入队事件与最终 MERGED,⛔ 不拿回显当任何方向的证据。
- enable 后的验证序列:① 先验队列分支(给条目 ~20–30s 建出);② 分支在 ⇒ 结束,
  ⛔ 不翻转;③ 等待后仍缺席**且队列已见 churn**(更新的条目建出了分支而你的没有 ——
  截断下单纯缺席不充分;首挂静默不入队实测存在,churn 后翻转即愈)⇒ 翻转一次
  (`disable` → `enable`),翻转后仍以 timeline 事件验证;④ ⛔ enable 与它的队列验
  证之间永不插 `disable` ——「入队」webhook 可能乱序迟到,armed 窗口里补的 disable 会把已发生的真实入队撤掉。
- **队列踢出先认签名再决定重投**:已知 flaky 核对失败签名一致 ⇒ 原样重投;止血修
  复合入后**同一签名再现就不再是那条 flaky**,是新问题必须重新诊断,⛔ 禁止条件反
  射式重投;第三种签名:本 PR 名下**没有任何** `merge_group` run 且批次同伴的 run
  全部 `success` = 队列重建的连带取消不是红 —— 带签名读数收据重投一次(收据留在
  PR 上),⛔ 无收据不重投;同一 PR 第二次被踢 ⇒ 停止重投,按签名四分支重判。
- **实测吞吐参数两则**:合并队列落地延迟 ≈ 每 PR 15–30 分钟且串行(⛔ 不据「还没
  落」提前判异常);单容器重验证(build+test)并发甜点 ≈3,排批按它定并发上限。

## API 配额

- GraphQL 配额(5000/时)极易打满,**MCP list/search 家族整个走 GraphQL 池** ——
  反复撞上的限流墙就是它;「读与评论走 REST(core 15000/时,独立计)」预设会话真有
  REST 通道:MCP 读工具无 REST 替身,直连 REST 受会话级授权门(会话起点快照,403
  `GitHub access is not enabled for this session`)与出口代理(只放 repo-scoped
  路径,`/search/*` 被拒、`/rate_limit` 例外)钳制 —— **纯 MCP 会话撞上枯竭池 =
  重置前没有任何 list 通道**,降级读法 = 下文 git 先行与 WebFetch 两行;只有无
  REST 对应物的写才花 GraphQL,`issue_write` 连查找半边都吃 —— 配额红时认领类动作排队,评论(REST 池)先行把结论发出去。
- **`fields` 瘦身省载荷不省池**:MCP list/search 服务器端无条件抓 Project
  field_values —— 池枯竭时**最小字段请求同样全体失败**,报错串 `failed to fetch issue field values: API rate limit already exceeded`。
- **git 先行**:本地检出 / `git log` / `ls-remote` 不花配额,断粮期分支存在性检查
  照常可用,PR 文件读取同走 git(REST PR files 端点实测可瞬态 404);开轮先读配额
  (免装 gh CLI:`curl` 带 Bearer `$GH_TOKEN` 打 `/rate_limit`),graphql
  remaining < 1000 ⇒ 本轮降级为 git 先行 + 只做必要写。打满时:待执行写**排成有序
  清单挂进巡逻词**(不靠记忆),恢复窗口按序连清;重试对齐整点(REST core 整点重置)优于指数退避,⛔ 绝不忙轮询;
  search 与 core 独立计,一侧打满另一侧可作退路;REST core 共享身份下同样会打满;文档载明、未实测:条件请求答 `304` 不计 core 池(仅当直连 REST 获准才相关)。
- **公开仓降级读法:WebFetch github.com 网页零 API 配额**(带 label 过滤的 issue
  列表、issue 全文含评论、PR 页含 checks,实测撑得起整轮盘点);边界:~15 分钟缓存、列表行不含 assignee、内容是渲染层。
- **查重先 `search_issues`**(2026-08-18 23:3xZ 实测:单次调用按 issue body 内文本命中且 `total_count` 精确 ——「search API 对本会话不可用/回错误对象」的继承说法实测为**假**;继承说法不是读数,复述必须带实测日期):body 文本匹配是 repo-scoped `list` 做不到的(全量抓取再 grep 才等价),`list` + 对照组降为回退。
- **`search_issues` 不可靠地返回分钟级新卡**:同轮发现的东西查重,搜索之外必须按创建时间列近期 issue(`list_issues` + `orderBy: CREATED_AT`)—— 实测一张 ~7 分钟大的同实例卡被关键词与语义搜索双双漏掉,靠按日期列表才逮到;边界:两次观察、索引延迟未实测,断言只到「search 可能漏掉分钟级 issue」,更硬的窗口要另测(2026-08-20 实测)。
- **会话中途轮换凭据把 GitHub MCP 服务器杀到不可恢复**:此后一切 `mcp__github__*`
  回 `Streamable HTTP error: invalid session`(含几分钟前还好的工具),只有新会话
  重绑 —— 轮换前提醒维护者:在飞席位丢的是整条 GitHub 通道;配额池按身份计,换身份即清零燃烧,共享身份结构不变。
- **组织侧授权变更后仓库访问逐步传播**(同一端点数分钟内 403→200);403 错误对象存
  盘仍是合法 JSON,期待列表的脚本会静默报假「0 issues」—— 零命中纪律覆盖 list 读:空车道先对仓库 `open_issues_count` 反查再信。
- **MCP 参数两陷阱**:`list_issues` 多标签过滤是 **OR(并集)**不是 AND —— 混入别
  车道同状态卡与本车道全状态卡,结果良构、失效全静默;正确读法 = **整车道单标签一
  次读全 + 本地对 labels 求交**。`issue_write` 的 `labels` 是**整组替换**不是追加
  —— 同一动作内重读现值合并再写(隔轮旧读数 = 无效快照,按其回写静默剥别的标签);真追加走 REST `POST /issues/{n}/labels`;写后照标签纪律回读。
- **`list_issues` 永不返回 assignees**(`fields` 枚举无此成员,不传也没有)—— 已
  认领卡与空闲卡响应逐字节相同,清单只是**候选名单**:每条认领前必须过完整 `issue_read`(它才返回 `assignees`),⛔ 不把清单当候选集直接认领。
- **MCP `issue_read` 的 body 实体转义是纯读侧伪影**(撇号/引号/尖括号成数字实体;
  comments 原样),存储体是明文,**先解码实体再写回**往返实测安全(无双重转义)——
  腐蚀 body 的恰是把转义读数原样回写;可逆的只有读侧,写侧剥除(HTML 注释、tag
  形状片段 —— 细则见「读数陷阱」写侧行)是**真实存储损耗**,⛔ 两类不并成一条「API 会改 body」,写后回读因此必做;实体归属(MCP 还是 GitHub API)与 `&amp;` 类未实测。
- **`Blocked-by:` 行归 BODY(单通道反向索引)**:追加按上条「解码后写回」执行;历
  史上寄放在评论里的行按同程序**增量**回填(⛔ 不搞批量突击 —— 限流压力);解锁扫
  描只 grep body,⛔ 不加常设评论读;旧「连评论一起扫(`in:comments`)」提示作废,扫描走直读(`list_issues` + `issue_read` 读 body)。
- **`list_issue_types` 对本集成 403,而 `issue_write type:` 正常**(读权限缺口):
  直接写已知好值(`Bug`/`Feature`/`Task`),写侧报错才是真信号,⛔ 不先探列表定可
  用性(列表 403 ≠「类型不可用」);非法值是响错还是静默丢弃未实测,写非已知值前先小样验证。

## 读数陷阱

- **读数四坑**:`cd X && cmd` 会短路(路径不存在时命令在当前仓继续执行,产出假读
  数)—— 跨仓一律 `git -C <path>`;`git grep -c <pat> | wc -l` 数文件数不是命中数;
  裸名 grep 被幸存家族当子串命中 —— 退役核验带引号精确名,更硬判据是查声明式
  (`^(export )?(const|type|interface) <Name>\b`)而非查提及;浅检出上的历史读数不可信
  (`merge-base --is-ancestor` 假「非祖先」、`rev-list --count` 截断、`branch -r --contains` 零输出)—— 先 `--deepen` 再判,或走 REST `compare`。
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
- **落库删字节,网页同显、围栏不防护**:「less-than + 感叹号 + 左方括号」序列(markup-declaration 开标记,恰是负向后行断言接字符类的形状)里的感叹号在存储层被删,幸存文本仍像代码但意义已变;裸「less-than + 感叹号」存活;作者规则并入下一条。
- 写侧另一半:sanitizer 在**写入时按 tag 形状删,不按尖括号**(2026-08-18 issue body 实测):行内反引号里的 tag 形状 token(读作未知 HTML 标签者 —— 注释标记、`<n>` 类占位符、泛型)整个被删;孤立 less-than / greater-than 在行内代码**存活**;⛔ **围栏不防护 tag 形状 token**(2026-08-20 issue body 三写实测,推翻旧「围栏块整体存活」读数):HTML 注释形状标记裸写被整删留空行,入围栏照删留空围栏;非 tag 形状的带尖括号正则在围栏中实测存活(2026-08-18,上一条删感叹号仍另计);同日实测同类标记在**评论**里存活 —— 损耗是 body 独有的不对称;裸标识符(无尖括号)存活 ⇒ SKILL 提取契约(字面文本 grep + 裸标识符回退)仍有效;写返回 200,损耗只在回读可见。
  作者规则一条管三坑:必须字面携带 tag/script/markup-declaration 形状的文本进围栏并把危险字符用词拼出,或改花括号占位符(`{n}`)/整句用词描述;要字面尖括号写实体 `&lt;` / `&gt;`;含尖括号的任何写后回读逐个确认(失效完全静默;评论名义上是不受影响通道,2026-08-18/19 实测 4 次评论写入 1 次标记缺席、未归因 —— 回读不豁免评论)。
- **并行 spec PR 同动 pin 计数断言**(被踢不是事故,按 os-regen 序再解一轮):解冲
  突两侧收据都保留、按合并顺序堆叠,新计数**从合并后源码重数**(操作数是文件本身不是历史),⛔ 不从两侧收据做算术;双方占同一编号是常态(各取当时 max+1),重编号后进侧。
- **容器重启杀死在飞 dev,现场三态判读**:① 分支已推 + PR 已开 ⇒ 只欠验收(CI 重
  跑 + 复核,不动代码);② 死在 regen 中途(未提交全是生成物、merge commit 已在)
  ⇒ PM 直接续作 —— build → 整链 regen → 生成物门禁全绿 → 提交推送,恢复 commit 带
  `Recovery commit:` 前缀留审计;⚠️ 有的现场 regen 一件没跑,推送前先跑生成物门禁
  别赌;③ 死在源码编辑中途 ⇒ 先读 diff 判完整性 —— docblock 写全动机/失效模式/判
  据的,PM 可代跑终验后提交,写一半意图不明的 ⛔ 不代提交、记进交接;dev 临时目录(`.os-scratch/` 一类)是工作物不是交付物,清掉,⛔ 不进 feature PR。
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
