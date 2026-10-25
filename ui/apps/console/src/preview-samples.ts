/**
 * DEV-ONLY sample drafts for the metadata-designer gallery harness.
 * Not shipped in production builds (referenced only by preview-gallery.tsx).
 */

export const SAMPLES: Record<string, Record<string, unknown>> = {
  object: {
    name: 'sales_order',
    label: 'Sales Order',
    description: 'Customer purchase orders and their line items.',
    fields: [
      { name: 'name', label: 'Order Name', type: 'text', required: true },
      { name: 'amount', label: 'Amount', type: 'currency' },
      // Option OBJECTS, not bare strings (objectui#6844). `FieldSchema` refuses
      // a string here — `invalid_type`, "expected object, received string", one
      // per entry — and the designer could not read them either
      // (`ObjectFieldInspector`'s `readOptions()` does `String(o?.value ?? '')`,
      // so the three strings rendered as three BLANK rows in the option editor).
      //
      // The `value` codes are NOT a matter of taste: `SelectOptionSchema.value`
      // is a SYSTEM IDENTIFIER, so `'Draft'` is rejected outright
      // (`invalid_format`, "must be lowercase, starting with a letter, and may
      // contain letters, numbers, underscores, or dots"; minimum two
      // characters). The authored strings therefore become the human `label`
      // and the machine code is its lowercase spelling — the pairing the whole
      // ecosystem already writes, from `os init`'s generated object down to the
      // showcase objects. `label` + `value` are exactly the two members an
      // empty `{}` here reports as missing, and nothing beyond them is invented:
      // `color`, `default` and `visibleWhen` are all accepted, but a sample
      // teaches what it shows, and this field exists to demonstrate a picklist.
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
      },
      { name: 'close_date', label: 'Close Date', type: 'date' },
      // The lookup target is `reference` (objectui#6647). `reference_to` is
      // refused BY NAME by `FieldSchema` — `unrecognized_keys` with its own
      // did-you-mean — and the designer never read it either:
      // `ObjectFieldInspector` seeds its Lookup-target box from `def.reference`,
      // so the old spelling rendered that box EMPTY on the very sample that
      // exists to demonstrate a lookup. (The retired camelCase twin
      // `referenceTo` is tombstoned to the same spec key, objectui#6041.)
      { name: 'account', label: 'Account', type: 'lookup', reference: 'account' },
      { name: 'is_priority', label: 'Priority', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },

  // Every `type` here must resolve in the ComponentRegistry, and every config
  // bag must be `properties` — both are guarded, and both were broken
  // (objectui#3446). The page previously opened with `{ type: 'heading' }`,
  // which has never been registered in this repo: the spec accepts it
  // (`PageComponentSchema.type` is the enum OR any string, so plugins can
  // contribute blocks), so it parsed clean while rendering as a
  // ComponentRegistry fallback box — the gallery's example of a composed page
  // was showing two placeholders where its title and section heading belong.
  //
  // The canonical spellings, all from `PageComponentType`:
  //   • the page title is a `page:header` (not a level-1 text block) — it owns
  //     the h1, the subtitle, the breadcrumb/action slots and the bottom rule;
  //     `recordChrome: false` selects the bare non-record layout, since this is
  //     a welcome page with no bound record.
  //   • in-body headings are `element:text` with a heading variant — `h3`
  //     renders an h3, which is what the old `level: 3` asked for. The variant
  //     names the level, the same nine values `ui:text` takes (objectui#7450);
  //     `heading` / `subheading` are the pre-convergence spellings, refused
  //     since `@objectstack/spec` 17.7.0 and not authored here. (A heading is a VARIANT of element:text, never a type;
  //     `{ type: 'heading' }` is the near-miss the original made.)
  //   • the rule is `element:divider`. The old bare `separator` did resolve —
  //     `ui:separator` claims the bare name — but it is not a page block type,
  //     and the `element:*` family is what the designer palette offers.
  //
  // Config lives under `properties`, NOT `props`: PageComponentSchema is
  // `.strict()` and rejects `props` by name (ADR-0089 D3a). That mis-layering
  // is why `page` sat in this file's spec-conformance ledger; the two are one
  // fix, because `page:header` reads `title` off `schema`/`schema.properties`
  // and would have rendered an empty header bar from a `props` bag.
  page: {
    name: 'crm_welcome',
    label: 'CRM Welcome',
    // Declared, NOT defaulted (objectui#3454). `PageSchema.type` is
    // `PageTypeSchema.default('record')`, so omitting it does not mean
    // "unspecified" — it materialises this welcome screen as a RECORD page
    // bound to no object (`object` is optional, so nothing complains). The app
    // sample below routes this very page as the CRM's landing entry
    // (`navigation[0]` = `{ id: 'home', type: 'page', pageName: 'crm_welcome' }`),
    // so `home` is the kind it is actually used as. Spelling it out is what
    // makes the sample mean what it demonstrates: the gallery renders the
    // unparsed draft and would never have shown the difference, but these
    // samples are copied — increasingly by models generating metadata — and a
    // landing page that silently defaults to `record` propagates as such.
    type: 'home',
    regions: [
      {
        name: 'main',
        components: [
          { type: 'page:header', properties: { title: 'Welcome to the CRM', recordChrome: false } },
          { type: 'element:text', properties: { content: 'Track accounts, contacts, and deals in one place.' } },
          { type: 'element:divider' },
          { type: 'element:text', properties: { content: 'Quick links', variant: 'h3' } },
          { type: 'element:text', properties: { content: 'Open the pipeline, review tasks, or create a new lead.' } },
        ],
      },
    ],
  },

  view: {
    name: 'open_orders',
    label: 'Open Orders',
    object: 'sales_order',
    list: {
      type: 'grid',
      // No `object` here: the view root above declares it. The list view is
      // `.strict()` since spec 17.0.0, so repeating it one level down is a
      // hard error rather than a silently dropped key.
      columns: ['name', 'amount', 'status', 'close_date'],
    },
  },

  dashboard: {
    name: 'sales_overview',
    label: 'Sales Overview',
    widgets: [
      { id: 'kpi_revenue', type: 'metric', title: 'Revenue', value: 128400, format: 'currency' },
      { id: 'kpi_orders', type: 'metric', title: 'Orders', value: 342 },
      { id: 'chart_trend', type: 'chart', title: 'Monthly Trend' },
    ],
  },

  // ADR-0021 single form: a report binds a semantic-layer `dataset` and selects
  // its measures (`values`) grouped by dimensions (`rows`, plus `columns`
  // across for a matrix). The inline-query form this sample used
  // (`object` + `columns: [{ field, label }]` + `groupBy`) was removed in the
  // 9.0 cutover — `ReportSchema` is non-strict, so `object`/`groupBy` were
  // silently stripped and the draft then failed for having no `dataset`.
  report: {
    name: 'orders_by_status',
    label: 'Orders by Status',
    type: 'summary',
    dataset: 'sales_orders',
    rows: ['status'],
    values: ['order_count', 'total_amount'],
    order: [{ by: 'total_amount', direction: 'desc' }],
  },

  // Navigation is a DISCRIMINATED UNION on `type`, and every branch is
  // `.strict()`: an app does not route by hand-written `path`, it names the
  // metadata record to open (`objectName` / `pageName` / `dashboardName` /
  // `url`) and the shell builds the route. `id` is required so a nav entry can
  // be addressed by a patch.
  //
  // There is no landing-page key: `landing` was removed in objectstack#4001,
  // its replacement `homePageId` was retired in objectstack#4667 / #4709, and
  // the app now opens on the FIRST navigation item that yields a route — here
  // `home`. To change where an app opens, reorder `navigation`.
  app: {
    name: 'crm',
    label: 'CRM',
    icon: 'briefcase',
    navigation: [
      { id: 'home', type: 'page', label: 'Home', pageName: 'crm_welcome' },
      { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' },
      { id: 'orders', type: 'object', label: 'Sales Orders', objectName: 'sales_order', viewName: 'open_orders' },
      { id: 'dashboard', type: 'dashboard', label: 'Dashboard', dashboardName: 'sales_overview' },
      {
        id: 'admin',
        type: 'group',
        label: 'Admin',
        children: [
          { id: 'settings', type: 'page', label: 'Settings', pageName: 'crm_settings' },
          { id: 'docs', type: 'url', label: 'Docs', url: 'https://docs.example.com', target: '_blank' },
        ],
      },
    ],
  },

  action: {
    name: 'close_order',
    label: 'Close Order',
    // `server` was never an ActionType — the server-side form is `script` with
    // a `target` naming a registered bundle function (a `script` action without
    // `body` or `target` is rejected: it would register no handler at all).
    type: 'script',
    target: 'closeOrder',
    objectName: 'sales_order',
    icon: 'check',
    variant: 'primary',
    // Spec-17 placement vocabulary; the pre-17 `record`/`list` shorthands are
    // not in the enum (and the ActionPreview placement mock renders nothing
    // for them, so the "Where it appears" section was empty).
    locations: ['record_header', 'list_toolbar'],
    confirmText: 'Close this order? This cannot be undone.',
    successMessage: 'Order closed.',
    // No `bulkEnabled`: RETIRED in spec 17 (objectstack#3896). The multi-select
    // toolbar is driven by the LIST VIEW's `bulkActions`, never by this flag.
    refreshAfter: true,
  },

  flow: {
    name: 'renewal_reminder_flow',
    label: 'Renewal Reminder',
    status: 'active',
    version: 2,
    runAs: 'system',
    // FlowType enum is `autolaunched | record_change | schedule | screen | api`
    // — the start node below is a cron trigger, so `schedule` (not `scheduled`).
    type: 'schedule',
    // FlowVariableSchema is `.strict()` over name/type/isInput/isOutput — a
    // `description` here is rejected, not merely ignored.
    variables: [
      { name: 'daysBefore', type: 'number', isInput: true },
      { name: 'contract', type: 'object', isInput: true },
      { name: 'reminded', type: 'boolean', isOutput: true },
    ],
    nodes: [
      { id: 'start', type: 'start', label: 'Schedule (daily)', config: { triggerType: 'schedule', objectName: 'contract', condition: 'status == "active"', cron: '0 9 * * *' } },
      { id: 'find', type: 'get_record', label: 'Find expiring contracts', config: { objectName: 'contract', filter: { status: 'active' }, outputVariable: 'contracts' } },
      // ADR-0031 structured container: a loop whose `config.body` region is a
      // nested sub-graph. On the designer canvas it expands inline (#2680) and
      // its body nodes are selectable + editable through the same schema-driven
      // inspector as top-level nodes (#2670 Phase 3).
      {
        id: 'each_contract',
        type: 'loop',
        label: 'For each expiring contract',
        config: {
          collection: '{contracts}',
          iteratorVariable: 'contract',
          body: {
            nodes: [
              // `http`: spec 18 reserves `http_request` (objectui#12742). Its
              // strict contract declares no `outputVariable`, so none is written.
              { id: 'charge_fee', type: 'http', label: 'Charge renewal fee', config: { method: 'POST', url: 'https://api.example.com/billing/charge' } },
            ],
            edges: [],
          },
        },
      },
      { id: 'fan_out', type: 'parallel', label: 'Notify in parallel', config: { branches: [ { name: 'Email the owner', nodes: [ { id: 'email_owner', type: 'script', label: 'Email Owner', config: { function: 'compose_owner_email', inputs: { template: 'renewal_reminder', to: 'owner.email' }, outputVariable: 'ownerEmail' } } ], edges: [] }, { name: 'Post to Slack', nodes: [ { id: 'slack_post', type: 'script', label: 'Slack Notify', config: { function: 'compose_slack_message', outputVariable: 'slackMessage' } } ], edges: [] } ] } },
      { id: 'guard', type: 'try_catch', label: 'Push with retry', config: { errorVariable: '$error', try: { nodes: [ { id: 'push', type: 'http', label: 'Push to CRM', config: { method: 'POST', url: 'https://api.example.com/v1/tasks' } } ], edges: [] }, catch: { nodes: [ { id: 'record_failure', type: 'update_record', label: 'Flag Sync Failure', config: { objectName: 'contract', fields: { reminded: false } } } ], edges: [] } } },
      { id: 'check', type: 'decision', label: 'Within reminder window?', config: { conditions: [ { label: 'Within window', expression: 'daysToExpiry <= daysBefore' }, { label: 'Else', expression: 'true' } ] } },
      { id: 'email', type: 'connector_action', label: 'Send renewal email', connectorConfig: { connectorId: 'email', actionId: 'send', input: { to: 'owner.email', template: 'renewal_reminder' } } },
      // No `waitEventConfig.onTimeout`: RETIRED in spec 17 (objectstack#4158).
      // It had no readers — a wait node resumes only when its timer elapses or
      // its signal arrives; there is no timeout branch to configure.
      { id: 'wait', type: 'wait', label: 'Wait 3 days', waitEventConfig: { eventType: 'timer', timerDuration: 'P3D' } },
      { id: 'task', type: 'create_record', label: 'Create CSM follow-up', config: { objectName: 'task', fields: { subject: 'Renewal follow-up', priority: 'high' } } },
      { id: 'skip', type: 'update_record', label: 'Mark as not due', config: { objectName: 'contract', filter: { id: '{contractId}' }, fields: { reminded: false } } },
      { id: 'review', type: 'screen', label: 'CSM review', config: { fields: [ { name: 'discount', label: 'Discount %', type: 'number', required: false }, { name: 'note', label: 'Note', type: 'text', required: true, visibleWhen: 'discount > 0' } ] } },
      // The four `script` nodes use the script contract `@objectstack/spec` 17.5.0
      // enforces (objectui#11073): a REQUIRED `function` naming a registered
      // function, optional `inputs` and `outputVariable`. The keys they carried
      // before — `actionType`, `template`, `recipients`, `variables`, `script`,
      // `outputVariables` — are spec 17 tombstones the executor refuses by name,
      // and a script is contractually pure, so these compose a value a later
      // declarative node sends rather than sending it themselves.
      { id: 'notify', type: 'script', label: 'Email the owner', config: { function: 'compose_renewal_reminder', inputs: { template: 'renewal_reminder', contractId: '{contractId}' }, outputVariable: 'reminder' } },
      { id: 'enrich', type: 'script', label: 'Score (code)', config: { function: 'score_contract', inputs: { contractId: '{contractId}' }, outputVariable: 'score' } },
      // `completed`, not `success`: @objectstack/spec 17.4.0 narrowed the end
      // node's outcome enum to `completed | refused` (objectui#8785). `refused`
      // is not interchangeable — the spec additionally REQUIRES a `message`
      // beside it, because a refusal with no text is the shape that contract
      // exists to replace. This sample ends successfully, so it is `completed`.
      { id: 'end', type: 'end', label: 'End', config: { outcome: 'completed' } },
    ],
    // `FlowEdgeSchema.id` is REQUIRED — the canvas already keys off it when
    // present (splitting an edge, adding a back-edge), and an id-less edge
    // cannot be addressed by a patch.
    edges: [
      { id: 'e_start_find', source: 'start', target: 'find' },
      { id: 'e_find_each', source: 'find', target: 'each_contract' },
      { id: 'e_each_fan_out', source: 'each_contract', target: 'fan_out' },
      { id: 'e_fan_out_guard', source: 'fan_out', target: 'guard' },
      { id: 'e_guard_check', source: 'guard', target: 'check' },
      { id: 'e_check_email', source: 'check', target: 'email', condition: 'daysToExpiry <= daysBefore' },
      { id: 'e_check_skip', source: 'check', target: 'skip', isDefault: true },
      { id: 'e_email_wait', source: 'email', target: 'wait' },
      { id: 'e_wait_task', source: 'wait', target: 'task' },
      { id: 'e_task_review', source: 'task', target: 'review' },
      { id: 'e_review_notify', source: 'review', target: 'notify' },
      { id: 'e_notify_enrich', source: 'notify', target: 'enrich' },
      { id: 'e_enrich_end', source: 'enrich', target: 'end' },
      { id: 'e_skip_end', source: 'skip', target: 'end' },
    ],
  },

  workflow: {
    name: 'on_order_won',
    label: 'On Order Won',
    object: 'sales_order',
    active: true,
    triggerType: 'onUpdate',
    criteria: "status == 'Closed'",
    executionOrder: 1,
    actions: [
      { type: 'fieldUpdate', label: 'Set Won Date', field: 'won_date' },
      { type: 'email', label: 'Notify Owner' },
      { type: 'task', label: 'Create Follow-up Task' },
    ],
    timeTriggers: [{ label: 'Reminder', offset: '2 days' }],
  },

  approval: {
    name: 'expense_approval',
    label: 'Expense Approval',
    object: 'expense',
    active: true,
    entryCriteria: 'amount > 500',
    lockRecord: true,
    approvalStatusField: 'approval_status',
    steps: [
      { label: 'Manager Review', approvers: ['manager'], criteria: 'amount <= 5000' },
      { label: 'Finance Review', approvers: ['finance_team'] },
      { label: 'VP Sign-off', approvers: ['vp'], criteria: 'amount > 20000' },
    ],
    onFinalApprove: [{ type: 'fieldUpdate', label: 'Mark Approved' }],
    onFinalReject: [{ type: 'email', label: 'Notify Submitter' }],
  },

  job: {
    name: 'nightly_sync',
    label: 'Nightly Sync',
    description: 'Sync external orders into the warehouse.',
    enabled: true,
    schedule: { type: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
    handler: 'syncOrders',
    retryPolicy: { maxRetries: 3 },
    // `timeoutMs`, not `timeout` — @objectstack/spec 17.4.0 RETIRED the bare
    // spelling and put the unit in the key name, the same ruling that renamed
    // `dashboard.refreshInterval` (ruling B on objectstack#14478): the sibling
    // `retryPolicy.backoffMs` already spelled its own unit, so one surface was
    // teaching two conventions. The VALUE is unchanged — still milliseconds.
    // There is no `concurrency` key on a job either; `JobSchema` is `.strict()`
    // since spec 17.0.0, so both retired spellings are rejected by name rather
    // than dropped (objectui#8785).
    timeoutMs: 600000,
  },

  agent: {
    name: 'sales_copilot',
    label: 'Sales Copilot',
    role: 'Assistant for sales reps',
    active: true,
    model: { provider: 'openai', model: 'gpt-4o', temperature: 0.4, maxTokens: 2048 },
    instructions:
      'You are a helpful sales assistant. Answer questions about accounts and orders, and draft follow-up emails. Always cite the record you used.',
    // An agent reaches exactly the tools its surface-compatible skills declare
    // (ADR-0064). No `tools` (RETIRED, objectstack#3894 — put the reference in
    // a skill instead) and no `knowledge` (RETIRED, objectstack#3896 — it never
    // scoped retrieval; describe intended grounding in `instructions`).
    skills: ['summarize_account', 'draft_email'],
  },

  tool: {
    name: 'query_orders',
    label: 'Query Orders',
    description: 'Run a parameterized ObjectQL query against sales orders.',
    objectName: 'sales_order',
    parameters: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        limit: { type: 'number', description: 'Max rows' },
      },
    },
    outputSchema: { type: 'array' },
  },

  skill: {
    name: 'draft_email',
    label: 'Draft Email',
    // No `type`: `SkillSchema` has no such key, so `type: 'prompt'` parsed and was
    // then silently dropped. The key that classifies a skill is `surface`
    // (`ask` | `build` | `both`, default `ask`, ADR-0063 §3) — it gates which agents
    // may bind the skill, and there is no 'prompt' among its values.
    description: 'Draft a follow-up email from a record context.',
    active: true,
    instructions: 'Write a concise, friendly follow-up email referencing the order.',
    tools: ['lookup_company'],
    // No `triggerPhrases`: RETIRED in spec 17 (objectstack#3896) — phrases were
    // never matched against the user's message. Activation is `triggerConditions`
    // (an AND of context field/operator/value) intersected with the agent's
    // `skills[]`, so routing intent belongs here.
    triggerConditions: [{ field: 'objectName', operator: 'eq', value: 'sales_order' }],
  },

  permission: {
    name: 'sales_rep',
    label: 'Sales Rep',
    objects: {
      sales_order: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
      account: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
    },
    fields: {
      'sales_order.amount': { readable: true, editable: false },
    },
    systemPermissions: ['runReports', 'exportData'],
    tabPermissions: { crm: 'visible', admin: 'hidden' },
  },

  position: {
    name: 'sales_manager',
    label: 'Sales Manager',
    description: 'Manages the regional sales team.',
  },

  datasource: {
    name: 'warehouse',
    label: 'Analytics Warehouse',
    description: 'Read-only Postgres replica for reporting.',
    // `DatasourceSchema` is `.strict()`: `type` is the `driver` (already set
    // below) and `isDefault` is not a datasource key at all — routing is
    // declared at stack level via `datasourceMapping`. Both were rejected.
    driver: 'postgres',
    active: true,
    // `ssl` is a config OBJECT, not a boolean.
    ssl: { enabled: true, rejectUnauthorized: true },
    config: { host: 'db.internal', port: 5432, database: 'analytics' },
    pool: { min: 2, max: 10 },
    // No `capabilities` block: spec 17.0.0 removed it (objectstack#4583,
    // ADR-0049). All eleven flags were declared, strict-guarded and read by
    // nobody — pushdown is decided by the runtime driver's own `supports.*`,
    // never by datasource metadata, so `readOnly: true` here made nothing
    // read-only. `healthCheck` is likewise not a datasource key.
    // `os migrate meta --from 16` rewrites stored copies.
  },

  // `condition` is the FAILURE predicate, not the invariant: `ScriptValidationSchema`
  // documents it as "Predicate (CEL). If TRUE, validation fails." So the rule that
  // enforces "amount must be positive" reads `amount <= 0` — the illegal case, the
  // same direction as the spec's own examples (`record.amount < 0`,
  // `discount_percent > 0.40`). The pre-#3276 sample said `amount > 0`, which parses
  // fine and means the exact opposite of its name and message: it would have rejected
  // every valid order and passed every invalid one. Nothing catches this — a spec
  // guard can only ask whether a draft parses, never whether it means what it says —
  // so the direction has to be right here, in the example people copy.
  validation: {
    name: 'amount_positive',
    label: 'Amount Must Be Positive',
    active: true,
    severity: 'error',
    // A script rule carries ONLY `condition`. `expression` is not a key on any
    // validation branch; `object` isn't either (a rule lives in its host object's
    // `validations[]`, which IS its scope); and `field` exists on the
    // state_machine / format / json_schema branches, not this one. All three parsed
    // (the branch is not `.strict()`) and were then silently dropped. To point the
    // error at a specific field instead of the whole record, the spec's construct is
    // `type: 'cross_field'` with `fields: ['amount']` — same evaluation path, and
    // `fields[0]` labels which field the violation attaches to.
    type: 'script',
    condition: 'amount <= 0',
    message: 'Order amount must be greater than zero.',
    // The enum is the WRITE CONTEXT (`insert` / `update`), not a lifecycle-hook
    // name: the rule evaluator only runs on the insert/update write path, so
    // the pre-17 `beforeInsert`/`beforeUpdate` spellings are rejected.
    events: ['insert', 'update'],
    priority: 10,
  },

  email_template: {
    name: 'order_confirmation',
    label: 'Order Confirmation',
    subject: 'Your order ${order.name} is confirmed',
    // An email TEMPLATE is not a send: there is no `to` — the recipient is
    // supplied when the template is rendered and dispatched. The sender
    // override is `fromOverride`, and it is an OBJECT (`name` + `address`),
    // not a bare address string. Both `from` and `to` are rejected by name now
    // that the authorable record is `.strict()` (spec 17.0.0).
    fromOverride: { name: 'Sales Team', address: 'sales@example.com' },
    bodyHtml:
      '<html><body style="font-family:sans-serif;padding:24px"><h1 style="color:#4f46e5">Thanks for your order!</h1><p>Hi ${contact.name},</p><p>Your order <strong>${order.name}</strong> for <strong>${order.amount}</strong> is confirmed.</p><p>— The Sales Team</p></body></html>',
  },

  translation: {
    name: 'zh_CN',
    label: 'Simplified Chinese',
    locale: 'zh-CN',
    language: 'Chinese',
    description: 'Simplified Chinese bundle for the CRM app.',
    data: {
      objects: {
        sales_order: {
          label: '销售订单',
          // A field's entry is a node (`{ label }`), never a bare string.
          fields: { amount: { label: '金额' } },
          // `close_order` is bound to `sales_order` (the `action` sample's
          // `objectName`), so its copy lives under the object's `_actions`.
          // `globalActions` is only for actions bound to no object: a bound
          // action's copy filed there is never read for it, by the server or
          // the console, and `os validate` refuses it (objectui#11439).
          _actions: { close_order: { label: '关闭订单' } },
        },
        account: { label: '客户' },
      },
      apps: { crm: { label: 'CRM' } },
      messages: { welcome: '欢迎', saved: '已保存' },
    },
  },
};
