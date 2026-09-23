# REST 通道操作对照表

见 `platform-readings.md` 配额段;本表是逐操作的通道归属,动手前查一行:它有没有 REST 对应物。

## 通道边界

- 出口代理按设计只放 repo-scoped 路径(`/repos/{o}/{r}/...`)加 `/rate_limit`;org 级端点未实测。
- ✓ 按席位类别限定:每个 ✓ = 会话门开着的席位实调通过,⛔ 无 ✓ 不当已验证事实。
- 403 后 `/rate_limit` 判凭据形态:15000/时 = 凭据活被 repo-scoping 拒;60/时或 auth 错 = 无凭据。
- 两只桶:MCP 记链接用户 5000/时,兄弟会话共享同桶;REST/CCR 记 App 安装 15000/时。
- `objectstack-fleet[bot]` 经 `fleet-write` 中继:四个写工具与 `with-fleet.sh --via auto` 共一选择器。
- 三条件全立才 `dispatch`:`CCR_AGENT_PROXY_ENABLED=1`、会话 id、中继活着;否则 `direct`,印一行。
- 会话 id 由容器 `CLAUDE_CODE_REMOTE_SESSION_ID` 派生;`OS_FLEET_SESSION` 只覆盖本地检出与测试。
- ⛔ 永不把它前缀在命令前:允许规则是字面前缀,带前缀的写落到分类器,席位就此卡死。
- 活着 = 工作流文件在 `main` 且 Actions 状态 `active`;维护者在 Actions UI 停用即整队回 `direct`。
- dispatch 带会话令牌发往 objectstack;run 在 runner 上以逐次铸造、窄到目标仓的 App 令牌执行。
- 闭合 op 表住 `scripts/pm/fleet-write/ops.mjs`;读侧不走中继。
- 正文超 60,000 字节的那一笔 `post-stamped` 写走 `direct` 并印一行,身份是席位自己的用户。
- run 失败(post-stamped/close-cards 4,label-write/issue-create 5)与 UNCONFIRMED(6)只读,⛔ 永不重试。

## 读侧 —— 全部可迁移

- ✓ 按标签/状态列卡 `GET /repos/{o}/{r}/issues?state=open&labels=a,b&per_page=N`,`labels=` 是真 AND。
- ⛔ 完整性自证不跟 `Link: rel="next"`:游标枯竭停在 102,而页号走法得 287 与 448 且与总数符。
- ⇒ 改走 `&page=N` 到短页为止,再用 `GET /repos/{o}/{r}` 的 `open_issues_count` 减开放 PR 核总数。
- ⛔ 未核总数的枚举不是读数;成因未知,处方不依赖该头,⛔ 不把已修写成已解释。
- 关键词阳性对照结构上看不见本类:必中卡落在首页照样绿,只有计数核对逮得住。
- ⛔ 查重必须含 closed:卡刚关闭时最易被重开,开域查重漏掉刚关闭的同题卡即重复派发。
- 开域查重是要申报的例外,不是默认;状态与标签列卡仍 `state=open`,那是状态读不是查重。
- ✓ 卡与 PR 元数据 `GET .../issues/{n}` · `GET .../pulls/{n}`,assignees、labels、body 齐全。
- ✓ 整条评论线 `GET .../issues/{n}/comments?per_page=100`。
- ✓ Timeline 事件 `GET .../issues/{n}/timeline`:cross-ref、`added_to_merge_queue`、ready_for_review。
- ✓ PR diff `GET .../pulls/{n}` 带 Accept `application/vnd.github.diff`;文件清单 `.../pulls/{n}/files`。
- ✓ 线程 `GET .../pulls/{n}/ccr/review_threads` 回 `{resolved,outdated,path,line,comment_ids}`,无线程 id。
- ✓ 取某 ref 上的文件 `GET .../contents/{path}?ref=...`,raw accept。
- ✓ 祖先与对比 `GET .../compare/{base}...{head}` —— 浅检出上本地祖先判据不可信时的正解。
- ✓ `GET .../commits/{sha}/check-runs` 门禁、`GET .../actions/runs` workflow、`GET /rate_limit` 配额零计费。

## 写侧 —— 全部可迁移;允许规则按首个 glob 前的字面前缀匹配:verb 紧跟裸 url,`-H`/`-d` 后置

- ✓ 评论 `POST .../issues/{n}/comments`;改评论 `PATCH .../issues/comments/{id}`。
- ✓ 标签加法 `POST .../issues/{n}/labels`,定向删 `DELETE .../issues/{n}/labels/{name}`;加法优先。
- ⛔ `post-stamped`/`label-write` 永不接进管道再 `&&`:拒收读成 0;看尾先落文件或 `set -o pipefail`。
- ⛔ 永不 MCP `issue_write`(锁 1 已拒);会话分类器拒改动 ⇒ 无通道,交有通道席位立卡。
- ✓ 建卡带标签 `POST .../issues` · 改正文 `PATCH .../issues/{n}` · 认领 `POST .../issues/{n}/assignees`。
- ✓ 该 `PATCH` 带 `state` 关卡/重开,`state_reason` 交付 `completed`、撤单 `not_planned`,走裸 REST。
- 请求体走文件(`-d @file`)或引号定界 heredoc(`<<'EOF'`),⛔ 永不内联双引号串。
- ✓ 请求复审 `POST .../pulls/{n}/requested_reviewers` · 开 PR `POST .../pulls` 带 `draft=true`。
- ✓ `origin/main` 合进 PR head:`PUT .../pulls/{n}/update-branch`,PM 席位、零文件写、真合并提交。
- `expected_head_sha` 须完整 40 字符 SHA(短 SHA 回 422);base 未动回 422 = 无事可做,不是失败。
- ✓ draft 转 ready `curl -sS -X POST .../pulls/{n}/ccr/ready_for_review -d '{}'`,反向 `.../ccr/convert_to_draft`。
- ⛔ 裸 `PATCH /pulls/{n}` 带 `{"draft": false}` 回 200 零改;状态码不作数,`GET /pulls/{n}` 才作数。
- 线程自己建:`POST .../pulls/{n}/comments` 带 `commit_id`·`path`·`line`,回读看 `review_threads`。
- ✓ `POST .../ccr/comments/{id}/resolve` · `/unresolve`;`{id}` 是评审评论 id,⛔ 只在自己 PR 上探。
- ✓ auto-merge 挂载 `curl -sS -X PUT .../pulls/{n}/ccr/auto_merge -d '{"merge_method":"SQUASH"}'`,`DELETE` 卸载。
- ⛔ `PUT .../ccr/auto_merge` 在 draft 上 422 零存储;`DELETE` 无挂载回 422 = 本就没挂,非失败。
- 直合仓 `PUT .../pulls/{n}/merge`;actor 记令牌类,按账号非会话、逐写回读;见配额段,MCP 恒用户。

## 不可迁移 —— 只有这三件,围着它们排计划;红窗守候规则住 `platform-readings.md` 配额段

1. 语义搜索:`/search/*` 被出口代理按设计拒绝。退路 = REST 列表端点加本地 grep。
2. Projects field_values:GraphQL-only —— 舰队并不需要它;MCP 服务器端无条件抓它才是漏点。
3. `issue transfer`:issues 端点表无此路由(未实调)⇒ 同为 GraphQL-only;配方住 `platform-readings.md`。

## 第三桶 —— git 零配额等价物

- 分支存在性、队列分支、判落地、squash 验证四条的拼写与边界住 `platform-readings.md`。
- 本表只指路,⛔ 不在两处各存一份;先问 git,再问 REST。

## 队列路由的读法

- `merged_by` 是入队者,⛔ 不是绕队证据:队列合并归属给入队的账户,对队列与直合零分辨力。
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
