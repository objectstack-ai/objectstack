# 车道岗位说明:repo:mobile

见 cross-repo-coordination.md;本文是本席的岗位说明,现值状态恒在座位贴,⛔ 不迁入本文件。

## 形态

- 本席为姊妹仓执行座位:mobile 仓认领、派发、复核,按落地条落地;余止于 ACCEPT,归维护者。
- 按需席:维护者以指令行 `pm-dispatch mobile` 召唤;本席不建巡查 routine。
- 退席按 SKILL.md 自退四件(队列空、无在飞、无待复核、决策箱无新答复)。
- 信箱随召唤开、随退席关。
- 前提:mobile 仓的原生壳改造已进其 `main`;之前 ⛔ 不召唤本席。
- 座位贴住 mobile 仓,带 `pm:seat`;车队总表经 `fleet-roster.mjs` 默认仓列读到它。
- 存根的巡查行写 `Patrol: none — 按需席`:表明无 routine,半状态巡查只核此行在不在。
- ⛔ 不产 `domain:*`;机械三务(含首触定级)按 cross-repo-coordination.md 单车道仓条自理。

## 范围

- `objectstack-ai/mobile` 全仓:Expo 原生壳,在 WebView 中宿主平台 Console。
- 边界:业务界面与元数据渲染恒在平台 `ui/` 实现。
- ⛔ 永不在壳内原生重写 Console 已有的界面。
- 壳只收原生能力:服务器选择、推送、桥接方法、系统集成、原生加载与兜底页。
- 原生业务页只经仓内 `docs/HYBRID-SHELL.md` 的路由归属规则进入,该节四条前提缺一不收。
- 移动端发现的 Console 缺陷,立普通平台卡到 objectstack(渲染器在其 `ui/`),待分诊。
- 那是 file-at-destination、非缝卡;mobile 侧同笔挂 `pm:blocked` 加 `Blocked-by:` 回链。
- 解锁判据是修复已进平台发行版、配置的服务器可升到它;⛔ 不是上游已合并。
- ⛔ 永不在壳内绕行 Console 缺陷:绕行把平台缺口藏进壳,其余宿主从此拿不到修复。
- 桥接契约单源在仓内 `docs/HYBRID-SHELL.md`。
- 新桥接方法验收后,即在 objectstack 立 Console 消费卡。
- mobile 自己的卡(含决策卡)都住 mobile 仓:issue 住在修复落地的仓,决策入本仓收件箱。
- 无 `repo:mobile` 缝标签:今无具名读者。
- 首张跨仓次序即实质的协调卡出现时,随该卡走词表 PR 增设。

## 常设承诺

- 半状态巡查在本仓无载体:无 `half-state-patrol.yml`,无 workflow 即无锚 issue。
- ⇒ 手工半边:开新派发前整车道全交集读 open 卡。
- 逐张核交付 PR 是否已合并或关闭,先处置半状态;⛔ 无锚不等于免检。
- 壳不持 API 凭据、不调平台 API;⛔ 不重新引入 `@objectstack/*` 客户端依赖。
- `main` 上的 push 跑 `eas-build.yml` 与 `eas-update.yml`;`eas-submit.yml` 手动触发即商店提交。
- `eas-submit.yml` 与版本切割按发布动作对待(AGENTS.md 发布条),⛔ 不由席位触发。
- 本席落地(裁决评论 6578710331)非受管、不改 `.github/workflows/**`、ACCEPT 且现 head 全绿的 PR。
- 落地前读 `main` 最新 EAS Build/Update 运行:有 build/publish 步骤真跑即停落,升决策箱求新裁定。
- 设备验证无 CI 载体:需真机的验收项写进 PR `## 维护者速读` 的「需要你做的」。
- ⛔ 未上真机的项不报已验;落地不等于已上真机。
- 本仓有 `.changeset/` 而无 changeset 门禁:用户可见变更随 PR 带 changeset,席位复核时核对。
- 不扩散需求:创业阶段聚焦原则全额适用;原生能力卡第一问恒为 Web 是否真做不到。
- 框架单源在 SKILL.md 〈升级与决策〉,⛔ 不另抄。
- pm 状态机词表各仓统一,幂等创建在 `scripts/pm/ensure-pm-labels.sh`,对 mobile 实跑是落地步骤。

## 席内判断

- 收卡第一问:原生能力还是业务界面。
- 业务界面 ⇒ 转 objectstack 平台卡,本卡关 not planned 并回链。
- 原生页面化提案进决策箱,附该路由的移动端用量与 Web 端性能读数;无读数不收。
- 会话转移、桥接新增写能力、导航策略放行新来源,皆属安全边界,恒在人工地板。
- 拿不准升决策箱,⛔ 不自裁。
