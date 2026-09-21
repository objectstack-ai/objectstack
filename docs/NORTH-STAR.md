# ObjectStack 北极星

**我们是什么**:一个应用开发平台;创业阶段。

**给谁**:第三方开发者,AI 代理为主、人验收——AI 进入我们的元数据协议写应用,人看结果、拍板。应用的终端用户是企业里的业务人员,他们通过 Agent 和界面使用应用。

**做出来的是什么**:**AI 原生的企业管理应用**——业务对象与记录、看数据的视图、能用的表单、真挡得住的权限、审批与自动化、经营报表、登录与身份、可对外的 API、文件、客户的语言,以及不写代码在运行中改应用。AI 原生的意思:应用自带一个能替用户操作它的 Agent——本仓(社区版)通过 MCP 把对象与动作暴露出去,用户接入自己的 Agent;企业版把 Agent 内置在用户界面里,那一半住 cloud 仓。缺任何一样就不是这个应用。这一行是定义,不是清单;每一项做到什么、怎么验证,在 `docs/qa/platform-checklist/`。参考实现 hotcrm。

**什么算做好**:一个建在协议上的应用,过了验证才算做好——它的元数据对应的清单项在一次 run 里通过,`objectstack verify` 在它上面是绿的。没过验证的交付不算 done。

**唯一的度量,那条路**:一个新的 AI 开发者(人在旁验收)从 `npm create objectstack` 出发:写元数据 → 本地跑起来、看到 → 验证响亮拒绝错的、放行对的 → 发布并装进一个环境 → 接一个 Agent(社区版走 MCP),让它在应用里完成一次真实业务操作 → 按客户一句话需求迭代一次。每周真走一遍,结果落一张 run record。第一个断掉的步骤就是当前的 P0;跑得通但结果错的是 P2。

**路上的功能点**:这条路上要做的功能点,自上而下就是顺序 —— 这张表就是路线图,改它即改优先级。每行 `轴 · 功能点(业务语言) · 清单项 id · 路步(P 后面是那条路的第几步)`。

- studio · 管理员在界面里写 Markdown 文档并加到菜单(含 book) · 清单项待写 · P2
- studio · 不写代码走完建包 → 建对象 → 记录 → 应用 → 发布 → 终端用户,零重启 · studio-authoring.first-run-loop · P2
- records · 在界面里把一条记录建出来、看见、改掉、删掉 · records-forms.crud-roundtrip · P3
- access · 受限成员只看得到自己的行,管理员看得到全部 · access-security.rls-both-sides · P3
- access · 写入挡得住:只读字段被剥、伪造与转移 owner 被拒、批量照验 · access-security.write-path-guards · P3
- access · 每个权限集的增删改查逐格兑现,收回的动作真的被拒 · access-security.crud-permission-matrix · P3
- access · 四种共享模型各自声明的基线都挡得住 · access-security.owd-sharing-matrix · P3
- access · 匿名请求在每个挂出来的 API 家族都统一按未认证拒绝,先于任何资源解析 · access-security.anonymous-deny-surfaces · P3
- access · 没有活跃组织的会话是合法状态,且失败向关,永不写空租户 · access-security.no-active-org-session-semantics · P3
- workflow · 非管理员从自己的应用进得去完整的审批收件箱 · approvals.account-app-entry · P3
- api · 数据 API 的查询契约:每个过滤算子答案已知,错的输入响亮拒绝 · api-backend.query-contract-matrix · P3
- devpath · 一条命令把应用跑起来:能登录、数据库选择诚实、端口与陈旧都说出来 · cli.dev-boot-contract · P3
- devpath · 起来就是干净的:健康与就绪都通,没有降级横幅,控制台与应用元数据都供得上 · platform-core.boot-health · P3
- devpath · 种子数据原样落库,重放不多不少 · platform-core.seed-integrity · P3
- devpath · 管理员从控制台登得进去,刷新后会话还在,过期后重新认证干净 · platform-core.console-login · P3
- devpath · 每个导航面都渲染得出来,坏了也看得见错误边界,不是白屏 · platform-core.nav-surfaces-render · P3
- devpath · 自带的应用(Setup / Account)每个菜单目标都打得开,门是挡不是报错 · platform-core.builtin-apps-nav-render · P3
- api · 数据源密钥写不进去也读不出来:内联即拒,两道读口都打码 · integration-system.datasource-credential-refusal-matrix · P4
- workflow · 停用一个随包发的流程,冷重启之后它还是停的 · automation.packaged-flow-disable-durable · P5
- api · 停用的随包动作在两道派发门都被拒,且拒得出于开关而非权限 · api-backend.packaged-action-disabled-dispatch · P5
- ai · 没有密钥 MCP 就不起;拿成员的密钥连上,读与聚合都照他的权限走,吊销下一次调用即生效 · ai.mcp-stdio-fail-closed · P6

**优先级**:
1. 安全与数据完整性永远最高,不等路。
2. 路断了、或清单上的能力断了 ⇒ P0/P1;能跑但出错 ⇒ P2;不在路上、不在清单上 ⇒ p3 或不做。定级读「路上的功能点」:改那张表即改优先级,⛔ 不逐卡改档。
3. 产品仓还有开放的 P0/P1 时,任何车道不派 p2/p3 的工具卡、契约卫生卡;解锁产品 P0/P1 的仪器卡沿链继承其优先级。
4. 因为写的是 AI、用的也是 AI:元数据既要 AI 能写——错的必须被响亮拒绝并给处方,永不静默落库;也要 AI 能用——声明了的对象、动作、agent / tool / skill 元数据在运行时兑现,MCP 面暴露的就是应用真能做的。写给 AI 的文档与 skills 说错一句,等于产品缺陷。

**阶段姿态**:速度优先于兼容。用的人少:退役立即生效,无过渡窗口、无别名双拼;兼容层、迁移窗口一类的工作默认 p3;声明了但不兑现的键按发布批量退役,不一键一卡。

**仪器为车队服务**:改 PM 协议、门禁、棘轮、技能的卡,以「它落地后车队的哪个决定或动作会不一样」评级——说得出(一次本来会派错的派发、一次落不了的落地、一次放过假货的复核、一个卡住的席位),就按上面的规则定级,与产品卡同场竞争;说不出,就不做。

**现在不做**:云服务的旅程(注册、控制面、托管)另有自己的清单;企业版内置 Agent 属 cloud 仓,不在本仓的路与清单里;计费未建。

**账本**:能力与验证的账本是 `docs/qa/platform-checklist/`,本页不复制它。本页不带任何数字;数字从命令来。
