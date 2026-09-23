# ObjectStack 北极星

**我们是什么**:一个应用开发平台;创业阶段。

**给谁**:第三方开发者,AI 代理为主、人验收——AI 进入我们的元数据协议写应用,人看结果、拍板。应用的终端用户是企业里的业务人员,他们通过 Agent 和界面使用应用。

**做出来的是什么**:**AI 原生的企业管理应用**——业务对象与记录、看数据的视图、能用的表单、真挡得住的权限、审批与自动化、经营报表、登录与身份、可对外的 API、文件、客户的语言,以及不写代码在运行中改应用。AI 原生的意思:应用自带一个能替用户操作它的 Agent——本仓(社区版)通过 MCP 把对象与动作暴露出去,用户接入自己的 Agent;企业版把 Agent 内置在用户界面里,那一半住 cloud 仓。缺任何一样就不是这个应用。这一行是定义,不是清单;每一项做到什么、怎么验证,在 `docs/qa/platform-checklist/`。参考实现 hotcrm。

**什么算做好**:一个建在协议上的应用,过了验证才算做好——它的元数据对应的清单项在一次 run 里通过,`objectstack verify` 在它上面是绿的。没过验证的交付不算 done。

**唯一的度量,那条路**:一个新的 AI 开发者(人在旁验收)从 `npm create objectstack` 出发:写元数据 → 本地跑起来、看到 → 验证响亮拒绝错的、放行对的 → 发布并装进一个环境 → 接一个 Agent(社区版走 MCP),让它在应用里完成一次真实业务操作 → 按客户一句话需求迭代一次。每周真走一遍,结果落一张 run record。第一个断掉的步骤就是当前的 P0;跑得通但结果错的是 P2。

**路上的功能点**:平台要做出来的功能点,一行一个,按那条路的步骤排;自上而下就是顺序 —— 这张表就是路线图,改它即改优先级。每行 `轴 · 功能点(业务语言) · 清单区 · 项 id`,一个功能点从协议到运行时到前端是一整条;`docs/qa/platform-checklist/` 里的每一项都恰好属于这里的一行(未写的项标「清单项待写」)。id 不带前缀时属于它前面那个清单区,跨区的写全名。

**① 出发:`npm create objectstack` 起项目,写元数据**

- devpath · 一条命令起一个项目:脚手架、装好、验证通过、控制台首屏画得出来 · cli · scaffold-first-run, scaffold-console-first-paint
- devpath · 构建是作者的第一道关:错误带位置,产物与统计出得来 · cli · build-own-contract
- devpath · 写进元数据的代码片段有边界:钩子与动作体拒绝越界写法 · cli · hook-body-extraction-gates
- studio · 不写代码建对象、字段、列表、表单与记录页 · studio-authoring · object-designer-roundtrip, view-authoring-live, record-page-roundtrip
- studio · 自定义页面:块组合、页面变量与页面级动作、三档源码 · studio-authoring · custom-page-render-and-blocks, page-variables-and-actions, custom-page-source-tiers
- studio · 先草稿后发布:发布是原子的,冲突与非法草稿当场被拒 · studio-authoring · draft-publish-lifecycle, authoring-validation-not-persisted
- studio · Studio 的判定与边界:表达式与引擎一致、权限矩阵编得动、注册表决定什么能在运行中改 · studio-authoring · expression-editors, permission-matrix-editor-ux, org-override-registry-gate
- studio · 管理员在界面里写 Markdown 文档并加到菜单(含 book),按受众发布成门户 · studio-authoring + platform-core · 清单项待写, platform-core.docs-audience-gate, platform-core.docs-portal-render

**② 本地跑起来、看到 —— 终端用户在应用里用到的能力,都在这一步第一次被需要**

- devpath · 一条命令把应用跑起来:健康与就绪都通、数据库选择诚实、端口与陈旧都说出来 · cli + platform-core · dev-boot-contract, platform-core.boot-health, platform-core.runtime-config-boot-read
- devpath · 种子数据原样落库,重放不多不少 · platform-core · seed-integrity, seed-mode-matrix
- devpath · 登得进去,外壳记得住:导航、自带应用、收藏与最近、主题、快捷键、返回键 · platform-core · console-login, nav-surfaces-render, builtin-apps-nav-render, shell-nav-personalization, theme-mode-persistence, keyboard-shortcut-surface, url-overlay-contract, home-admin-cluster-links, console-installability-indicators, app-management-toggle
- devpath · 平台设置在界面里改:改完真的生效、留痕、密钥只存句柄 · platform-core · settings-hub-roundtrip
- devpath · 遥测与生命周期数据按保留期回收,声明了归档的对象绝不热删 · platform-core · lifecycle-retention-sweep
- devpath · 元数据注册表对外可读,只有可写的包改得动 · platform-core · metadata-registry-serving, metadata-authoring-roundtrip
- records · 一条记录建出来、看见、改掉、删掉,也能照着再建一条 · records-forms · crud-roundtrip, record-clone-contract
- records · 每种字段都渲染得出、收得下、存得住,错的当场拒 · records-forms · field-type-matrix, field-type-constraints, field-unique-enforcement, encrypted-field-behavior
- records · 列表能干活:筛选、搜索、排序、分页、保存视图、行内编辑、导出、批量 · records-forms · list-view-capabilities, view-type-gallery, adhoc-filter-sort-builder, grid-personalization, saved-view-management, bulk-select-all-matching
- records · 看板、日历、甘特是能拖的,不是图片 · records-forms · kanban-drag-persistence, calendar-interactions, gantt-interactions
- records · 表单能用:布局、脏数据守卫、联动显示与必填、级联选项 · records-forms · form-view-gallery, form-dirty-guard, conditional-rules-header, conditional-rules-grid, cascading-options, cascading-multilevel-and-clear, field-group-visible-when
- records · 主从一起存、相关列表在服务端分页、查找框里顺手新建 · records-forms · master-detail-atomic-save, related-list-server-pagination, lookup-picker-create-new
- records · 写入规则在服务端兑现,撞车响亮、后悔得了、改过什么看得见 · records-forms · validation-rule-type-matrix, object-hook-lifecycle, delete-behavior-matrix, concurrent-edit-conflict, record-edit-undo, field-history-tracking
- records · 记录上的动作与协作:按钮在声明的位置、参数契约在派发时兑现、讨论与 @ 提醒 · records-forms · action-location-matrix, action-param-widgets, upload-guard-blocks-confirm, record-discussion-mentions
- records · 搜得到:跨字段、字段限定、权限一致、拼音、即时新鲜;全局搜索与命令面板同一条路 · search · cross-field-object-search, field-scoped-narrowing, rls-both-personas, pinyin-flag-both-sides, freshness-and-empty, console-global-search, command-palette-navigation
- access · 行级与字段级权限两边都对:受限成员只看自己的,该只读的只读、该看不见的不回给前端 · access-security · rls-both-sides, scope-depth-asymmetry, fls-mask-and-strip
- access · 增删改查逐格兑现,改完权限立刻换脸,自查接口与服务端一致 · access-security · crud-permission-matrix, permission-matrix-edit-loop, me-permissions-aggregation-parity
- access · 写入路径挡得住:只读剥离、伪造与转移 owner 被拒、默认可见度只能收紧 · access-security · write-path-guards, owd-save-gate
- access · 共享:默认基线、规则放宽、单条手工共享、建议的绑定 · access-security · owd-sharing-matrix, sharing-rules-widen, record-share-grant-revoke, sharing-rule-authoring-ui, suggested-binding-loop
- access · 匿名进不来:每个 API 家族统一拒,且先于任何资源解析;没有活跃组织也是合法状态 · access-security · anonymous-deny-surfaces, no-active-org-session-semantics
- access · 对外开的小门:公开表单与分享链接,能收回、不泄露 · access-security · public-form-intake, share-link-capability-tokens, share-link-landing-page
- access · 说得清也查得到:逐层归因的访问解释、审计浏览、记录查看留痕、平台管理员身份本身挡得住 · access-security · record-access-explain, audit-log-browser, record-view-read-audit, platform-owner-email-anchor
- identity · 登录方式按配置开关,广告出来的就是真能用的 · identity-auth · auth-method-matrix, sso-enforced-first-paint, phone-signin-surfaces
- identity · 第一次装好就有主人:零用户首跑、注册闸门、邮箱验证 · identity-auth · first-run-owner-bootstrap, self-signup-gate, email-verification-loop
- identity · 自己回得来、自己改得动:忘了密码、改资料、看得见也收得回会话 · identity-auth · self-service-password-reset, self-service-profile-password, session-list-revoke
- identity · 两步验证:开启、验证、备份码、关闭 · identity-auth · two-factor-enrollment-reveal, two-factor-verify-to-activate, two-factor-backup-codes, two-factor-disable-lifecycle
- identity · 组织、团队与业务单元,以及管理员的用户运维 · identity-auth · org-membership-team-management, teams-bu-membership, invitation-scope-gates, workspace-org-switch, admin-lifecycle-operations, identity-import-wizard
- identity · 对外身份:OAuth 授权与社交账号绑定 · identity-auth · oauth-app-consent-loop, linked-accounts-social
- workflow · 审批走得完:会签、法定人数、动态审批人、超时升级、请假代理 · approvals · per-group-signoff, quorum-m-of-n, dynamic-approver-routing, sla-escalation, ooo-delegation-reroute, approver-resolution-matrix
- workflow · 审批在界面里做:收件箱、记录页按钮、键盘流、待办计数、通知直达 · approvals · inbox-metadata-actions, viewer-gating-submitter-side, record-page-decisions, inbox-keyboard-flow, pending-count-surfaces, account-app-entry, setup-nav-entry, notification-deep-link
- workflow · 审批的每个动作都由服务端状态机兜底,邮件一键也是同一条路 · approvals · decision-action-matrix, decision-only-via-service, status-mirror-field, email-action-token-door
- workflow · 流程跑得起来:节点类型、触发类型、运行树与日志 · automation · flow-node-type-matrix, trigger-type-matrix, flow-run-step-nesting, flow-runs-page-test-trigger, trigger-status-contract
- workflow · 流程的出错、暂停与定时:try/catch、屏幕流、冷重启接着跑、汇总与时间触发、开关即刹车 · automation · flow-error-handling, screen-flow-roundtrip, durable-suspend-restart, rollup-summary-filter, time-relative-trigger, flow-toggle-kill-switch
- reports · 图表画得出来、类型齐、空数据体面、写错的键响亮;钻得下去、全局筛选重新取数 · dashboards · chart-first-paint, chart-type-matrix, empty-null-bucket-boundaries, strict-widget-rejects-stray-keys, drill-through-range, global-filters-rescope
- reports · 报表自己建、自己存、只归自己,还能按时自己发出去 · dashboards · dataset-report-authoring, saved-report-ownership, report-schedule-dispatch-delivery
- reports · 经营数字对得上:系统总览与分析立方体 · dashboards · system-overview-live-counts, cube-query
- files · 传得上、下得来,权限跟着父记录走 · attachments-storage · presigned-upload-roundtrip, download-authz-both-sides, read-inherits-parent-rls, attach-requires-parent-edit
- files · 文件的一生与表单里的文件格:提交、墓碑、回收、续传,大小与类型服务端再验一次 · attachments-storage · sys-file-status-pipeline, orphan-tombstone-reap, upload-session-abort, inline-grid-receipt-cells, field-accept-maxsize-server-enforced
- i18n · 整个应用说客户的语言,Studio 跟着切,通知也落到对的语言 · i18n · surface-matrix, studio-follows-app-locale, notification-localized-and-clears
- api · 查询契约:算子、参数、聚合、日期窗口都有已知答案 · api-backend · query-contract-matrix, aggregate-contract-matrix, date-range-preset-matrix, filter-comparand-conformance
- api · 批量与写入门逐行有结果;错误信封与路由台账:码是登记过的,挂出来的就是真在跑的 · api-backend · bulk-write-contract, batch-transactional-discovery, error-envelope-ledger, route-ledger-live-parity
- api · 自己声明的 API 端点挂成真 URL,开发者控制台里当场试得通 · api-backend · declarative-endpoint-execution, api-console-discovery-execute
- api · REST 面的构造契约:开关决定挂什么、哪些动词准过,计时只对管理员开 · api-backend · rest-crud-config-contract, rest-batch-config-contract, rest-metadata-config-contract, rest-route-generation-tombstones, api-methods-verb-gate, server-timing-admin-gated
- api · 公式引擎:标准库函数逐个给出已知答案,写错的表达式在构建时就被挡下 · api-backend · formula-stdlib-matrix, formula-gates
- api · 连上外部系统:连接器声明式落地、坏了只降级一个、鉴权与命令白名单、流程里调得到 · integration-system + automation · connector-declarative-boot, connector-degraded-recovery, connector-stdio-default-deny, connector-spec-path-no-escape, connector-descriptor-audit, connector-auth-kind-application, flow-connector-picker, automation.connector-dispatch-matrix
- api · 外部数据源接进来当自己的对象用,密钥写不进也读不出 · integration-system + cli · external-datasource-federated-read, external-schema-introspection, external-schema-drift-gate, external-schema-browser-ui, datasource-admin-lifecycle, datasource-credential-refusal-matrix, cli.datasource-introspect-codegen
- api · 往外发、往里收:webhook、定时任务、邮件模板、收件箱投递与订阅偏好、铃铛已读 · integration-system + platform-core · webhook-lifecycle, job-scheduled-run, email-template-render, notify-inbox-delivery, notification-preference-suppression, platform-core.notification-center

**③ 验证:响亮拒绝错的,放行对的**

- devpath · `objectstack verify` 的判词是封闭的,失败才非零退出;质量套件跑在真应用上 · cli · verify-verdict-exit-mapping, qa-suite-execution
- devpath · 体检与弃用扫描:每项都有归属,说得出处方 · cli · doctor-health-report, doctor-deprecation-scan
- devpath · lint 的严重度是封闭的,只有错误才拦;命令用错了要响亮 · cli · lint-severity-exit-contract, flag-command-error-ux
- api · 写错的元数据在作者的门口就被拒,并给处方 · api-backend · enforce-or-remove-authoring-gates, retired-def-refusal
- i18n · 翻译键写错了两个门都拒,构建门禁能变红 · i18n · strict-translation-key-rejection, build-gates-hold
- studio · 存量元数据的体检:逐条报出不合规与位置 · studio-authoring · metadata-diagnostics-sweep

**④ 发布并装进一个环境**

- devpath · 打成插件:清单在打包边界就被强制 · cli · plugin-manifest-build-contract
- devpath · 装进来:兼容性、命名空间、启停与卸载,REST 侧同一套生命周期 · platform-core + api-backend · manifest-install-contract, package-lifecycle-enable-disable, api-backend.package-rest-lifecycle
- devpath · 从市场装:有没有控制面都装得上,界面不说谎 · platform-core · marketplace-install-local-lifecycle, marketplace-console-honesty
- devpath · 迁移:先看计划再动手,中断了说得出下一步,老写法给得出改法 · cli + platform-core · migrate-plan-apply-json, migrate-meta-codemod, migrate-duplicates-inventory, platform-core.interrupted-migration-boot-report
- devpath · 随包发来的对象只能扩不能改,启停逐条记在激活台账上 · platform-core + access-security · packaged-object-extend-only, activation-ledger-registration-home, activation-ledger-row-contract, access-security.activation-write-operator-gate
- workflow · 随包发的流程与动作:停用要持久、被依赖时拒绝、可克隆、两道门一样严 · automation + api-backend + access-security · packaged-flow-disable-durable, packaged-flow-subflow-disable-refusal, packaged-flow-clone-contract, setup-packaged-automation-board, api-backend.packaged-action-disabled-dispatch, api-backend.action-activation-door-contract, access-security.packaged-flow-write-door-parity
- access · 装进来的包带着它声明的能力与权限集,只读的包锁住 Studio · access-security + studio-authoring · capability-declaration-lifecycle, packaged-permission-set-lifecycle, readonly-package-locks-studio, studio-authoring.packaged-automation-studio-lock
- studio · 随包发来的视图与仪表盘,是可以直接改的那一类 · studio-authoring · packaged-display-class-direct-edit

**⑤ 接一个 Agent(社区版走 MCP),让它完成一次真实业务操作**

- ai · agent / tool / skill 元数据写得进、列得出,退役键给处方 · ai · agent-tool-skill-metadata-roundtrip
- ai · MCP 面按文档开关:HTTP 与 stdio 两条路都失败向关 · ai · mcp-http-surface, mcp-stdio-fail-closed
- ai · Agent 能做的就是应用真能做的:动作先开口子,表达式当场校验 · ai · mcp-run-action-exposure-gate, mcp-validate-expression
- ai · 技能说明书投到 MCP 的提示上 · ai · skill-instructions-mcp-prompts
- ai · 社区版没有的就诚实说没有,界面也不摆空架子 · ai · open-edition-honest-degradation, console-ai-surface-gating
- identity · 给 Agent 一把个人密钥:只显示一次,能撤也能恢复 · identity-auth · api-key-ui-lifecycle

**⑥ 按客户一句话需求迭代一次**

- studio · 首跑闭环:建包 → 建对象 → 记录 → 应用 → 发布 → 终端用户,零代码零重启 · studio-authoring · first-run-loop
- records · 把客户的存量数据搬进来:编码、映射、转换、撤销与取消 · records-forms · import-wizard-encoding-and-hints, named-import-mapping, import-job-undo-cancel, import-transform-matrix
- devpath · 迭代带来的结构变化:dev 启动只自愈安全的那部分,生产不自作主张 · cli · dev-automigrate-policy

**优先级**:
1. 安全与数据完整性永远最高,不等路。
2. 路断了、或清单上的能力断了 ⇒ P0/P1;能跑但出错 ⇒ P2;不在路上、不在清单上 ⇒ p3 或不做。定级读「路上的功能点」:改那张表即改优先级,⛔ 不逐卡改档。
3. 产品仓还有开放的 P0/P1 时,任何车道不派 p2/p3 的工具卡、契约卫生卡;解锁产品 P0/P1 的仪器卡沿链继承其优先级。
4. 因为写的是 AI、用的也是 AI:元数据既要 AI 能写——错的必须被响亮拒绝并给处方,永不静默落库;也要 AI 能用——声明了的对象、动作、agent / tool / skill 元数据在运行时兑现,MCP 面暴露的就是应用真能做的。写给 AI 的文档与 skills 说错一句,等于产品缺陷。

**阶段姿态**:速度优先于兼容。用的人少:退役立即生效,无过渡窗口、无别名双拼;兼容层、迁移窗口一类的工作默认 p3;声明了但不兑现的键按发布批量退役,不一键一卡。

**仪器为车队服务**:改 PM 协议、门禁、棘轮、技能的卡,以「它落地后车队的哪个决定或动作会不一样」评级——说得出(一次本来会派错的派发、一次落不了的落地、一次放过假货的复核、一个卡住的席位),就按上面的规则定级,与产品卡同场竞争;说不出,就不做。

**现在不做**:云服务的旅程(注册、控制面、托管)另有自己的清单;企业版内置 Agent 属 cloud 仓,不在本仓的路与清单里;计费未建。

**账本**:能力与验证的账本是 `docs/qa/platform-checklist/`,本页不复制它。本页不带任何数字;数字从命令来。
