# 15.1 发布测试清单

> 范围:framework `@objectstack/*@15.0.0 → 15.1.0`(87 commits, 65 changesets)+
> 配套 Console `objectui 14.0.0 → 14.1.0`(94 commits,framework 钉在 `b8967495be73`)。
> 环境:`examples/app-showcase` + `objectstack dev --ui --seed-admin`(独立端口 + 独立 file DB)。
> 标注:🖥 = 浏览器验证;🔌 = API/CLI 验证;🤖 = 已有自动化钉死(dogfood/e2e 测试,CI 覆盖)。

## A. 安全加固(本次最大主题)

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| A1 | 静态 `readonly` UPDATE 强制 | 🔌🤖 | REST PATCH 一个 `readonly: true` 字段 → 该字段被 strip,响应中值不变;`isSystem` 写不受影响 | #2948/#2957/#3003,`showcase-static-readonly.dogfood.test.ts` |
| A2 | `readonlyWhen` 多行 UPDATE 强制 | 🔌🤖 | bulk update 命中任一锁定行 → 字段对整批丢弃 | #3042 |
| A3 | `owner_id` 锚点:insert 伪造/update 转移拒绝、批量 stamp | 🔌🤖 | 非特权用户 insert 他人 owner_id → 拒;bulk insert 空 owner → stamp 为当前用户 | #3004/#3018,`owner-anchor-and-bulk-writes.dogfood.test.ts` |
| A4 | bulk write 按 owner/RLS write filter 收窄 | 🔌🤖 | member 对 OWD-private 对象 `update({multi:true})` → 只命中自己行 | #2982 |
| A5 | 引擎级联豁免(删用户 set_null 不被 A3 拦) | 🔌🤖 | 删除 sys_user → 其拥有记录 owner_id 被正常清空,级联不中断 | #3023/#3048 |
| A6 | `$expand` 强制被引对象 RLS/FLS | 🔌🤖 | 以受限用户 `?expand=` 引用 → RLS 隐藏行不返回、FLS 字段掩码 | #2850/#2961 |
| A7 | public form 剥离 server-managed 锚点 | 🖥🔌 | 公开表单渲染不出现 owner_id/organization_id 等;POST 携带被剥离 | #3022/#3036 |
| A8 | 匿名 deny 全 HTTP 面统一 | 🔌🤖 | 未登录 `POST /graphql`、raw `/data` → 401(`requireAuth` 默认) | #2567 系列,`showcase-anonymous-deny-surfaces.dogfood.test.ts` |
| A9 | MCP `run_action` 需 `ai.exposed`,fail-closed | 🔌 | 未声明 action 经 MCP 调用被拒;声明后可调且入 audit log | #2964 |
| A10 | reports IDOR / 定时报表 RLS / RAG fall-open | 🔌🤖 | 跨 owner 按 id 读/删 saved report → 拒 | #2980/#2981/#2975 |
| A11 | OWD 保存门:packaged 对象只能收紧 sharingModel;`external ≤ internal` | 🖥 | Studio 里把 packaged 对象 OWD 往宽改 → 保存被拒;OWD 总览 inline 校验 | #3050 + objectui#2508 |
| A12 | 附件访问链(读继承 parent、下载 401/403+签名 URL、attach 需 parent EDIT) | 🖥🔌🤖 | 见 C 组;非授权下载 → 401/403 | #2755/#2970 |
| A13 | sharing rule seed-not-clobber + capability scope seed-once | 🔌 | 管理员改动不被重启 seed 覆盖 | #2909 |
| A14 | better-auth 1.7.0-rc.1(GHSA 修复)登录链路 | 🖥 | 登录成功且后续请求 200(sys_jwks alg/crv 列) | #2974 |

## B. 声明式 Connector(ADR-0096/0097)

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| B1 | provider-bound 实例 boot materialization | 🔌🤖 | showcase live `provider:'mcp'` demo:boot 后 `GET /api/v1/automation/connectors` 有该实例,`origin:'declarative'` | #2994/#3062 |
| B2 | flow designer connector picker 标注声明式实例 | 🖥 | connector_action 节点下拉列出实例并带标注 | objectui#2563 |
| B3 | 上游不可达 → degraded husk + 退避重试,恢复原子换入 | 🔌 | 断掉 upstream 重启 → boot 不挂,descriptor `state:'degraded'` | #3049 |
| B4 | declarative stdio 默认拒绝,host allowlist opt-in | 🔌 | 未 opt-in 的 stdio 实例 → boot fatal/reload skip | #3059 |
| B5 | openapi spec 文件路径(package 相对,拒绝逃逸) | 🔌 | `providerConfig.spec: './openapi.json'` 可解析;`../` 拒 | #3024 |
| B6 | descriptor-only 契约 boot 审计 | 🔌 | actions 无运行时注册 → boot warning;`enabled:false` 静音 | #2985 |

## C. 附件 v1

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| C1 | 记录详情 RecordAttachmentsPanel 认证上传/下载 | 🖥 | 上传成功;下载经签名 URL;无权限时友好拒绝文案 | objectui#2532 |
| C2 | 发票行 per-line Receipt(inline grid 内上传单元格) | 🖥 | showcase Invoice → 行内 Receipt 列出现上传控件 + chips/缩略图,非文本框 | #3051 + objectui#2585 |
| C3 | 附件读继承 parent 可见性 | 🔌🤖 | 受限用户列附件 → 不可见 parent 的行与计数均不出现 | #2970 |
| C4 | sys_file 孤儿 tombstone/reap + upload_session 报废(abort multipart) | 🔌🤖 | 生命周期测试覆盖 | #2755/#2970 |

## D. Dashboard 全局筛选

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| D1 | Revenue Pulse:filter bar 驱动多图表 | 🖥 | 切 filter/日期预设 → 多 widget 同步 re-scope;opt-out widget 不动;dirty 出 Reset | #3038/#2576 |
| D2 | widget inspector 可视化 filterBindings 编辑 | 🖥 | Studio 选中 widget → "Dashboard filter bindings" 区,开关 Apply/换字段 | objectui#2586 |
| D3 | spec-form filter options 不再崩 dashboard;select 显示 label | 🖥 | 有 `{value,label}` options 的 dashboard 正常渲染 | objectui#2597 |

## E. Console 核心体验(objectui 14.1)

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| E1 | Record 级 inline edit:共享 draft + 单次原子 Save | 🖥 | 双击正文字段 + highlight 各改一处 → 同一 Save 条;Network 仅一次 update(只含改动 key + ifMatch);Esc/Cmd+Enter | objectui#2542/#2549/#2604 |
| E2 | 多按钮 record header(order + primary tie-break,⋯ 溢出) | 🖥 | ≥3 动作对象详情页头并排按钮;Delete/Share 进 ⋯ | objectui#2574 |
| E3 | related list 权限门控 | 🖥 | 对子对象无 read 权限用户 → section 整体不渲染 | objectui#2565 |
| E4 | kanban:stageField 默认 lane + highlightFields 默认卡片 | 🖥 | 未配 lane/cardFields 的看板按语义角色渲染 | objectui#2596/#2541 |
| E5 | 拼音搜索:列表快搜/lookup picker/⌘K 输 `zw` 命中中文 | 🖥 | showcase 种子开箱可演示 | #3027/#3034 |
| E6 | conditional tabs(page:tabs item visibleWhen) | 🖥 | 谓词为 FALSE 时整个 tab 消失,变量变化 live 重估 | #2967 + objectui#2516 |
| E7 | B3 级联选项:client re-filter + server 拒绝 | 🖥🤖 | cascading-select fixture;live e2e 已钉 | #3006 + objectui#2547/#2562 |
| E8 | GB18030 CSV 导入 | 🖥 | 导入 GBK 编码 CSV → 中文表头正常、可映射 | objectui#2557 |
| E9 | toast 不再因 error 对象崩页(React #31) | 🖥 | 触发 400 的操作 → 可读 toast,页面不白屏 | objectui#2580 |
| E10 | Studio/metadata-admin 跟随应用 locale | 🖥 | 切 en/zh → Studio 同步切换,无混语言 | objectui#2602 |
| E11 | 活动 feed/audit 摘要 workspace locale 本地化 | 🖥 | zh 环境下动词模板 + 对象 label 中文 | #3045/#3029 |
| E12 | Create User:param 可翻译 + 显式密码胜出 | 🖥 | zh 下对话框字段中文;输显式密码不报 400 | #3030/#3031/#3033 |
| E13 | action visible 三陷阱(os.user.* 别名/record_more/报错谓词 warn) | 🖥🤖 | `locations:['record_more']` 动作出现在 ⋯ 菜单 | objectui#2611 |

## F. Studio(设计期)

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| F1 | CEL formula 编辑器:推断结果类型、summary 结构化 roll-up | 🖥 | `record.amount * 1.1` → Result type: Number;裸字段名报错给修法 | objectui#2609 |
| F2 | 字段条件规则 CEL 编辑器(visibleWhen/readonlyWhen/requiredWhen) | 🖥 | `previous.` 成员补全 + did-you-mean | objectui#2571 |
| F3 | list-view 条件格式化编辑器(first-match-wins) | 🖥 | 加 CEL+颜色规则 → 运行时行着色 | objectui#2558/#2544 |
| F4 | RLS 编辑器 lint/补全/test-run | 🖥 | 每策略选记录试跑命中 | objectui#2533 |
| F5 | Access:OWD 总览批量编辑 + 深链 + external≤internal 校验 | 🖥 | 见 A11 | objectui#2508 |
| F6 | Access:unsaved 三连守卫(矩阵/pillar SPA 导航/OWD 行) | 🖥 | 不保存点走 → confirm;取消保留编辑 | objectui#2588/#2606/#2610 |
| F7 | 只读包锁定权限矩阵 | 🖥 | read-only 包矩阵置灰、无 Save | objectui#2570 |
| F8 | AccessExplainPanel record 粒度 + 三态溯源徽标 | 🖥 | 选记录 → visible 结论横幅 + 逐层归因 | objectui#2502/#2501 |
| F9 | flow palette 搜索/键盘导航/云同步 recents | 🖥 | 搜索框 + ↑↓ Enter;recents 分组 | objectui#2543/#2553 |
| F10 | Decision Branches 行内 Target 选择 | 🖥 | 表内选目标 → 画布连边;清除只断边 | objectui#2568 |
| F11 | Page/View inspector 不崩(lazySchema × toJSONSchema) | 🖥 | Studio 打开 Page/View 编辑面 → 无 `setting 'ref'` 崩溃 | #3021 |
| F12 | package spec-form modal + namespace 前缀编辑期强制 | 🖥 | New package modal;"+ new object" 自动 `<ns>_` 前缀 | objectui#2535/#2524 |
| F13 | feature-gated action UI 门控 | 🖥 | 关插件 → 相关按钮消失而非 404 | #2965 + objectui#2536 |

## G. 平台 / 协议 / 部署(API·CLI 面)

| # | 项 | 方式 | 验证要点 | 来源 |
|---|---|---|---|---|
| G1 | `aggregate_records` MCP 工具走 ENGINE 读路径 | 🔌 | RLS/tenant 与 find 一致;FLS 输入门 fail-closed | #2976 |
| G2 | standalone authored action 上 MCP 桥 | 🔌 | Studio 授权独立 action `ai.exposed:true` → list_actions 可见 | #3010/#3020 |
| G3 | packages REST:PATCH 路由/POST 重复 409/install overwrite | 🔌 | 三条包管理修复 | #2995/#2971/#3007 |
| G4 | ADR-0087:durable-package rehydration 握手 + `migrate meta --from 10` | 🔌 | 不兼容包结构化拒载,boot 继续 | #2972 |
| G5 | honest capabilities:discovery 不虚报 realtime/stub 状态 | 🔌 | discovery JSON 无 `/realtime` 虚假路由 | ADR-0076 slice |
| G6 | `kernel:bootstrapped` + `app:seeded` membership backfill | 🔌 | seed 完成后无需重启即有 membership | #2989/#3000 |
| G7 | Docker 镜像 + 脚手架 container-ready | 🔌 | `docker run` + `/api/v1/health` 200 | #2952/#2979 |
| G8 | tenancy strict block:未知 key 响亮 parse error + tombstone | 🔌 | `strategy:` 残留 → 报错含迁移指引 | #2962 |
| G9 | 拼音 `__search` 伴随列 boot backfill + reconcile | 🔌 | 存量行重启后可拼音搜到 | #3027 |
| G10 | REST 403 透传 / 未知 `$` 参数 400 | 🔌 | 记录级 403 带 code;`$bogus=1` → 400 UNSUPPORTED_QUERY_PARAM | #2926 ⑦⑩ |

## 回归门(发布前必须全绿)

- [ ] `pnpm build` 全绿(71 包)
- [ ] `pnpm test` 全绿(含 dogfood 套件:owner-anchor / static-readonly / anonymous-deny / attachments matrix / detail-shapes e2e / MCP connector CI-pinned demo)
- [ ] objectui `e2e/live/showcase-smoke.spec.ts`(全 showcase surface 白屏/空图表/占位符泄漏扫描)
- [ ] `pnpm check:release-notes`(release 页 drift guard)
- [ ] `os validate` 对 examples(schema+表达式+widget 三道门)
