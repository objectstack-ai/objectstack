# 复核清单细则

见 SKILL.md 〈复核〉;本文逐项展开每份 dev 报告的复核判据,对着它过。

## PR 形态与卡片关系

- PR 存在、是 draft、目标 `main`,正文首行引用卡片。
- `Fixes #<n>` 仅当合并应当关卡;只落地了可实施的一半 ⇒ 必须 `Part of #<n>`。
- 否则合并静默关掉决策箱里的卡,而收件箱过滤只看 open。
- 切 `Part of` 的正文最易再武装自动关闭:否定句、记账句、引号包裹,解析器一律照关。
- 安全拼法 = 卡号旁零动词,关闭安排写进评论。
- 闭合关键词两读:翻 ready 前亲核首行、亲扫全正文,⛔ 关键词永不挨另一张 open 卡编号。
- 这是合并前唯一的人工关口,⛔ 不只信报告;合并后那一读见 `landing-operations.md`。
- `Part of` 收口的卡不会自动关,`pm:dispatched` 必须手工摘,动作要件见落地细则 B。
- ACCEPT 那一刻记进落地待办,⛔ 不留给下次巡检。

## 范围与 changeset

- 取 changed files 核范围,⛔ 不看报告自述。
- 三条判据:无 `content/docs/releases/` 改动、用户可见改动有 changeset、无与卡无关的文件。
- Tests/docs-only 按仓库分流:本仓库走 `skip-changeset` 标签,⛔ 不走空 changeset。
- 空 changeset 在本仓库滞留发布;含读者可见生成产物时 dev 改选 changeset 亦对。
- objectui 无此标签,空 frontmatter changeset 即正确形态;⛔ 永不要求或铸出该标签。
- 就地修范围外的邻接缺陷 ⇒ 四条件逐条核:同缺陷类、机械、无他人认领、同门禁族。
- 再核 claim 文件面同轮已修订、PR 正文点名该修并载证据;缺一条即判 REWORK。
- 每个被触及的包,`private: false` 即已发布 ⇒ 读 `package.json` 核 changeset 在不在。
- ⛔ 判据不是改动大小,也不是用户可见的感觉判断;⛔ 缺了不入队。

## 测试与门禁证据

- 测试证据要有真实命令与通过输出,⛔ 不接受一句 tests pass。
- 测量类交付先看阳性对照:对照本身失败 ⇒ 该读数记 INCONCLUSIVE,⛔ 不入账。
- 引 entry `.d.ts` 逐字节相同的读数必须同块带阳性对照,它只判名字集。
- 对 barrel 已转发符号的形状恒无效:`export *` 与 `export type { X } from` 都不复述形状。
- 判据是同块点名声明该符号的模块那份移动了的产物,或具名探针;缺则记 INCONCLUSIVE。
- 报告证据里有 git 本可回答的 API 读吗:`list_issues`/`search_issues` 一类,或重跑去重读数。
- ⛔ 不因此判 REWORK,ACCEPT 照给,但把这条记进 ACCEPT 评论。
- CI 收敛读数只属于复核侧:dev 的契约是草稿 PR 时点交报,gate `in_progress` 是诚实读数。
- 翻 ready、挂 auto-merge 或入队前,亲核 Lint & Repo Gates 与 TypeScript Type Check 两个 job。
- 两个 job 的 `conclusion` 都须为 `success`,门禁族跑在其内;⛔ 不因报告写了本地绿跳过。
- 两 job 只是 required 地板,入队资格另要求全部 check 全绿;真绿跑法见 `true-green.md`。
- 收敛期转红走补丁轮续派原 dev,⛔ 不作 REWORK 的理由;重量级卡可在派发令写本单等 CI。
- 每个门禁读数先钉到 PR 当前 head:比对 run `head_sha` 与 `head.sha`,不一致的双向都不入账。
- ⛔ 非当前 head 上的 `cancelled` 零动作、永不重跑:新推送自带全套 run。
- dev 本地并集同样先钉 head:最后一次提交之后跑,`git rev-parse --short HEAD` 抄进报告与正文。
- 与 PR 当前 `head.sha` 比一次,对不上即死树读数、双向都不入账;没抄 ⇒ 按没有读数处理。
- 复核后又推提交而 HEAD 未动 ⇒ 补跑并集(至少棘轮族)再更新报告。

## 断言与收益

- 收益穿过必经边界之后还在吗:价值主张依赖下游如实转发时,至少端到端验一次。
- 必经边界含 HTTP 错误信封、序列化、日志汇聚、跨进程传输;⛔ 不是每单都做。
- 裁决实施 PR:grep 消费层(REST 信封测试、objectql、runtime)确认旧立场零拷贝。
- 且真正非法形状的拒收断言仍逐字在,这是派发侧两句的对账。
- 拒收类用例的绿是不是它抛了的绿:判据是验收点含应当被拒收。
- 抽查 diff 里的拒收用例有没有断言 `code` 与 `status`(ADR-0112 信封)。
- 只写 `toThrow()` 或 `rejects.toThrow()` 的用例在未修实现本就抛裸 Error 的那族上恒绿。
- 缺 `code`/`status` 断言判 REWORK 补齐,⛔ 不接受绿色输出。
- N 个包全绿要问清方向与时序,否则不算清扫证据;判据是含跨包签名收窄或契约收紧。
- 问一:filter 用的是前缀 `'...pkg'`(下游消费者)还是后缀 `'pkg...'`(上游依赖)。
- 问二:typecheck 之前建过依赖闭包吗;没建则读的是陈旧 `dist/*.d.ts`,绿可能是假绿。
- 两问都没答案 ⇒ 以全仓门禁结论为准,或判 REWORK 要证据。

## 前提、停条件与删除

- dev 验证过 issue 的前提吗:`premise_still_valid: false` 是再分诊输入不是失败。
- dev 纠正 PM 要当众认:更正落在 PR 或 issue 评论,错前提的正文另立跟进卡。
- 报告清掉了它被要求停下的停条件 ⇒ 亲核证据再 ACCEPT。
- 判据是它报的证据面(搜了什么、找到什么)加 PM 自己在 `origin/main` 上的复核。
- ⛔ 不接受结论散文:绕过去的报告与守约的长得一样。
- 验收判据本身也可被证伪:dev 用测量推翻字面判据、换上更强的不变量门禁照 ACCEPT。
- 但推翻过程必须写在 PR 正文并附 main 语料上的实测信噪比,否则按 REWORK 要证据。
- `+0/-0` 不是空文件的证明:NUL 字节让 git 当二进制渲染,还让文件对 grep 隐身。
- 先疑 NUL,以 blob 定论 `git show <sha>:<path> | wc -l`,要求源侧写转义序列。
- 以死代码或不可达为由的删除,PM 在 `origin/main` 上用带引号精确名自己核一次引用面。
- 核过再 ACCEPT:这是断言不是 diff 里的事实,而这一查只花十秒。
- 卡的交付物含系统性 sweep 时,ACCEPT 评论把范围外产出成组列出并写明 sweep 判据。
