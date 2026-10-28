// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata admin i18n bundle (Phase 3f).
 *
 * Lightweight static label table for the 27 built-in metadata types,
 * plus a tiny `t()` helper for engine UI strings.
 *
 * Why not i18next? The engine already consumes `label` from the
 * server's `/meta/types` response (which is sourced from
 * `DEFAULT_METADATA_TYPE_REGISTRY`). This bundle exists as a fallback
 * for environments without translation bundles configured, and as the
 * single source of truth for Chinese labels until the platform's
 * `setup.translation.ts` ships zh-CN coverage.
 *
 * Usage:
 *   import { translateMetadataType, t } from './i18n';
 *   translateMetadataType('view', 'zh-CN')  // → '视图'
 *   t('engine.directory.title', 'zh-CN')    // → '元数据'
 *
 * The DirectoryPage / PageShell call these to localise headings when
 * the consumer hasn't wired the global i18n provider.
 *
 * ## Typographic convention: the ellipsis is U+2026 `…`, never `...`
 *
 * Values here end (or interrupt) with the typographic ellipsis `…`, not three
 * ASCII full stops — per the maintainer-authorized consistency pass registered
 * on objectstack#6015 (2026-08-09), which objectui#3878 applied to the ten
 * locale packs in `packages/i18n/src/locales/`.
 *
 * This table is NOT one of those packs: the designer carries its own flat
 * `Record` of dotted keys with `en` and `zh` in one file, so
 * `packages/i18n/src/__tests__/ellipsis-glyph-3878.test.ts` — which scans the
 * ten packs and says so in its own header — deliberately does not reach it.
 * The convention is therefore held by this note rather than by a gate
 * (objectui#4377: generalising that pin to a second table shape was costed as
 * more machinery than the defect is worth). Follow it when adding a value; the
 * designer renders inside the console shell, so a `...` here lands on the same
 * screen as a `…` from the packs.
 *
 * ## Moving into `@object-ui/i18n` (objectstack#25922)
 *
 * The maintainer's ruling 6431032267 (Q2 = A, kept by the re-ruling
 * 6431234244) reopened the objectui#4662 carve-out: this table becomes the
 * `studio` namespace of `@object-ui/i18n` (`packages/i18n/src/namespaces/studio/`),
 * one lazy namespace carrying the existing `en` and `zh` text, every other
 * language falling back to `en`. It moves in slices. Until the last one, a key
 * lives either here or there, never both, and every lookup below asks this
 * table first and the namespace second (`lookupString`), so no call site
 * changes. `packages/i18n/README.md`, section "Scope — the Studio designer
 * strings", is the conventions-side record; keep the two in step.
 *
 * What has not changed for the keys still here: only `en` and `zh` exist, so
 * the other eight shipped locales render English on these screens, and the
 * pack gates do not read this module (`scripts/check-i18n-call-site-keys.mjs`
 * skips it by declaration). `check:i18n-designer-parity` reads both homes.
 */

import { useObjectTranslation } from '@object-ui/i18n';
// The designer strings' new home. Its `en` catalogue is resident; its other
// catalogues are fetched on demand, and `useMetadataLocale()` re-renders its
// caller when one lands. ⚠️ `ui/scripts/check-i18n-dead-keys.mjs` reads the
// namespace's catalogues as part of this table BECAUSE this module imports it:
// drop the import and the gates stop reading them.
import { studioString, useStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
// Type-only (erased at build): the overlay-scope and lock-state label tables
// below are keyed by their producer's own union rather than by hand — see
// `LAYER_SCOPE_ZH` and `LOCK_STATE_ZH`.
import type {
  MetadataAuditEntry,
  MetadataOverlayScope,
} from '@object-ui/data-objectstack';

export type SupportedLocale = 'en-US' | 'zh-CN';

const TYPE_LABELS_EN: Record<string, string> = {
  // Data
  object: 'Object',
  field: 'Field',
  trigger: 'Trigger',
  validation: 'Validation Rule',
  hook: 'Hook',
  // UI
  view: 'View',
  page: 'Page',
  dashboard: 'Dashboard',
  app: 'Application',
  action: 'Action',
  report: 'Report',
  // Automation
  flow: 'Flow',
  // ADR-0020: `workflow` retired as a metadata type.
  approval: 'Approval Process',
  // System
  datasource: 'Datasource',
  translation: 'Translation',
  router: 'Router',
  function: 'Function',
  service: 'Service',
  email_template: 'Email Template',
  book: 'Documentation Book',
  doc: 'Documentation',
  // Security — ADR-0090: profile removed (D2), role renamed to position (D3).
  permission: 'Permission Set',
  position: 'Position',
  // AI
  agent: 'AI Agent',
  tool: 'AI Tool',
  skill: 'AI Skill',
  // Platform
  package: 'Package',
  data: 'Dataset',
  job: 'Background Job',
  // New in spec 7.1 — externally surfaced metadata types that did not
  // ship with a human-readable label in the framework registry.
  api: 'API Endpoint',
  connector: 'Connector',
  mapping: 'Field Mapping',
  policy: 'Policy',
  webhook: 'Webhook',
  theme: 'Theme',
  sharing_rule: 'Sharing Rule',
  analytics_cube: 'Analytics Cube',
  picklist: 'Picklist',
};

const TYPE_LABELS_ZH: Record<string, string> = {
  object: '对象',
  field: '字段',
  trigger: '触发器',
  validation: '校验规则',
  hook: '钩子',
  view: '视图',
  page: '页面',
  dashboard: '仪表板',
  app: '应用',
  action: '操作',
  report: '报表',
  flow: '流程',
  // ADR-0020: `workflow` 已不再是独立元数据类型。
  approval: '审批流程',
  datasource: '数据源',
  translation: '翻译',
  router: '路由',
  function: '函数',
  service: '服务',
  email_template: '邮件模板',
  book: '文档手册',
  doc: '文档',
  permission: '权限集',
  position: '岗位',
  agent: 'AI 智能体',
  tool: 'AI 工具',
  skill: 'AI 技能',
  package: '包',
  data: '数据集',
  job: '后台任务',
  // New in spec 7.1.
  api: 'API 端点',
  connector: '连接器',
  mapping: '字段映射',
  policy: '策略',
  webhook: 'Webhook 回调',
  theme: '主题',
  sharing_rule: '共享规则',
  analytics_cube: '分析立方体',
  picklist: '选项列表',
};

const DOMAIN_LABELS_EN: Record<string, string> = {
  data: 'Data',
  ui: 'UI',
  automation: 'Automation',
  ai: 'AI',
  system: 'System',
  platform: 'Platform',
  identity: 'Identity',
  security: 'Security',
  other: 'Other',
};

const DOMAIN_LABELS_ZH: Record<string, string> = {
  data: '数据',
  ui: '界面',
  automation: '自动化',
  ai: 'AI',
  system: '系统',
  platform: '平台',
  identity: '身份',
  security: '安全',
  other: '其他',
};

const ENGINE_STRINGS_EN: Record<string, string> = {
  'engine.translationPreview.empty':
    'This bundle is empty — add at least one translated string to see the coverage report.',
  // One heading per group of the per-app `TranslationDataSchema`, in its order (objectui#11765).
  'engine.translationPreview.category.objects': 'Objects',
  'engine.translationPreview.category.picklists': 'Picklists',
  'engine.translationPreview.category.apps': 'Apps',
  'engine.translationPreview.category.messages': 'Messages',
  'engine.translationPreview.category.globalActions': 'Global Actions',
  'engine.translationPreview.category.dashboards': 'Dashboards',
  'engine.translationPreview.category.datasets': 'Datasets',
  'engine.translationPreview.category.reports': 'Reports',
  'engine.translationPreview.category.pages': 'Pages',
  'engine.translationPreview.category.flows': 'Flows',
  'engine.translationPreview.category.hooks': 'Hooks',
  'engine.translationPreview.category.positions': 'Positions',
  'engine.translationPreview.category.permissions': 'Permission Sets',
  'engine.translationPreview.category.books': 'Doc Books',
  'engine.translationPreview.category.metadataForms': 'Metadata Forms',
  'engine.translationPreview.category.settingsCommon': 'Settings UI',
  'engine.translationPreview.coverage': 'Category coverage:',
  'engine.translationPreview.totalKeys': '{count} total keys',
  'engine.translationPreview.categoryEmpty': 'empty',
  'engine.translationPreview.more': '+{count} more…',
  'engine.translationPreview.keyCountOne': '{{count} key}',
  'engine.translationPreview.keyCountOther': '{{count} keys}',
};

const ENGINE_STRINGS_ZH: Record<string, string> = {
  'engine.translationPreview.empty': '此语言包为空 —— 至少添加一条译文，即可查看覆盖率报告。',
  'engine.translationPreview.category.objects': '对象',
  'engine.translationPreview.category.picklists': '选项列表',
  'engine.translationPreview.category.apps': '应用',
  'engine.translationPreview.category.messages': '消息',
  'engine.translationPreview.category.globalActions': '全局操作',
  'engine.translationPreview.category.dashboards': '仪表盘',
  'engine.translationPreview.category.datasets': '数据集',
  'engine.translationPreview.category.reports': '报表',
  'engine.translationPreview.category.pages': '页面',
  'engine.translationPreview.category.flows': '流程',
  'engine.translationPreview.category.hooks': '钩子',
  'engine.translationPreview.category.positions': '岗位',
  'engine.translationPreview.category.permissions': '权限集',
  'engine.translationPreview.category.books': '文档书',
  'engine.translationPreview.category.metadataForms': '元数据表单',
  'engine.translationPreview.category.settingsCommon': '设置界面',
  'engine.translationPreview.coverage': '分类覆盖率：',
  'engine.translationPreview.totalKeys': '共 {count} 个键',
  'engine.translationPreview.categoryEmpty': '空',
  'engine.translationPreview.more': '另有 {count} 项…',
  'engine.translationPreview.keyCountOne': '{{count} 个键}',
  'engine.translationPreview.keyCountOther': '{{count} 个键}',
};

/** Whether a locale resolves to Chinese (the only non-English catalog). */
export function isZhLocale(locale?: SupportedLocale | string): boolean {
  return (locale ?? '').toLowerCase().startsWith('zh');
}

/** zh-CN overrides for one flow-node config field. English is the fallback. */
interface FlowFieldZh {
  label?: string;
  help?: string;
  /** The field's `unsetNotice` (objectui#11054). */
  unsetNotice?: string;
  /** select option value → zh label. */
  opts?: Record<string, string>;
  /** objectList column key → zh label (+ nested option labels). */
  cols?: Record<string, { label?: string; opts?: Record<string, string> }>;
}

/**
 * zh-CN translations for the flow node inspector's config fields, keyed by the
 * canonical node type then the field `id`. Consumed by
 * `localizeFlowFields` (flow-node-config) at render, which overlays these onto
 * the English field table AND the engine-published `configSchema` fields (they
 * share field ids for built-in nodes). Any field/option absent here falls back
 * to its English label, so plugin nodes stay readable. Placeholders (example
 * literals like cron strings / URLs) are intentionally left in English.
 */
const FLOW_FIELD_ZH: Record<string, Record<string, FlowFieldZh>> = {
  start: {
    triggerType: {
      label: '触发方式',
      help: '流程何时启动。记录触发在数据变更时触发;定时触发按计划(cron、间隔或指定时间)触发。',
      opts: {
        'record-after-create': '记录创建后',
        'record-after-update': '记录更新后',
        'record-after-write': '记录创建或更新后',
        'record-before-update': '记录更新前',
        'record-after-delete': '记录删除后',
        schedule: '定时',
        time_relative: '相对时间(日期扫描)',
        manual: '手动 / 自动启动',
        api: 'Webhook / API',
      },
    },
    // objectui#11054 — the inbound hook's per-flow secret (write-only).
    secret: {
      label: '密钥',
      help: '入站 hook 用来校验每一次请求的流程级密钥。只写不读:已保存的密钥不会在此显示,留空即保持不变。',
      unsetNotice: '未输入密钥。API 触发的流程若开始节点没有密钥,会被拒绝。此流程已保存的密钥在留空时保持不变。',
    },
    objectName: { label: '对象', help: '其记录变更会启动此流程的对象。' },
    condition: {
      label: '进入条件',
      help: 'CEL 表达式 —— 仅当其为 true 时流程才运行(相对时间扫描时对每条匹配记录做门控)。留空则每次事件都运行。',
    },
    'schedule.expression': {
      label: 'Cron 表达式',
      help: 'Cron 表达式 —— 流程运行的时刻。相对时间扫描留空默认每日。',
    },
    'timeRelative.object': { label: '扫描对象', help: '每次运行被扫描的对象。' },
    'timeRelative.dateField': { label: '日期字段', help: '与今天比较的日期 / 日期时间字段。' },
    'timeRelative.withinDays': {
      label: '天数范围内',
      help: '范围模式:当日期在今天前后 N 天内时触发(负值 = 逾期回溯)。若用偏移天数则留空。',
    },
    'timeRelative.offsetDays': {
      label: '偏移天数',
      help: '偏移模式:当日期恰好等于今天 + 各偏移量时触发(如 60、30、7)。若用天数范围则留空。',
    },
    'timeRelative.filter': { label: '附加筛选', help: '与日期窗口做 AND 的可选筛选(如 status = active)。' },
    'timeRelative.maxRecords': { label: '每次最多记录数', help: '每次扫描启动的记录数上限(默认 1000)。' },
    criteria: { label: '进入条件(旧)', help: '旧字段 —— 建议使用“进入条件”(condition)。' },
  },
  end: {
    outcome: {
      label: '结果',
      help: '运行在此处如何结束。“已完成”是普通终态,也是省略该键时的取值。“已拒绝”把拒绝记为一等结果 —— 它是一次成功的评估,只是结论为否 —— 并要求在下方字段中给出拒绝理由 message({{ }} 模板)。',
      opts: { completed: '已完成', refused: '已拒绝' },
    },
    // objectui#9336 —— 仅在“结果”选为“已拒绝”时出现(见 flow-node-config 的
    // `showWhen`);契约两个方向都校验:已拒绝必须有 message,已完成则拒收它。
    message: {
      label: '拒绝原因',
      help: '当结果为“已拒绝”时必填;结果为“已完成”时则被拒收 —— 已完成的结束节点不渲染任何文本,该键会成为静默的空操作。支持 {{ }} 模板(如 {{ record.name }}),与屏幕节点的“描述”一致。',
    },
    // objectui#9335 — an `outputVariable` overlay lived here and went with the
    // descriptor it localized: `EndConfigSchema` refuses that key by name, so
    // the end group no longer offers a field for it (see flow-node-config).
  },
  decision: {
    conditions: {
      label: '分支',
      help: '每个分支包含标签、CEL 表达式和目标节点。表达式为 “true” 的分支即默认 / else 路径。选择目标会接线该分支的出边(创建或更新),清空则断开该边。',
      cols: { label: { label: '标签' }, expression: { label: '表达式' }, target: { label: '目标节点' } },
    },
    condition: { label: '单一条件', help: '旧的单分支条件(CEL)。建议使用上方“分支”;每条边的条件也可写在出边上。' },
  },
  assignment: {
    assignments: { label: '赋值', help: '设置变量:每个键为一个变量,值为表达式或字面量。' },
  },
  loop: {
    collection: {
      label: '集合',
      help: '要遍历的列表:求值为列表的 CEL 表达式(如 leadList),或以 JSON 数组写出的各项。没有循环体区域的循环改为读取列表变量的裸名称。',
    },
    iteratorVariable: { label: '当前项变量', help: '存放当前项的循环变量。' },
    indexVariable: { label: '索引变量', help: '存放当前索引的可选循环变量。' },
    maxIterations: { label: '最大迭代次数' },
  },
  map: {
    collection: { label: '集合', help: '要逐项处理的列表:求值为列表的 CEL 表达式(如 items),或以 JSON 数组写出的各项。' },
    flowName: { label: '每项子流程', help: '为每一项运行的子流程 —— 它可以暂停(如审批)。' },
    iteratorVariable: { label: '当前项变量' },
    itemObject: { label: '项对象', help: '当项为记录时,它们所属的对象(将每项暴露为子流程的记录)。' },
    outputVariable: { label: '输出变量', help: '各项子流程的输出,按顺序收集。' },
  },
  create_record: {
    objectName: { label: '对象' },
    fields: { label: '字段值', help: '写入新记录的字段值。' },
    outputVariable: { label: '输出变量' },
  },
  update_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '标识待更新记录的字段 / 值对。每个值是字面量,或 CEL 表达式(如 id → 以表达式写的 recordId)。' },
    fields: { label: '字段值', help: '要写入的字段值。' },
  },
  delete_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '标识待删除记录的字段 / 值对。每个值是字面量,或 CEL 表达式。' },
  },
  get_record: {
    objectName: { label: '对象' },
    filter: { label: '筛选', help: '待匹配的字段 / 值对(如 status → active)。每个值是字面量,或 CEL 表达式。像 {"$ne": null} 这样的运算符值会被保留。' },
    limit: { label: '数量上限' },
    outputVariable: { label: '输出变量' },
  },
  http: {
    method: { label: '方法' },
    url: { label: 'URL', help: '请求 URL。会渲染 {{ }} 占位。' },
    headers: { label: '请求头', help: '请求头(如 Authorization、Content-Type)。每个值都会渲染 {{ }} 占位。' },
    body: { label: '请求体', help: '请求负载:按原样发送的 JSON,或求值为负载的 CEL 表达式。' },
    // objectui#11968 — no `outputVariable` overlay: the `http` contract declares
    // no such key, so neither form offers a field for it.
    durable: { label: '持久化(异步)', help: '通过持久化队列即发即忘(异步投递)。' },
    signingSecret: { label: '签名密钥', help: 'HMAC-SHA256 密钥 → 写入 X-Objectstack 签名请求头。' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  script: {
    actionType: {
      label: '动作类型',
      help: '本步骤如何运行。“调用函数”会调用已注册的函数 —— 真正执行逻辑的路径。',
      opts: { invoke_function: '调用函数', email: '邮件', slack: 'Slack' },
    },
    function: { label: '函数', help: '要调用的已注册函数 —— 经 defineStack({ functions }) 声明。优先于动作类型。' },
    inputs: { label: '输入', help: '传给函数的值。每个值是字面量,或按流程变量求值的 CEL 表达式。' },
    outputVariable: { label: '输出变量', help: '绑定函数返回值的流程变量,供后续步骤使用。' },
    template: { label: '模板', help: '消息模板 id。' },
    recipients: { label: '收件人', help: '每行一个收件人(用户 id、字段引用或地址)。' },
    variables: { label: '模板变量', help: '注入模板的值。' },
    script: {
      label: '代码(不执行)',
      help: '内置运行时不执行内联脚本 —— 此节点为 no-op。请把逻辑移入已注册函数并使用“调用函数”。',
    },
    timeoutMs: { label: '超时(毫秒)' },
  },
  screen: {
    title: { label: '标题', help: '显示在页面上方的标题。' },
    description: { label: '描述', help: '正文文本。会渲染 {{ }} 占位(如 {{ approval_path }})。' },
    fields: {
      label: '字段',
      help: '此页面收集的输入字段。留空则为纯消息页面。',
      cols: {
        name: { label: '名称' },
        label: { label: '标签' },
        type: { label: '类型' },
        required: { label: '必填' },
        visibleWhen: { label: '显示条件' },
      },
    },
    waitForInput: {
      label: '等待输入',
      help: '即使没有字段也暂停以展示此页面(消息 / 确认)。无字段且关闭此项则为服务端直通。',
    },
    objectName: { label: '对象表单', help: '渲染该对象完整的新建 / 编辑表单(含主从),而非扁平字段列表。' },
    idVariable: { label: '保存记录变量', help: '仅对象表单:绑定到已保存记录 id 的变量,供后续步骤使用。' },
    mode: { label: '表单模式', help: '仅对象表单。', opts: { create: '新建', edit: '编辑' } },
    defaults: { label: '表单默认值', help: '仅对象表单:预填值。每个值是字面量,或 CEL 表达式(如 account → 以表达式写的 account_id)。' },
  },
  approval: {
    approvers: {
      label: '审批人',
      help: '谁可以处理此步骤。为节点的出边打上 “approve” 和 “reject” 标签。',
      cols: {
        type: {
          label: '类型',
          opts: {
            user: '用户',
            position: '岗位',
            org_membership_level: '组织成员(所有者 / 管理员 / 成员)',
            team: '团队',
            department: '部门',
            manager: '上级',
            field: '字段',
            queue: '队列',
          },
        },
        value: { label: '值' },
        group: { label: '分组' },
      },
    },
    behavior: {
      label: '审批方式',
      help: '多个审批人如何组合。任何一个拒绝在所有模式下都是否决。',
      opts: {
        first_response: '首个响应生效',
        unanimous: '全员通过',
        quorum: '法定人数(N 选 M)',
        per_group: '分组会签(每组签核)',
      },
    },
    minApprovals: { label: '最少审批数', help: '所需审批数 —— quorum 为总数,per_group 为每组。服务端会做钳制以防死锁。' },
    lockRecord: { label: '锁定记录', help: '此节点待处理期间锁定触发记录,禁止编辑。' },
    approvalStatusField: {
      label: '状态字段',
      help: '将请求状态(待审 / 通过 / 拒绝)镜像到的业务对象字段。应为只读。',
    },
    'escalation.enabled': { label: 'SLA 升级', help: '在超时内未做决策时升级。' },
    'escalation.timeoutHours': { label: '超时(小时)' },
    'escalation.action': {
      label: '超时动作',
      opts: { notify: '通知', reassign: '改派', auto_approve: '自动通过', auto_reject: '自动拒绝' },
    },
    'escalation.escalateTo': { label: '升级至' },
    'escalation.notifySubmitter': { label: '通知提交人' },
    maxRevisions: {
      label: '最多退回次数',
      help: '请求自动拒绝前的最多退回修订次数(0 表示禁用退回)。需要一条 “revise” 出边才生效。',
    },
  },
  wait: {
    'waitEventConfig.eventType': {
      label: '等待类型',
      opts: { timer: '定时器', signal: '信号', webhook: 'Webhook', manual: '手动', condition: '条件' },
    },
    'waitEventConfig.timerDuration': { label: '时长', help: 'ISO 8601 时长(如 PT1H、P3D)。' },
    'waitEventConfig.signalName': { label: '信号名称' },
    // `waitEventConfig.timeoutMs` / `.onTimeout` 的覆盖随字段一并移除(#3101):
    // 两个键在 spec 17.0.0-rc.1 已是墓碑,表单不再提供授权入口。
  },
  subflow: {
    flowName: { label: '流程' },
    input: { label: '输入映射', help: '传给子流程输入变量的值。每个值是字面量,或在本流程中求值的 CEL 表达式。' },
    outputVariable: { label: '输出变量' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  connector_action: {
    // Client field ids carry the `connectorConfig.` block prefix; the engine's
    // published configSchema uses flat ids — cover both so on/offline match.
    'connectorConfig.connectorId': { label: '连接器' },
    'connectorConfig.actionId': { label: '动作' },
    'connectorConfig.input': { label: '输入', help: '连接器动作的映射输入。' },
    connectorId: { label: '连接器', help: '已注册的连接器名称。' },
    actionId: { label: '动作', help: '连接器声明的动作标识。' },
    input: { label: '输入', help: '连接器动作的映射输入。' },
    timeoutMs: { label: '超时(毫秒)' },
  },
  try_catch: {
    errorVariable: { label: '错误变量', help: '在 catch 区域内绑定所捕获错误的变量。' },
    retry: { label: '重试' },
  },
  // notify's offline table and the engine-published configSchema share these
  // field ids, so one overlay localizes both forms.
  notify: {
    recipients: { label: '收件人', help: '接收通知的人：触发记录的某个字段、用户、团队或邮箱地址。至少需要一个。' },
    title: { label: '标题', help: '通知标题(别名:subject)。' },
    message: { label: '内容', help: '通知正文(别名:body)。' },
    channels: { label: '渠道', help: '扇出投递的渠道(默认站内)。' },
    topic: { label: '主题', help: '事件主题(默认 "notify")。' },
    severity: { label: '级别', help: 'info | warning | critical' },
    sourceObject: { label: '来源对象', help: '通知所关联记录的对象名。' },
    sourceId: { label: '来源记录', help: '通知链接到的记录 id(需配合来源对象):以文本写出的 id,或 CEL 表达式(如 record.id)。' },
    actorId: { label: '触发用户', help: '引发该事件的用户 id。' },
    // objectui#11968 — keyed `actionUrl`, the key the contract declares and both
    // forms now write; the `url` spelling is the converted alias.
    actionUrl: { label: '链接 URL', help: '显式的点击跳转 URL;覆盖默认值。会渲染 {{ }} 占位。' },
    payload: { label: '附加数据', help: '合并进模板输入的额外数据。' },
  },
  boundary_event: {
    'boundaryConfig.attachedToNodeId': { label: '附加到', help: '此边界事件所监视的宿主节点。' },
    'boundaryConfig.eventType': {
      label: '事件类型',
      opts: { error: '错误', timer: '定时器', signal: '信号', cancel: '取消' },
    },
    'boundaryConfig.interrupting': { label: '中断', help: '此事件触发时取消宿主活动。' },
    'boundaryConfig.errorCode': { label: '错误码' },
    'boundaryConfig.timerDuration': { label: '时长' },
    'boundaryConfig.signalName': { label: '信号名称' },
  },
  legacy_action: {
    action: { label: '动作' },
    objectName: { label: '对象' },
    recordId: { label: '记录' },
    params: { label: '参数', help: '动作输入。值会自动定型:3 → 数字,true → 布尔。' },
    fields: { label: '字段值' },
    outputVariable: { label: '输出变量' },
  },
};

/** zh-CN overrides for a flow config field, or `undefined` for an unknown one. */
export function flowFieldZh(type: string, id: string): FlowFieldZh | undefined {
  return FLOW_FIELD_ZH[type]?.[id];
}

function pickTable(
  locale: SupportedLocale | string | undefined,
): { types: Record<string, string>; domains: Record<string, string>; strings: Record<string, string> } {
  const lower = (locale ?? '').toLowerCase();
  if (lower.startsWith('zh')) {
    return { types: TYPE_LABELS_ZH, domains: DOMAIN_LABELS_ZH, strings: ENGINE_STRINGS_ZH };
  }
  return { types: TYPE_LABELS_EN, domains: DOMAIN_LABELS_EN, strings: ENGINE_STRINGS_EN };
}

/**
 * The value of one designer string: this module's own table for the locale
 * first, then the `studio` namespace in `@object-ui/i18n`, which the table is
 * moving into slice by slice (objectstack#25922, ruling 6431032267 Q2 = A).
 * A key lives in exactly one of the two homes — `check:i18n-designer-parity`
 * fails on a key in both — so the order decides nothing but cost.
 *
 * The namespace answers a language it has no catalogue for, and a catalogue
 * still being fetched, from its `en` catalogue; this table keeps its own
 * behaviour for the keys it still holds (a key its zh half lacks echoes back).
 */
function lookupString(key: string, locale: SupportedLocale | string | undefined): string | undefined {
  return pickTable(locale).strings[key] ?? studioString(key, locale);
}

export function translateMetadataType(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string {
  // Prefer locale table when the locale has a translation for this type.
  // This ensures Chinese labels win over the English `label` baked into
  // the server's metadata registry (which would otherwise show "Field"
  // even when the user's locale is zh-CN).
  const localized = pickTable(locale).types[type];
  if (localized) return localized;
  // Fall back to caller-supplied label (typically the server's English one).
  return fallback ?? type;
}

export function translateMetadataDomain(
  domain: string,
  locale?: SupportedLocale | string,
): string {
  return pickTable(locale).domains[domain] ?? domain;
}

/**
 * Localized display label for a flow node type (palette + node cards).
 *
 * Mirrors {@link translateMetadataType}: the locale table wins for built-in
 * node types (so they read Chinese under zh-CN), while the caller-supplied
 * `fallback` — typically the engine descriptor's server-authoritative `name`,
 * or the hardcoded NODE_PALETTE label offline — covers plugin / unknown types
 * and the English locale (whose table intentionally carries no `flowNode.*`
 * keys, keeping the server descriptor authoritative in English). The
 * `engine.flowNode.*` rows are resolved by translateNodeLabel/Hint through
 * `lookupString`, so they answer from the `studio` namespace's `zh` catalogue
 * (objectstack#25922).
 */
export function translateNodeLabel(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string {
  const localized = lookupString(`engine.flowNode.${type}.label`, locale);
  if (localized) return localized;
  return fallback ?? type;
}

/** Localized one-line hint for a flow node type. See {@link translateNodeLabel}. */
export function translateNodeHint(
  type: string,
  locale?: SupportedLocale | string,
  fallback?: string,
): string | undefined {
  const localized = lookupString(`engine.flowNode.${type}.hint`, locale);
  if (localized) return localized;
  return fallback;
}

/**
 * zh-CN labels for the flow-level meta values shown in the canvas header pills
 * (trigger type / status / run-as / on-error). Keyed by pill kind → raw value.
 * English is a no-op (raw value shown), and any value not listed here falls
 * back to its raw form — so this never hides an unexpected value.
 */
const FLOW_META_ZH: Record<string, Record<string, string>> = {
  type: {
    autolaunched: '自动启动',
    record_change: '记录变更',
    schedule: '定时',
    time_relative: '相对时间',
    screen: '交互页面',
    api: 'API',
    manual: '手动',
    webhook: 'Webhook',
    event: '平台事件',
  },
  status: { active: '启用', draft: '草稿', inactive: '停用' },
  runAs: { user: '用户', system: '系统', owner: '记录所有者' },
  onError: { stop: '停止', continue: '继续', rollback: '回滚', retry: '重试', fail: '失败' },
};

/** Localized display for a flow-level meta value (header pills). English = raw. */
export function translateFlowMeta(
  kind: 'type' | 'status' | 'runAs' | 'onError',
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  return FLOW_META_ZH[kind]?.[value] ?? value;
}

/**
 * zh-CN labels for the overlay-scope vocabulary, keyed by the spec's own enum.
 *
 * The key type is `@objectstack/spec`'s `GetMetaItemLayeredResponseSchema`
 * `overlayScope` union, reached through `MetadataOverlayScope` — so the day the
 * spec adds a scope this record stops compiling and names the label that is
 * missing, instead of the badge silently shipping a raw English value. That
 * silent path is objectui#4982: `overlayScope` reached the badge untranslated
 * while the only two values it can hold had no entry in the table below.
 *
 * Deliberately zh-only, like every other group here — `translateConsoleValue`
 * returns the raw value for the other nine locale packs by existing design, and
 * whether to extend it is a separate decision, not a rider on this fix.
 *
 * `org` left this table with the spec's enum (objectstack#15206 S5, ADR-0131),
 * when objectui#12030 moved to `@objectstack/spec` 18: no served response
 * carries it, and an `org` from an older server is outside the union, so
 * `translateConsoleValue` hands it back raw rather than refusing it.
 */
const LAYER_SCOPE_ZH: Record<NonNullable<MetadataOverlayScope>, string> = {
  env: '环境',
};

/**
 * zh-CN labels for the ADR-0010 §3.6 four-state metadata lock, keyed by the
 * producer field the only consumer actually renders.
 *
 * The key type is `MetadataAuditEntry['lockState']`, which since objectui#5024
 * is `MetadataLockState` — derived from `GetMetaItemLayeredResponseSchema`'s
 * `z.enum` in `@objectstack/spec`. It was a hand-written union in
 * `packages/data-objectstack/src/metadata-client.ts` when this comment was
 * first written, on the belief that the spec had no enum to derive from; the
 * spec does declare one (17.1.0), so the question of ownership this comment
 * used to leave open is answered upstream, not here. Binding the keys means a
 * fifth lock state stops this record from compiling and names the label that is
 * missing, instead of the column silently shipping a raw English token.
 *
 * That silent path is objectui#5004, and it was total rather than partial: the
 * table used to hold `draft` / `locked` / `published` / `none` — a draft-status
 * vocabulary — so of the three values the audit column can actually show, zero
 * had an entry. A zh-CN admin read bare `no-overlay` / `no-delete` / `full`.
 *
 * Wording tracks the lock banner sentences a reader meets on the same screen
 * (`engine.edit.lockNoOverlay` 不可编辑 / `lockNoDelete` 不可删除 / `lockFull`
 * 不可编辑或删除), compressed to state names for a narrow badge column.
 *
 * `none` is currently unreachable through the sole call site — `AuditPanel`
 * renders an em dash for an unlocked/`null` row rather than a word — and is kept
 * anyway: the key set follows the producer's type, so the record stays complete
 * over the domain and does not need editing the day that presentation choice
 * changes.
 *
 * Deliberately zh-only, like every other group here — `translateConsoleValue`
 * returns the raw value for the other nine locale packs by existing design, and
 * whether to extend it is a separate decision, not a rider on this fix.
 */
const LOCK_STATE_ZH: Record<NonNullable<MetadataAuditEntry['lockState']>, string> = {
  none: '无',
  'no-overlay': '禁止编辑',
  'no-delete': '禁止删除',
  full: '完全锁定',
};

/**
 * zh-CN labels for the metadata-editor side panels' raw enum-ish values —
 * History operation badges, Audit operation/outcome/lock-state, and the Layered
 * diff tab badges. Shared by every metadata type (not flow-specific). English
 * (and any value not listed) shows the raw value, so unknown ops never break.
 */
const CONSOLE_VALUE_ZH: Record<string, Record<string, string>> = {
  op: {
    create: '创建',
    update: '更新',
    delete: '删除',
    tombstone: '已删除',
    publish: '发布',
    revert: '回滚',
    save: '保存',
    restore: '恢复',
    rollback: '回滚',
  },
  outcome: { allowed: '允许', denied: '拒绝', forced: '强制' },
  lock: LOCK_STATE_ZH,
  layer: {
    artifact: '工件',
    none: '无',
    merged: '合并',
    set: '已设',
    overlay: '覆盖',
    ...LAYER_SCOPE_ZH,
  },
};

/** Localized label for a metadata-editor side-panel value (English = raw). */
export function translateConsoleValue(
  group: 'op' | 'outcome' | 'lock' | 'layer',
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  return CONSOLE_VALUE_ZH[group]?.[value] ?? value;
}

/** Schema-form enum field names that reuse the flow header meta value maps. */
const ENUM_FIELD_TO_META: Record<string, keyof typeof FLOW_META_ZH> = {
  type: 'type',
  status: 'status',
  runAs: 'runAs',
  run_as: 'runAs',
};

/**
 * Localized label for a raw JSON-Schema enum option in the metadata SchemaForm
 * (e.g. the flow `type` picker: `autolaunched` → 自动启动). Keyed by field name
 * so it's unambiguous; English (and any value not translated) shows the raw
 * value, so unknown enums across the 27 metadata types are never hidden. Reuses
 * {@link FLOW_META_ZH} for type/status/runAs, plus an `engine.enum.<field>.<value>`
 * strings-table extension point for anything else.
 */
export function translateEnumOption(
  fieldName: string,
  value: string,
  locale?: SupportedLocale | string,
): string {
  if (!isZhLocale(locale)) return value;
  const kind = ENUM_FIELD_TO_META[fieldName];
  if (kind && FLOW_META_ZH[kind]?.[value]) return FLOW_META_ZH[kind][value];
  const direct = lookupString(`engine.enum.${fieldName}.${value}`, locale);
  if (direct) return direct;
  // A `type` field can also hold a flow-NODE type (the node sub-form's type
  // picker) — reuse the node label table so create_record → 创建记录 etc.
  if (fieldName === 'type') {
    const nodeLabel = lookupString(`engine.flowNode.${value}.label`, locale);
    if (nodeLabel) return nodeLabel;
  }
  return value;
}

/**
 * Generic zh-CN labels for raw JSON-Schema fields the metadata SchemaForm
 * renders without a client `fieldSpec.label` — chiefly the flow edge/node
 * sub-forms (Source / Target / Condition / …). Names here have one unambiguous
 * meaning across metadata types, so the zh label is universally correct; English
 * (and any name not listed) keeps the schema's own title. Applied only as a
 * fallback UNDER `fieldSpec.label`, so curated top-level forms are untouched.
 */
const SCHEMA_FIELD_LABEL_ZH: Record<string, string> = {
  id: 'ID',
  name: '名称',
  label: '标签',
  type: '类型',
  description: '描述',
  source: '源节点',
  target: '目标节点',
  condition: '条件',
  isDefault: '默认',
  nodes: '节点',
  edges: '连线',
  config: '配置',
  outputVariable: '输出变量',
};

/** zh-CN help text for the unambiguous (edge-specific) raw schema fields. */
const SCHEMA_FIELD_HELP_ZH: Record<string, string> = {
  source: '源节点 ID',
  target: '目标节点 ID',
  condition: '用于分支的 CEL 布尔表达式',
  isDefault: '当没有其他条件匹配时,将此连线标记为默认路径',
};

/** Localized label for a raw schema field (falls back to the schema title). */
export function translateSchemaFieldLabel(
  name: string,
  fallback: string | undefined,
  locale?: SupportedLocale | string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_LABEL_ZH[name];
    if (v) return v;
  }
  return fallback;
}

/** Localized help for a raw schema field (falls back to the schema description). */
export function translateSchemaFieldHelp(
  name: string,
  fallback: string | undefined,
  locale?: SupportedLocale | string,
): string | undefined {
  if (isZhLocale(locale)) {
    const v = SCHEMA_FIELD_HELP_ZH[name];
    if (v) return v;
  }
  return fallback;
}

export function t(key: string, locale?: SupportedLocale | string): string {
  return lookupString(key, locale) ?? key;
}

/**
 * Like {@link t}, but returns `undefined` when the active locale's table has
 * no entry — instead of echoing the key back as if it were a translation.
 *
 * For strings this console does not OWN (`add10d8f9`). The package form's
 * help text is `@objectstack/spec`'s `ManifestSchema` `.describe()`, produced
 * in the framework repo and already reaching the form through the
 * spec-derived JSONSchema; only the zh rendering lives here. A caller uses
 * this so an en-US console finds nothing and falls through to the producer's
 * own sentence, rather than reading a copy of it that this repo would then
 * have to keep in step with the spec by hand.
 *
 * ⚠️ Never reach for this to paper over a MISSING key in a string this
 * console does own — a missing key must stay loud (`t` echoing `engine.…`
 * back is what makes it visible). Use it only where a producer-owned fallback
 * is the deliberate other half.
 */
export function tOptional(
  key: string,
  locale?: SupportedLocale | string,
): string | undefined {
  return lookupString(key, locale);
}

/**
 * Format a translated string with `{token}` placeholders.
 *
 *   tFormat('engine.directory.description', 'zh-CN', { count: 28, writable: 4 })
 */
export function tFormat(
  key: string,
  locale: SupportedLocale | string | undefined,
  vars: Record<string, string | number>,
): string {
  const template = t(key, locale);
  return template.replace(/\{(\w+)\}/g, (_m, name) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

export function translateValidationMessage(
  message: string | undefined,
  locale?: SupportedLocale | string,
): string {
  const raw = String(message ?? '').trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === 'invalid' || lower === 'invalid input') {
    return t('engine.validation.invalid', locale);
  }
  const patternMatch = raw.match(/^Invalid string: must match pattern (.+)$/);
  if (patternMatch) {
    return tFormat('engine.validation.pattern', locale, { pattern: patternMatch[1] });
  }
  const expectedMatch = raw.match(/^Invalid input: expected (.+), received (.+)$/);
  if (expectedMatch) {
    const expected = expectedMatch[1];
    const received = expectedMatch[2];
    if (expected === 'string' && received === 'undefined') {
      return t('engine.validation.expectedStringUndefined', locale);
    }
    return tFormat('engine.validation.expectedType', locale, { expected, received });
  }
  const optionMatch = raw.match(/^Invalid option: expected one of (.+)$/);
  if (optionMatch) {
    return tFormat('engine.validation.invalidOption', locale, { options: optionMatch[1] });
  }
  if (lower === 'required' || lower === 'is required') {
    return t('engine.validation.nameRequired', locale);
  }
  if (lower === 'invalid json') {
    return t('engine.form.invalidJson', locale);
  }
  return raw;
}

/**
 * Returns the locale string most browsers report (matches navigator.language).
 *
 * ⚠️ Non-reactive and browser-only — it ignores the app language picked in
 * the LocaleSwitcher. Component code should use {@link useMetadataLocale}
 * instead, which follows the live i18next language (and re-renders on
 * change); this stays only as a fallback for non-hook call sites.
 */
export function detectLocale(): SupportedLocale {
  if (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)) return 'zh-CN';
  return 'en-US';
}

/**
 * React hook — the Studio/metadata-admin locale derived from the app's ACTIVE
 * i18n language, collapsed to one of the two locales this catalog ships.
 *
 * Prefer this over {@link detectLocale} in components: `detectLocale()` reads
 * `navigator.language`, which never changes when the user switches languages
 * in-app via the LocaleSwitcher (that only moves the i18next instance). This
 * follows the live `useObjectTranslation().language`, so the Studio pillars
 * re-render in lock-step with the console locale — the same source the rest of
 * the app (Home, forms, list views) renders from.
 *
 * ⛔ Never hand this value to `Intl` (`Intl.*Format`, `toLocale*String`) as the
 * locale a date, time or number is formatted in. It picks one of this file's
 * TWO string tables, so it is `'en-US'` for every language that is not zh — a
 * de-DE session would read its faces in US English (objectui#10232). Faces
 * format with `useDisplayLocale()` from `@object-ui/i18n`, the channel every
 * date and number renderer resolves through; keep this value for `t()` /
 * `tFormat()` and the other lookups into the tables here.
 */
export function useMetadataLocale(): SupportedLocale {
  const { language } = useObjectTranslation();
  const locale: SupportedLocale = /^zh/i.test(language) ? 'zh-CN' : 'en-US';
  // Starts the fetch of the `studio` namespace catalogue this locale reads and
  // re-renders the caller when it lands, so a moved key does not stay on the
  // `en` answer the first render gave.
  useStudioCatalogue(locale);
  return locale;
}
