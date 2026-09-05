# REST 通道操作对照表

见 `platform-readings.md` 配额段;本表是逐操作的通道归属,动手前查一行:它有没有 REST 对应物。

## 通道边界

- 出口代理按设计只放 repo-scoped 路径(`/repos/{o}/{r}/...`)加 `/rate_limit`;org 级端点未实测。
- ✓ 按席位类别限定,不是全局事实:每个 ✓ = 在一个会话门开着的席位实调通过。
- 会话门关着的席位本表两侧整表不可达:repo-scoped 读写全 403、`gh` 缺席,而 MCP 与 git 正常。
- ⇒ 先跑一条 repo-scoped 探针再选通道。
- 403 后 `/rate_limit` 判凭据形态:15000/时 = 凭据活被 repo-scoping 拒;60/时或 auth 错 = 无凭据。
- 按班矩阵与降级梯住 `platform-readings.md`,⛔ 不在本表复述。
- ⛔ 未带 ✓ 的形状不当已验证事实复述。

## 读侧 —— 全部可迁移

- ✓ 按标签/状态列卡 `GET /repos/{o}/{r}/issues?state=open&labels=a,b&per_page=N`,`labels=` 是真 AND。
- ⛔ 完整性自证不跟 `Link: rel="next"`:游标枯竭停在 102,而页号走法得 287 与 448 且与总数符。
- ⇒ 改走 `&page=N` 到短页为止,再用 `GET /repos/{o}/{r}` 的 `open_issues_count` 减开放 PR 核总数。
- ⛔ 未核总数的枚举不是读数;成因未知,处方不依赖该头,⛔ 不把已修写成已解释。
- 关键词阳性对照结构上看不见本类:必中卡落在首页照样绿,只有计数核对逮得住。
- ⛔ 查重必须含 closed:卡刚关闭时最易被重开,开域查重漏掉刚关闭的同题卡即重复派发。
- 开域查重是要申报的例外,不是默认;状态与标签列卡仍 `state=open`,那是状态读不是查重。
- ✓ 卡与 PR 元数据 `GET .../issues/{n}` · `GET .../pulls/{n}`,assignees、labels、body 齐全。
- MCP `list_issues` 永不返回 assignees,这条差别本身就是走 REST 的理由。
- ✓ 整条评论线 `GET .../issues/{n}/comments?per_page=100`。
- ✓ Timeline 事件 `GET .../issues/{n}/timeline`:cross-ref、`added_to_merge_queue`、ready_for_review。
- ✓ PR diff `GET .../pulls/{n}` 带 Accept `application/vnd.github.diff`;文件清单 `.../pulls/{n}/files`。
- 后者可瞬态 404 ⇒ PR 文件读取优先走 git。
- ✓ 取某 ref 上的文件 `GET .../contents/{path}?ref=...`,raw accept。
- ✓ 祖先与对比 `GET .../compare/{base}...{head}` —— 浅检出上本地祖先判据不可信时的正解。
- ✓ 门禁与 workflow `GET .../commits/{sha}/check-runs` · `GET .../actions/runs`。
- ✓ 配额自读 `GET /rate_limit`,端点自身零计费。

## 写侧 —— 全部可迁移

- ✓ 评论 `POST .../issues/{n}/comments`;改评论 `PATCH .../issues/comments/{id}`。
- ✓ 标签加法 `POST .../issues/{n}/labels`,定向删 `DELETE .../issues/{n}/labels/{name}`。
- 加法写剥不掉并发席位刚挂的标签,比 MCP `issue_write` 的整组替换安全。
- 门关席位无此端点 ⇒ 回退 = MCP 读现值、并集、整组写、读回;读回是它安全的全部理由。
- ✓ 建卡带标签 `POST .../issues` · 改正文 `PATCH .../issues/{n}` · 认领 `POST .../issues/{n}/assignees`。
- ✓ 请求复审 `POST .../pulls/{n}/requested_reviewers` · 开 PR `POST .../pulls` 带 `draft=true`。
- GraphQL 池为 0 的同一分钟里开得出 draft PR ⇒ 交付不必等重置。
- ✓ 把 `origin/main` 合进 PR head:`PUT .../pulls/{n}/update-branch`,PM 席位可用。
- 它是零文件写的合 main 手段,产出真合并提交、不重写历史。
- `expected_head_sha` 必须是完整 40 字符 SHA,短 SHA 回 422。
- base 未动回 422 no new commits on the base branch = 无事可做,不是失败。

## 不可迁移 —— 只有这几件,围着它们排计划

红窗守候规则住 `platform-readings.md` 配额段。

1. draft 转 ready 翻转:GraphQL-only mutation;出口代理只放钉住的 PR-review GraphQL 集。
   判据 = REST update-a-pull-request 只收 `title`/`body`/`state`/`base`/`maintainer_can_modify`,无 `draft`
   (与第 5 条同批核对官方文档,未逐个实调)。断粮出路:等 MCP 恢复,或人工点一下。
2. auto-merge 与入队挂载:GraphQL mutation,即 MCP `enable_pr_auto_merge`。
   走合并队列的仓落地必经它 ⇒ 配额红窗无退路;直合仓有退路 `PUT .../pulls/{n}/merge`。
3. 语义搜索:`/search/*` 被出口代理按设计拒绝。退路 = REST 列表端点加本地 grep。
   REST 也被会话门关掉的席位 = 一次定向 MCP `search_issues`,⛔ 不宽表扫。
4. Projects field_values:GraphQL-only —— 舰队并不需要它;MCP 服务器端无条件抓它才是漏点。
5. `issue transfer`:issues 端点表无 transfer 路由 ⇒ 同为 GraphQL-only。
   拿不到时当轮改走在目的仓重建配方,配方住 `platform-readings.md`。

## 第三桶 —— git 零配额等价物

- 分支存在性、队列分支、判落地、squash 验证四条的拼写与边界住 `platform-readings.md`。
- 本表只指路,⛔ 不在两处各存一份;先问 git,再问 REST。

## 队列路由的读法

- `merged_by` 是入队者,⛔ 不是绕队证据:队列合并归属给入队的账户,对队列与直合零分辨力。
- 问本仓 auto-merge 是否经队列,答案来自尝试动作,不来自属性字段。
- 判据 ①:直接合并 `PUT .../pulls/{n}/merge` 在强制队列 ruleset 下回 405。
- ②:PR 上的 `added_to_merge_queue` timeline 事件。③:对已入队 PR 调 update-branch 回不能更新。
- ①② 的拼写与边界住 `platform-readings.md` 队列段,本条只归拢判据。
- 队列 required 集按 job 与 check-run 名匹配,workflow 名从不作为 check context 出现,搜也搜不到。
- 改任一 job 名或 test 分片矩阵的形状,必须同一笔更新队列 required 集,否则队列静默挂起。
- 姊妹仓 objectui 配置为 9 个:`Lint` · `Type Check` · `Test (shard 1/4 … 4/4)`。
- 其余三个:`Build & E2E` · `Build Docs` · `Changeset Declaration`。
- ⛔ required 选择只 gate 等待、不 gate 触发:未列入的检查照跑、算力相同,红了不再挡队列。
- 配 required 集先排掉 push-only job:`if: github.event_name == 'push'` 的 job 在 `merge_group` 上不报到。
- 列为 required 即挂死队列;未展开的矩阵名(带字面 `${{ }}` 的串)是占位符,不是真 context。
