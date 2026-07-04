# Platform Gaps Discovered While Building Templates

> 来源：在 `objectstack-ai/templates` 仓库中开发 `contracts` / `procurement` / `compliance` 三个业务模板（2026-05）过程中发现的、**属于平台层（framework + objectui）而非模板层**的缺陷与缺失能力。
>
> **维护约定**：此后每次开发模板/示例应用时，凡是发现"模板作者无法自行解决、需要平台修复"的问题，**都追加到本文档**，不要散落在各模板 README 中。
>
> 相关文档：`HARDENING.md`、`OBSERVABILITY.md`、`DX_ROADMAP.md`、`PLUGIN_ECOSYSTEM_MAP.md`。

## TL;DR — 按严重程度排序

| # | 严重度 | 类别 | 问题 | 阻塞场景 |
|---|---|---|---|---|
| 1 | 🔴 P0 | 通知 | 无外发通道（邮件 / IM / Webhook） | 任何审批/提醒类应用都"看起来像死的" |
| 2 | 🔴 P0 | 字段渲染 | `LookupCellRenderer` 硬编码显示字段候选 | 任何非 `name` 命名的关联表显示为原始 ID |
| 3 | 🔴 P0 | 上传 | `file` 字段类型存在，但无上传 UI 已验证 | 合同附件、证据材料、发票全部无法落地 |
| 4 | 🟠 P1 | 导入 | 没有 CSV 导入向导 | Day-1 客户冷启动无解 |
| 5 | 🟠 P1 | 审批 | 审批流仅支持单步阈值，无多级 / 并行 / 委派 / OOO | 企业采购、合规审批均不够用 |
| 6 | 🟠 P1 | 协作 | 没有评论 / @ 提醒 / 活动流 | 业务用户拒绝迁离飞书/钉钉 |
| 7 | 🟠 P1 | CEL stdlib | 函数库残缺：无 `daysBetween`、日期 + 整数运算 | 公式字段经常写不出来 |
| 8 | 🟠 P1 | 表单 | 没有条件显示 / 条件必填 | 复杂业务表单只能堆字段 |
| 9 | 🟠 P1 | 导出 | 没有打印 / PDF 导出 | 采购订单、审计报告无法交付 |
| 10 | 🟡 P2 | 分析 | Analytics 过滤器不支持公式字段 | Dashboard 只能用基础字段筛选 |
| 11 | 🟡 P2 | 宏 | 日期宏在不同 API 不一致（`{today}` vs `{30_days_from_now}`） | 模板作者反复踩坑 |
| 12 | 🟡 P2 | DX | Dashboard 配置改动需重启 dev server | 调样式效率低 |
| 13 | 🟡 P2 | DX | `@objectstack/spec/state-machine` 导入路径与文档不符 | 新人 30 分钟卡点 |
| 14 | 🟡 P2 | 布局 | 详情页 `regions: []` 在 `kind: 'slotted'` 下不生效 | 只能用 header-only 覆盖 |
| 15 | 🟡 P2 | 配置 | `sort` 必须嵌在 `options.sort`，非直观 | 文档/示例缺 |
| 16 | 🟡 P2 | 流程 | `create_record` 节点 value 语义不明（字面 vs CEL） | 写流程靠猜 |
| 17 | 🟡 P2 | 批量 | 批量操作 UI 入口存在但未端到端验证 | 大数据集运营卡顿 |
| 18 | 🟡 P2 | i18n | zh-CN ↔ English 切换偶发错乱 | 国内客户体验差 |
| 19 | 🟢 P3 | 企业 | SSO / SAML / Okta 未在模板中验证 | 中大客户准入门槛 |
| 20 | 🟢 P3 | 企业 | 多步审批、委派、不在岗代理缺失 | 同上 |
| 21 | 🟢 P3 | 企业 | 外部审计员 / 只读访客门户缺失 | 合规类应用刚需 |
| 22 | 🟢 P3 | 移动 | 移动端响应式未验证 | 审批走手机是基本盘 |
| 23 | 🟢 P3 | 文档 | ~~`services.data.{get,update}` 等 API 未文档化~~ | Fixed in Unreleased: 新增 `content/docs/kernel/runtime-services/*` |
| 24 | 🟢 P3 | 发布 | 模板包发布/版本升级流程不明 | 模板生态化卡点 |
| 25 | 🟢 P3 | 审计 | 平台内置审计日志的可见性 / 配置入口不清 | 合规模板无法引用 |

---

## 🔴 P0 — 阻塞性问题

### 1. 通知投递通道缺失

**症状**：流程（flows）和状态机可以触发 `notify` 节点，但没有任何外发通道——邮件、Slack、飞书、钉钉、Webhook 都没有落地实现。最终用户在系统里"啥也看不到、啥也收不到"，需要主动登录刷新才能知道有事要处理。

**复现来源**：`contracts`、`procurement`、`compliance` 三个模板的审批/提醒流程均验证过，flow 触发成功（日志中可见），但对应的接收人没有收到任何通知。

**workaround**：模板内只能用 `task` 类型字段 + dashboard `pending` 视图代偿——本质上是轮询。

**建议修复**：
- 平台层增加 `notification_channel` 配置（SMTP / 飞书机器人 / 钉钉 / 企微 / 通用 Webhook）。
- `notify` 节点接收 `channel` + `template` + `recipients`，由平台路由。
- 提供站内消息中心兜底（已有 inbox 概念，但未与 flow 打通）。

**严重度**：🔴 P0 — 没有这个能力，任何"工作流类"模板都无法说服企业用户使用。

---

### 2. LookupCellRenderer 硬编码显示字段候选

**症状**：列表/表格中显示关联记录时，`pickRecordDisplayName`（`@object-ui/fields`）只在 `[name, full_name, display_name, label, title, subject, username]` 中找显示字段，**完全不读取 schema 的 `displayNameField` 配置**。如果业务对象用 `legal_name` / `vendor_code` / `contract_number` 等命名，列表会显示原始 FK ID（如 `Wg2ksmU278fgR7ma`）。

**复现来源**：`procurement_vendor.legal_name` 在采购模板的 PO 列表"供应商"列显示为原始 ID。

**workaround**（模板侧）：把字段重命名为 `name`。已在 procurement 模板执行（`legal_name` → `name`，5 文件 sed）。

**建议修复**（平台侧，已在 `objectui/packages/fields/src/index.tsx` 暂存补丁，未发布）：
- `pickRecordDisplayName(record, preferredField?)` 接收 schema 的 `displayNameField` 作为首选。
- 后备启发式：字段名以 `_name` / `_title` / `_label` / `_number` / `_code` 结尾的优先。
- `LookupCellRenderer` 调用处传入对应 schema 的 `displayNameField`。

**严重度**：🔴 P0 — 关联字段显示是基础能力，"显示成乱码"是 demo killer。

---

### 3. 文件附件 / 上传 UI 工作流未验证

**症状**：`field.kind: 'file'` 类型在 spec 中存在，但模板开发过程中没有可用的"上传 → 预览 → 下载 → 版本管理"端到端 UI。

**复现来源**：合同模板需要附件（PDF 合同正本）、采购模板需要发票图片、合规模板需要证据材料截图——三处全部只能用 `text` 字段存 URL 字符串。

**workaround**：用 URL 字符串字段，外部托管文件。完全不可接受。

**建议修复**：
- 平台提供对象存储抽象（local / S3 / OSS / MinIO）。
- 字段类型 `file` / `image` 在所有 widget 中渲染上传/预览组件。
- 支持多文件、版本、过期 URL。
- 与权限系统打通（私有文件访问控制）。

**严重度**：🔴 P0 — 95% 的 B 端应用都需要附件。

---

## 🟠 P1 — 严重缺失，影响产品定位

### 4. 没有 CSV / Excel 导入向导

**症状**：新客户上线需要导入历史数据（供应商表、合同清单、客户列表），平台没有内置导入向导，只能写脚本调 API。

**workaround**：模板作者手写 seed 脚本。客户自助上线无解。

**建议修复**：
- 通用导入向导：上传 CSV → 字段映射 → 校验预览 → 提交。
- 支持外键自动 lookup（"供应商名"列自动匹配到 `procurement_vendor` 的 ID）。
- 错误行下载 + 重试。

**严重度**：🟠 P1 — 没这个，Day-1 留存率会被腰斩。

---

### 5. 审批流过于简单

**症状**：当前流程支持基于阈值的单步审批（如 `amount > 50000` 触发 CFO 审批），但缺失：
- 多级串行审批（部门经理 → 总监 → VP）
- 多级并行（法务 + 财务同时审批，全部通过才进入下一步）
- 委派 / 转交（A 把审批交给 B）
- 不在岗自动跳过 / 代理人（OOO）
- 审批意见、附件、撤回

**复现来源**：procurement PO 审批、contracts 高额合同审批、compliance 控制评估审批全部不够用。

**建议修复**：
- 新增审批节点类型（区别于普通 flow node）。
- 内置审批历史、SLA 计时、提醒升级。

**严重度**：🟠 P1 — 决定了平台能不能进企业。

---

### 6. 协作原语缺失（评论 / @ / 活动流）

**症状**：记录详情页没有评论区，没有 @ 提醒，没有活动流（"张三 12 分钟前把状态从 draft 改成 in_review"）。

**workaround**：无。

**建议修复**：
- 内置 `comments` 子表，所有对象自动获得。
- @ 用户 → 自动产生 inbox + 通知。
- 活动流由变更日志（audit log）自动聚合。

**严重度**：🟠 P1 — 业务用户拒绝从飞书/钉钉迁出的核心原因。

---

### 7. CEL 标准库残缺

**症状**：可用函数仅 `now() / today() / daysFromNow(int) / daysAgo(int) / isBlank / coalesce / trim / joinNonEmpty`。缺失：
- `daysBetween(date1, date2)`
- 日期 + 整数算术（`expires_at + 30`）
- 字符串格式化、正则、JSON 路径
- 数学函数（round、floor、ceil 之外的）
- 列表 / 集合操作（filter / map / reduce）

**复现来源**：合同到期预警公式、合规控制 next_review 计算、采购付款条款计算均碰壁。

**建议修复**：参照 Google CEL 标准库补齐 + 业务常用函数。

**严重度**：🟠 P1 — 影响所有公式字段表达力。

---

### 8. 表单没有条件显示 / 条件必填

**症状**：表单中所有字段一字排开，无法做到"金额 ≥ 50000 才显示 `cfo_approver`"、"合同类型 = NDA 才必填 `confidentiality_term`"。

**workaround**：业务逻辑放在 flow 校验里，UX 很差（用户填完才报错）。

**建议修复**：
- 字段级 `visibleWhen` / `requiredWhen` CEL 表达式。
- 表单分段、分步（wizard）支持。

**严重度**：🟠 P1。

---

### 9. 没有打印 / PDF 导出

**症状**：采购订单、合同、审计报告无法生成可打印 PDF。

**workaround**：浏览器打印（样式无法控制，公司抬头/页眉页脚没有）。

**建议修复**：
- 文档模板引擎（Markdown / HTML 模板 + 数据绑定）。
- 服务端渲染 PDF（headless Chrome 或 wkhtmltopdf）。
- 一键下载 / 邮件发送。

**严重度**：🟠 P1 — 采购、合同、合规三大类全要用。

---

## 🟡 P2 — 影响 DX 和模板作者效率

### 10. Analytics 过滤器不支持公式字段

**症状**：在 `/api/v1/analytics/...` 调用中，若 `filters` 引用计算/公式字段，返回 500。只能用基础持久化字段。

**workaround**：把公式结果物化成持久字段（牺牲灵活性）。

**建议修复**：分析层在执行前预解析公式字段，或转译为 SQL 子查询。

---

### 11. 日期宏在不同 API 不一致

**症状**：
- `/api/v1/data/<object>` 的 `filters` 只解析 `{today}`，不解析 `{30_days_from_now}`。
- `/api/v1/analytics/...` 才解析 `{N_days_from_now}` / `{N_days_ago}`。

**workaround**：模板作者要记住哪个 API 支持哪些宏。

**建议修复**：统一宏解析器，在所有数据/分析端点一致行为。

---

### 12. Dashboard 配置改动需重启 dev server

**症状**：`objects/*.json`、`translations/*.json` 支持热重载；`dashboards/*.json` 不行，必须 Ctrl+C 重启。

**建议修复**：dashboard 配置纳入热重载 watcher。

---

### 13. `@objectstack/spec/state-machine` 导入路径与文档不符

**症状**：文档/示例中出现 `import ... from '@objectstack/spec/state-machine'`，实际包导出在 `@objectstack/spec/automation`。新人 30 分钟卡点。

**建议修复**：要么补 alias 导出，要么修文档/示例。

---

### 14. 详情页 `regions: []` 在 `kind: 'slotted'` 下不生效

**症状**：`detail.kind: 'slotted'` 时，传 `regions: []` 试图清空区域不被尊重；只有 header-only 覆盖模式才有效。

**建议修复**：明确语义并对齐文档。

---

### 15. `sort` 配置位置非直观

**症状**：widget 上 `sort` 必须嵌入 `options.sort: [...]`，不能直接放在 widget 顶层。错放无错误提示，静默忽略。

**建议修复**：放在顶层也接受，或在校验器中给出明确错误。

---

### 16. Flow `create_record` 节点 value 语义不明

**症状**：节点 value 写 `'today()'`——字符串字面量还是 CEL 表达式？文档没说，需读源码或试错。

**建议修复**：明确以 `=` 前缀区分（`= today()` 表达式 vs `'today()'` 字面量），并文档化。

---

### 17. 批量操作 UI 未端到端验证

**症状**：导航中存在批量操作入口，但实际数据集稍大时未验证可用性、性能、错误处理。

**建议修复**：补 e2e 测试，文档化每个对象支持的批量操作。

---

### 18. i18n 切换偶发错乱

**症状**：procurement 模板重启后，部分 label 显示英文，部分显示中文，刷新后变化。原因不明，疑似翻译合并顺序或缓存问题。

**建议修复**：定位翻译加载顺序，加测试覆盖。

---

## 🟢 P3 — 企业能力 & 文档缺口

### 19. SSO / SAML / Okta 未验证

平台是否支持企业身份接入？模板里只用了本地账号。建议补一个 reference integration + 文档。

### 20. 多步审批、委派、不在岗代理

见 #5 的延伸——这是企业版的"准入条件"。

### 21. 外部审计员 / 只读访客门户

合规类应用必备：外部审计员需要只读访问指定证据集合，不能给完整账号。建议引入"受限链接 / 临时访客角色"。

### 22. 移动端响应式未验证

审批/提醒类应用在手机上完成是基本盘。当前 UI 在 < 768px 表现未测试。

### 23. ~~`services.data.{get,update}` 等 API 未文档化~~

模板代码中调用 `services?.data?.get(object, id)` / `services?.data?.update(object, id, values)`，靠读源码发现，签名/错误语义无文档。建议补 SDK 参考。  
**Fixed in Unreleased:** 已新增独立章节 `content/docs/kernel/runtime-services/`，覆盖 `services.data/sharing/audit/queue/email/settings/storage` 方法签名、参数、返回、错误语义、示例与稳定性标记。

### 24. 模板包发布 / 版本升级流程不明

模板作者完成后，如何发布到平台模板市场？如何升级已部署的客户实例？文档缺失。

### 25. 平台内置审计日志的可见性

平台声称内置审计日志，但模板/业务用户如何查看？是否可配置保留期、导出？管理后台入口在哪？文档不清。

---

## 维护规则

1. **新增问题**：在 TL;DR 表新增一行 + 详细章节，严重度遵循 P0/P1/P2/P3 分级。
2. **修复后**：不要删除条目，改为 `~~strikethrough~~` 并在末尾注明 "Fixed in vX.Y.Z, commit `<sha>`"，方便回溯。
3. **每次模板开发**：开发完成时 review 本文档，把新发现追加上来。
4. **配套**：把 P0/P1 条目同步到 framework 仓库的 issue tracker，作为 platform roadmap 输入。

## 来源模板

- `objectstack-ai/templates@62ab586` — contracts / procurement / compliance（2026-05）
- 后续模板请在此追加引用。

---

# 2026-05-25 增补：来自 helpdesk 模板的新发现

来源：`@template/helpdesk`（AI-first 客服工单）。

## 新追加的平台级缺陷（编号续接）

| # | 严重度 | 类别 | 问题 | 阻塞场景 |
|---|---|---|---|---|
| 26 | 🔴 P0 | 详情页 | 无「内联消息撰写器」组件——detail page 上无法放一个「写一条对外回复 / 内部备注」的复合输入框 | 客服工单、CRM 跟进、销售备注全部无入口发对外消息 |
| 27 | 🔴 P0 | 门户 | 没有「外部用户门户」机制——同一 app 给员工和客户用，UI chrome 一样、导航一样、权限只能靠 profile 隐藏字段，无法做出「干净的客户自助页面」 | 任何 B2C / B2B SaaS 类应用（工单、客户社区、对账平台、合规外审） |
| 28 | 🔴 P0 | 字段类型 | 无「附件 / 附件列表」字段在 UI 上端到端可用（与缺陷 #3 file 字段相关但更宽：消息附件、聊天图片、批量截图） | 客服截图、合同附件、报销发票 |
| 29 | 🟠 P1 | 列表 | 没有「上次访问以来的变化」标记 / 未读指示 / 时间线分割线 | 客服轮班、运营巡检、审批人回到工作台找不到新东西 |
| 30 | 🟠 P1 | 列表 | 批量操作（多选 → 改 assignee / 改状态 / 转移团队）UI 入口无验证（与 #17 重复但优先级提升） | 客服管理员日常运营、CRM 销售经理调单 |
| 31 | 🟠 P1 | 编辑器 | 富文本编辑器仅在 Discussion 评论区有，业务字段的 long_text 仍是纯文本 textarea | AI 草稿、KB 文章、对客回复都长得像 1995 年的 BBS |
| 32 | 🟠 P1 | 模板 | 没有「Canned Response / Macro」一等公民——重复回复模板需要业务侧自己做对象 + 自己做选择器 | 任何重复性高的人工外发：客服、销售跟进、HR Offer |
| 33 | 🟠 P1 | 协作 | 无在线状态 / 占位提示（"张三正在查看这条工单"） | 多坐席同时回同一单导致重复回复 |
| 34 | 🟠 P1 | 快捷键 | 平台无可注册的键盘快捷键 API（next / prev / assign-to-me / close） | 高频操作型岗位（客服、审核）效率打三折 |
| 35 | 🟠 P1 | SLA | 没有「条件性计时器」原语：状态机进入 `waiting_customer` 时暂停某字段的 SLA 计时 | 任何 SLA 应用都不公正：等客户的时间被算在 SLA 里 |
| 36 | 🟠 P1 | 公式 | `formula` 字段不能跨对象引用（如 ticket 想取 customer.tier 来算优先级） | 派生字段大量场景写不出来 |
| 37 | 🟡 P2 | Dashboard | 图表无 drill-down（点柱子→跳到对应过滤的列表视图） | Manager dashboard 变只读壁纸 |
| 38 | 🟡 P2 | Dashboard | 无周期对比（本周 vs 上周、本月 vs 上月）原语 | 任何运营复盘看板都缺一半 |
| 39 | 🟡 P2 | 通道 | 没有「入站 channel」抽象：邮件转工单、Webhook 转 Lead 等没有平台层入口 | 任何客户接触型应用必须靠外部 ETL |
| 40 | 🟡 P2 | i18n | 翻译 namespace 校验弱：navigation 项必须 `{label: string}` 而非裸字符串，但报错只在运行时 | 模板作者反复踩坑 |

## 由这些缺陷导致的「helpdesk 模板看起来很美但不能日常用」具体表现

| 终端用户感受 | 关联平台缺陷 |
|---|---|
| 「我看到 AI 写好的回复，但没有按钮发出去」 | #26、#28 |
| 「客户登录进来跟我看到的一样，他能看到所有内部备注」 | #27 |
| 「我休班回来不知道哪些单动过」 | #29 |
| 「重复打 30 遍同样的话」 | #32 |
| 「同事和我同时回了同一张单」 | #33 |
| 「SLA 算上了等客户的时间，不公平」 | #35 |
| 「想按客户等级自动排优先级写不出公式」 | #36 |
| 「图表点不动」 | #37 |
| 「邮件进不来」 | #39 |

## 建议的平台优先级（结合本次发现）

- **P0 新增**：#26（内联撰写器）、#27（外部门户）、#28（附件 UI 端到端）
- **原 P0 复确认**：#1（通知投递）—— 客服模板再次确认是阻塞性
- **P1 新增**：#32（Canned Response）、#34（快捷键）、#35（条件计时器）、#36（跨对象公式）
