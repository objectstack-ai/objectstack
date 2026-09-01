# REST 通道操作对照表(references —— 按需加载)

出处:`platform-readings.md` API 配额段(**默认读序 git →
payload → REST → MCP/GraphQL** 的策略住那里,本表是逐操作的通道归属)。做一件事之前查一行:
它有没有 REST 对应物。⛔ 不引用 issue 编号 —— 每行自含边界与日期。

**通道边界**:容器 curl = App installation token,REST core 15,000/时、与 GraphQL 池独立计;出口代理按设
计只放 **repo-scoped 路径**(`/repos/{o}/{r}/...`)加 `/rate_limit`,org 级端点未实测。⚠️ **✓ 按席位
类别限定,不是全局事实**:下文每条 ✓ = **2026-08-23 在一个会话门开着的席位实调通过**(未另
标日期者同此日);2026-08-25 实测 os-dev 子代理席与部分顶层席被会话门整类拒 —— repo-scoped
读**写**全 403 `GitHub access is not enabled…`、`gh` 缺席,MCP 与 git push 正常 —— 那类席位本表读
写两侧**整表不可达**:先跑一条 repo-scoped 探针再选通道,403 后 `/rate_limit` 单调用判凭据形
态(15000/时 = 凭据活、被 repo-scoping 拒;60/时或 auth 错 = 无凭据);按班矩阵与降级梯住
`platform-readings.md`。⛔ 未带 ✓ 的形状不当已验证事实复述。

## 读侧 —— 全部可迁移(MCP list/search 家族才是 GraphQL 燃烧源)

- ✓ 按标签/状态列卡:`GET /repos/{o}/{r}/issues?state=open&labels=a,b&per_page=N` —— `labels=` 是**真
  AND**(MCP `list_issues` 的 labels 数组是 OR;语义相反那条住 `platform-readings.md`)。
- ⛔ 完整性自证,**不跟 `Link: rel="next"`**:2026-08-31/09-01 两仓实测,游标自称枯竭停在 102,页号走
  法得 287/448、与 `open_issues_count` 符 ⇒ 改走 `&page=N` 到短页为止,再用 `GET /repos/{o}/{r}` 的
  `open_issues_count`(含 PR,减开放 PR)核总数;⛔ 未核总数的枚举不是读数。⚠️ 成因未知(GitHub
  游标 vs 出口代理改写 `Link`):处方**不依赖该头**,⛔ 不把「已修」写成「已解释」。⚠️
  关键词阳性对照**结构上**看不见本类(必中卡落在首页照样绿),只有计数核对逮得住。
- ⛔ **查重必须含 closed**:卡刚关闭时最易被重开(2026-08-31 双向实测:开域查重漏掉 6 小时前
  刚关闭的同题卡 ⇒ 重复派发;含闭卡那次命中已关闭同形卡 ⇒ 免开重复)。开域查重
  是**要申报的例外**,不是默认;状态 / 标签列卡读仍 `state=open` —— 那是状态读,不是查重。
- ✓ 卡 / PR 元数据:`GET .../issues/{n}` · `GET .../pulls/{n}`(assignees、labels、body 齐全 —— MCP
  `list_issues` 永不返回 assignees,这条差别本身就是走 REST 的理由)。
- ✓ 整条评论线:`GET .../issues/{n}/comments?per_page=100`。
- ✓ Timeline 事件:`GET .../issues/{n}/timeline`(cross-ref、`added_to_merge_queue`、ready_for_review)。
- ✓ PR diff / 文件清单:`GET .../pulls/{n}` 带 Accept
  `application/vnd.github.diff` · `.../pulls/{n}/files`(后者实测可瞬态 404 ⇒ PR 文件读取优先走 git)。
- ✓ 取某 ref 上的文件:`GET .../contents/{path}?ref=...`(raw accept)。
- ✓ 祖先 / 对比:`GET .../compare/{base}...{head}` —— 浅检出上本地祖先判据不可信时的正解。
- ✓ 门禁 / workflow:`GET .../commits/{sha}/check-runs` · `GET .../actions/runs`。
- ✓ 配额自读:`GET /rate_limit`(端点自身零计费,开轮先读的就是它)。

## 写侧 —— 全部可迁移

- ✓ 评论:`POST .../issues/{n}/comments`;改评论 `PATCH .../issues/comments/{id}`。
- ✓ 标签:**加法** `POST .../issues/{n}/labels` + **定向删** `DELETE .../issues/{n}/labels/{name}` —— 比
  MCP `issue_write` 的整组替换安全:加法写剥不掉并发席位刚挂的标签(整组替换按隔轮旧读数
  回写会静默剥标,纪律住 `platform-readings.md`)。会话门关着的席位无此端点(2026-08-25 多席实
  测 403)—— 回退 = MCP 读现值→并集→整组写→**必做读回**,读回是回退安全的全部理由。
- ✓ 建卡带标签 `POST .../issues` · 改正文/状态 `PATCH .../issues/{n}` · 认领
  `POST .../issues/{n}/assignees`。
- ✓ 请求复审 `POST .../pulls/{n}/requested_reviewers` · 开 PR `POST .../pulls`(带 `draft=true`;GraphQL 池为 0
  的同一分钟里实测开得出 draft PR ⇒ 交付不必等重置)。

## 不可迁移 —— 只有这几件,围着它们排计划(红窗守候规则住 `platform-readings.md` 配额段)

1. **draft → ready 翻转**:GraphQL-only mutation;出口代理只放钉住的 PR-review GraphQL 集(实测拒绝)。
   判据 = REST update-a-pull-request 只收 `title`/`body`/`state`/`base`/`maintainer_can_modify`,**无 `draft`**
   (2 与 5 同批:2026-08-24 核对官方文档,未逐个实调)。断粮出路:等 MCP 恢复,或人工点一下。
2. **auto-merge / 入队挂载**:GraphQL mutation(MCP `enable_pr_auto_merge`)。走合并队列的仓落地必经它 ⇒
   配额红窗**无退路**;直合仓有退路(合并本身有 REST 端点 `PUT .../pulls/{n}/merge`)。
3. **语义搜索**:`/search/*` 被出口代理按设计拒绝。退路 = REST 列表端点 +
   本地 grep(既有纪律);REST 也被会话门关掉的席位 = 一次定向 MCP `search_issues`,⛔ 不宽表扫。
4. **Projects field_values**:GraphQL-only —— 舰队并不需要它;MCP 服务器端**无条件**抓它才是漏点,
   不是需求。
5. **`issue transfer`**(2026-08-24 官方文档核对补入):issues 端点表无 transfer 路由 ⇒ 同为
   GraphQL-only。拿不到时当轮改走「在目的仓重建」配方 —— 纯 REST、配额免疫,配方住
   `platform-readings.md`。

## 第三桶 —— git 零配额等价物(先问 git,再问 REST)

分支存在性、合并队列分支、按内容判落地、squash 验证:四条 `ls-remote` / `git log` 拼写与各自
的失效边界是 `platform-readings.md` 的既有正典行,本表只指路 —— ⛔ 不在两处各存一份。

## 队列路由的读法(2026-08-24 实测)

- **`merged_by` 是入队者,⛔ 不是绕队证据**:队列合并归属给**入队的那个账户**,对「队列 vs 直
  合」零分辨力(一周内三席据人形 `merged_by` 误判「绕队」,三次全假 —— 都是队列合并)。
- **问「本仓 auto-merge 是否经队列」,答案来自尝试动作,不来自属性字段**:① 直接合并
  `PUT .../pulls/{n}/merge`,强制队列 ruleset 下回 **405 `Changes must be made through the merge queue`**;② PR
  上的 `added_to_merge_queue` timeline 事件;③ 对已入队 PR 调 update-branch 回「已入队分支不能更新,
  要改先出队」。①② 拼写与边界是 `platform-readings.md` 队列段既有行,本条只归拢判据。
- ⚠️ **计数不是机理读数(被当天推翻的推断的墓碑)**:「`GET .../actions/runs?event=merge_group`
  计数 0 ⇒ required 集为空」提出当天即被自身推翻 —— 同一姊妹仓 2026-08-24 首现 merge_group
  run(0 → 8),同日再测 224(阳性对照 `event=pull_request` 全程非零)。计数答「至今发生过没有」,
  不答「机制在不在」:零计数只作**弱先验**,判 required 集为空要读 ruleset
  的 required 集本身、或看队列合并是否真在等检查;⛔ 别处写下的计数值一律先复测再用。
- **required job 名与分片矩阵的改名耦合(现行,自 2026-08-24)**:
  队列 required 集按 **job / check-run 名**匹配,**workflow 名从不作为 check context 出现**(所以拿
  workflow 名在选择器里搜什么也搜不到);改其中任一 job 名**或 test 分片矩阵的形状**,
  必须**同一笔**更新队列的 required 集,否则队列静默挂起。
  姊妹仓 objectui 当日配置为 **9 个**:`Lint` · `Type Check` ·`Test (shard 1/4 … 4/4)` · `Build & E2E`
  · `Build Docs` · `Changeset Declaration`。⛔ required 选择只 gate**等待**、不 gate**触发** ——
  未列入的检查照跑、算力相同,红了不再挡队列(维护者当日裁定,原话:「我觉得够了」)。
- **配 required 集时先排掉 push-only job**:
  `if: github.event_name == 'push'` 的 job 在 `merge_group` 构建上永不报到,列为 required 即挂死队列;
  未展开的矩阵名(带字面 `${{ }}` 的串)是被跳过的占位符,不是真 context。
