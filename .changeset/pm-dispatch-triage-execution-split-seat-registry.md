---
---

docs(pm-dispatch): 协调模型改版 —— 纵向拆分(分诊/执行)+ 一人一车道双射 + 登记表正文即真相 + 座位 Routine 化,`engine` 域一分为二 (#5472)

维护者 2026-08-05 拍板的 PM 协调模型改版落到 `.claude/skills/pm-dispatch/SKILL.md`。
背景是三笔实测成本:#4604 三天累积 79 条登记评论,「现状」与「历史」同通道使对账
成本随评论数线性涨;全局在飞检查是 O(PM 数 × 在飞数) 的每轮常备税,判据却只是自由
文本申报;objectstack 是最大的仓,单 PM 的认知吞吐不够,同仓多 PM 必须保留 —— 于是
把协调税改成结构性防撞。

- **Multi-repo coordination rule 4 重写为「纵向拆分 + 双射」**:1 个**分诊 PM**
  (全仓唯一,只扫/分类/打标签/拆跨域/查重,⛔ 永不认领派发)+ N 个**执行 PM**
  (信任标签、跳过分诊、只在本车道认领)。分诊座位是 `domain:*` 的**唯一生产者**,
  「未打标签不可认领」因此第一次有机械保障;执行座位发现误标只上报、不改标签。
  每个执行 PM 恰好一个 `domain:*` 车道(双射),旧的 **borrowing 越界许可删除**
  (全文只留一处墓碑句):突发积压调频率/`batch`,持续积压**拆域**走 PR。
- **跨域例外路径成为唯一越界通道**:分诊座位指定单一车道 PM 认领 + 认领评论申报
  完整文件面 + **定向**在飞检查。全局在飞检查从每轮常备税**降级为该路径专用**,
  并写明触发条件(当且仅当认领跨域例外单)与检查范围(申报文件面所触及的域,
  不是全仓)。
- **座位表协议(#4604)**:正文表格 = 唯一权威现状,行 = 座位(分诊 + 各域 +
  姊妹仓整仓)、列 = 座位 | 范围 | 当前 PM | 说明,接管/移交 = **就地编辑那一行**
  + 一条审计评论;评论只作交接审计、不承载状态。**无心跳**,活性惰性判定(Routine
  座位查 `last_fired` / `next_run`,会话座位查最近产出评论),仅在接管冲突时评估,
  >24h 无产出可回收。**epic 委托退回 `pm:epic` 父单正文**登记(`label:pm:epic`
  即全量索引,座位表不重复记);`packages/spec` 恒归 `domain:spec` 座位。
- **rule 5 补 org Project 的分层定位**:Project 是**视图层**(auto-add workflow
  按 `pm:*` / `domain:*` / `repo:*` 聚合三仓),**没有任何机器读它**,且因只有
  GraphQL 入口(配额 5000/时,Operational note 3 实测一天三次归零)**绝不进循环
  热路径**;权威层坚持 issue 正文 + REST(core 配额 15000/时,独立计)。
- **域表重切**:`domain:engine` 拆为 **`domain:engine-core`**(objectql /
  metadata\* / platform-objects / core / formula / plugin-pinyin-search)与
  **`domain:drivers`**(`plugins/driver-*` 四个),并写明存量 `domain:engine`
  由分诊座位按落点改标、清零后删旧标签,座位表同批加行。拆分后每包仍恰好一域。
- **座位 Routine 化的运行形态**(补进「Dispatch backends」/「Collect」/ step 9):
  每座位一个 cron Routine(fresh session per fire),频率随队列深度独立调;每次
  fire 读 #4604 正文拿范围 → 从 labels 重建状态 → 跑一轮 → 结束。轮次互斥采用
  「fire 开始查上一轮产出时间,间隔不足即自退」。⛔ 如实记录 #5474 试点实测的运维
  约束:经 CCR **会话内** `create_trigger` 创建的 Routine **不携带 GitHub 连接器**,
  fired session 拿不到 `mcp__github__*` → 静默零产出(2026-08-05 烟测近 50 分钟零
  写入,已回滚),座位 Routine 必须由维护者从 claude.ai Routines UI 带连接器创建,
  且创建后先手动 fire 一轮烟测按 GitHub 产出验收;模型不能经 API 钉住
  (`update_trigger` 返回 `model_update_disabled`),Routine 继承环境默认模型。
- **round loop 职责划分表**:step 0 与 step 2 的分类半边属分诊座位,step 1、3–9
  属执行座位;分诊座位空缺时由会话型执行 PM **代扫**(只做分诊动作,不跨车道认领)。
  step 0 补三处扫描排除(`tracking` / `status:parked` / 座位表本身)与每轮限量。

仅改 `.claude/` 内部 agent 协议文本,不发布任何包;空 frontmatter 仅为满足 changeset
门禁。刻意未动:`.claude/agents/os-dev.md`(在飞 #5441 的领地)、已发布目录
`skills/objectstack-pm-dispatch/`(发布内容另单)、#4604 正文本身(issue 正文由 PM
落地,本 PR 只改 SKILL 引用使其与实态一致)。
