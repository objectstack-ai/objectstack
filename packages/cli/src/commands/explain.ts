// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printKV,
  emitJson,
} from '../utils/format.js';

// ─── Schema Catalog ─────────────────────────────────────────────────

interface SchemaInfo {
  name: string;
  description: string;
  required: Array<{ name: string; type: string; description: string }>;
  optional: Array<{ name: string; type: string; description: string }>;
  example: string;
  related: string[];
  docsPath: string;
}

export const SCHEMAS: Record<string, SchemaInfo> = {
  object: {
    name: 'Object',
    description: 'Defines a data entity in the ObjectStack data model. Objects contain fields, enable capabilities, and form the foundation of the metadata-driven platform.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'fields', type: 'Record<string, Field>', description: 'Map of field definitions' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Human-readable display name' },
      { name: 'pluralLabel', type: 'string', description: 'Plural display name' },
      { name: 'description', type: 'string', description: 'Documentation for the object' },
      { name: 'ownership', type: "'user' | 'business_unit' | 'org' | 'none'", description: 'Record-ownership model: user (default, injects a reassignable owner_id plus owning_business_unit_id) | business_unit (owned by an org unit, not a person: owning_business_unit_id only, no owner_id) | org | none (no per-record owner). Distinct from the package own/extend contribution kind.' },
      { name: 'enable', type: 'ObjectCapabilities', description: 'Feature flags (trackHistory, apiEnabled, etc.)' },
      { name: 'icon', type: 'string', description: 'Icon identifier for UI display' },
    ],
    example: `{
  name: 'project_task',
  label: 'Project Task',
  fields: {
    title: { type: 'text', label: 'Title', required: true },
    // Select options are OBJECTS, not bare strings: each is { label, value },
    // where value is the stored lowercase machine identifier.
    status: { type: 'select', label: 'Status', options: [
      { label: 'Open', value: 'open' },
      { label: 'Closed', value: 'closed' },
    ] },
    assigned_to: { type: 'lookup', label: 'Assigned To', reference: 'user' },
  },
  enable: { trackHistory: true, apiEnabled: true },
}`,
    related: ['field', 'view', 'flow', 'query'],
    docsPath: 'data/object',
  },

  field: {
    name: 'Field',
    description: 'Defines a property on an Object. Fields have types that control validation, storage, and UI rendering.',
    required: [
      { name: 'type', type: 'FieldType', description: 'Field data type (text, number, boolean, select, lookup, etc.)' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Human-readable display name' },
      { name: 'required', type: 'boolean', description: 'Whether the field is mandatory' },
      { name: 'multiple', type: 'boolean', description: 'Whether the field holds an array of values' },
      { name: 'defaultValue', type: 'any', description: 'Default value for new records' },
      { name: 'maxLength', type: 'number', description: 'Maximum character length (text fields)' },
      { name: 'reference', type: 'string', description: 'Target object name (lookup fields)' },
      { name: 'options', type: 'SelectOption[]', description: 'Available choices (select/multiselect fields). Each option is an OBJECT — { label, value } plus optional description / color / default / visibleWhen — never a bare string. `value` is the stored lowercase machine identifier; `label` is what the user sees.' },
    ],
    example: `{
  type: 'select',
  label: 'Priority',
  required: true,
  // The option shape the spec actually validates. A bare string list
  // (['high', 'low']) is rejected: expected object, received string.
  options: [
    { label: 'High', value: 'high', color: '#dc2626' },
    { label: 'Normal', value: 'normal', default: true },
    { label: 'Low', value: 'low' },
  ],
}`,
    related: ['object', 'view', 'query'],
    docsPath: 'data/field',
  },

  // `ViewSchema` is the per-object view CONTAINER, not a single view. A flat
  // list-view literal written at this level is rejected wholesale: `type`,
  // `columns`, `data`, `viewKind`, `filters` and `sort` all belong to a single
  // VIEW, one level down. The tables below document the container; a single
  // view's own keys are shown inside the example's slots.
  view: {
    name: 'View (container)',
    description: 'Per-object container holding that object\'s views. It is NOT a single view: the container\'s own keys are `list`, `form`, `listViews` and `formViews`, and a single view\'s keys (type, columns, filter, sort, …) go INSIDE one of those slots. List views render as grid / kanban / gallery / calendar / timeline / gantt / map / chart / tree / page; form views as simple / tabbed / wizard.',
    required: [
      { name: 'list | form | listViews | formViews', type: 'at least one slot', description: 'A container must register at least one view — defineView() refuses one that registers none, and a flat view literal parses to an empty container. `list` / `form` are the object\'s default views; `listViews` / `formViews` are Record<string, View> maps of additional NAMED views.' },
    ],
    optional: [
      { name: 'name', type: 'string', description: 'Item name — supplied by the metadata door; for an object-scoped container it is the object name' },
      { name: 'label', type: 'string (i18n)', description: 'Human-readable label shown in metadata lists' },
      { name: 'object', type: 'string', description: 'Object this container binds to — how a stack-level `views: [...]` entry says which object its views belong to' },
    ],
    example: `{
  // ── the CONTAINER's own keys ──
  name: 'project_task',
  object: 'project_task',
  label: 'Project Task Views',
  // ── a single VIEW lives inside a slot, never at the level above ──
  list: {
    type: 'grid',
    columns: ['title', 'status', 'assigned_to'],
  },
  listViews: {
    task_board: {
      label: 'Task Board',
      type: 'kanban',
      columns: ['title', 'status', 'assigned_to'],
      kanban: { groupByField: 'status', columns: ['title', 'assigned_to'] },
    },
  },
}`,
    related: ['object', 'app', 'action', 'dashboard'],
    docsPath: 'ui/view',
  },

  flow: {
    name: 'Flow',
    description: 'Visual logic orchestration for business processes. A flow is a GRAPH — `nodes` plus the `edges` that connect them — auto-launched, record-change, screen-based, scheduled, or API-invoked.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'type', type: '"autolaunched" | "record_change" | "schedule" | "screen" | "api"', description: 'Flow type' },
      { name: 'nodes', type: 'FlowNode[]', description: 'Graph nodes, each { id, type, label, config? }. Per-node data lives under `config` — there are no top-level `field`/`value` keys.' },
      { name: 'edges', type: 'FlowEdge[]', description: 'Graph connections, each { id, source, target, condition?, label? }. Bare CEL in `condition` — never {…} braces.' },
    ],
    optional: [
      { name: 'description', type: 'string', description: 'Documentation for the flow' },
      { name: 'status', type: '"draft" | "active" | "obsolete" | "invalid"', description: 'Deployment status (default "draft") — the engine arms flows from this' },
      { name: 'variables', type: 'Variable[]', description: 'Flow-scoped variables' },
      { name: 'runAs', type: '"system" | "user"', description: 'Execution identity (default "user" — runs as the triggering user, respecting RLS)' },
    ],
    example: `{
  name: 'assign_on_create',
  type: 'record_change',
  label: 'Auto-Assign on Create',
  status: 'active',
  nodes: [
    // A record-change flow binds its object on the START node's config,
    // not at the flow top level.
    { id: 'start', type: 'start', label: 'On Task Create',
      config: { objectName: 'project_task', triggerType: 'record-after-create' } },
    // Values interpolate with SINGLE braces. {$User.Id} is the acting user;
    // {record.<field>} reads the triggering record.
    { id: 'assign', type: 'update_record', label: 'Assign to Actor',
      config: {
        objectName: 'project_task',
        filter: { id: '{record.id}' },
        fields: { assigned_to: '{$User.Id}' },
      } },
    { id: 'done', type: 'end', label: 'Done' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'assign' },
    { id: 'e2', source: 'assign', target: 'done' },
  ],
}`,
    related: ['object', 'trigger', 'agent'],
    docsPath: 'automation/flow',
  },

  agent: {
    name: 'Agent',
    description: 'Autonomous AI actor that performs tasks using its attached skills, instructions, and context from the ObjectStack data model. An agent reaches exactly the tools its surface-compatible SKILLS declare (ADR-0064) — there is no agent-level tool list.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'label', type: 'string', description: 'Agent display name' },
      { name: 'role', type: 'string', description: 'The persona/role (e.g. "Senior Support Engineer")' },
      { name: 'instructions', type: 'string', description: 'System prompt / prime directives' },
    ],
    optional: [
      { name: 'skills', type: 'string[]', description: 'Skill names to attach (Agent -> Skill -> Tool architecture, ADR-0064). This is where tool access comes from: a platform tool by its registered name, or `action_<name>` for one of your own AI-exposed Actions — declared inside the skill, not here.' },
      { name: 'model', type: 'AIModelConfig', description: 'LLM configuration OBJECT — { provider, model, temperature, maxTokens, topP }. A bare model string is rejected, and model settings such as `temperature` live in HERE, never at the agent top level.' },
      { name: 'surface', type: '"ask" | "build"', description: 'Product surface this agent is for (default "ask")' },
      { name: 'avatar', type: 'string', description: 'Avatar image reference' },
      { name: 'access', type: 'string[]', description: 'Who can chat with this agent — enforced at the chat route' },
      { name: 'permissions', type: 'string[]', description: 'Required permission-set capabilities' },
      { name: 'active', type: 'boolean', description: 'Whether the agent is enabled (default true)' },
    ],
    example: `{
  name: 'support_agent',
  label: 'Support Assistant',
  role: 'Customer Support Assistant',
  instructions: 'Help users resolve issues by searching the knowledge base.',
  // ADR-0064: tools are reached THROUGH skills. \`agent.tools\` was removed in
  // @objectstack/spec 17 and there is no key its value moves to — declare each
  // tool inside a skill and attach the skill by name here.
  skills: ['knowledge_lookup'],
  // \`model\` is an object, and temperature belongs inside it.
  model: { provider: 'openai', model: 'gpt-4o', temperature: 0.2 },
}`,
    related: ['object', 'flow', 'query'],
    docsPath: 'ai/agent',
  },

  app: {
    name: 'App',
    description: 'Application shell that groups navigation, branding, and views into a cohesive user experience.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'label', type: 'string', description: 'Display name' },
    ],
    optional: [
      { name: 'description', type: 'string', description: 'App description' },
      { name: 'navigation', type: 'NavItem[]', description: 'Menu tree. Every item needs `id` (snake_case) + `label` + a discriminant `type`, plus that type\'s own target key: object -> `objectName`, dashboard -> `dashboardName`, page -> `pageName`, url -> `url`, report -> `reportName`.' },
      // `theme` here described a key that is only an alias of `branding`; the
      // `themes` metadata surface itself was retired at #10485 (ADR-0049) —
      // `app.branding` is the one colour surface. `logo` and `defaultRoute`
      // were the same class of row: neither is an AppSchema key, and both are
      // now rejected by name (`logo` -> `branding`).
      { name: 'branding', type: 'AppBranding', description: 'Brand colors and logo (primaryColor, accentColor, logo) — the one colour/logo surface' },
    ],
    example: `{
  name: 'project_manager',
  label: 'Project Manager',
  navigation: [
    // A nav item is discriminated on \`type\`, and each arm names its target
    // with its OWN key — never a bare \`object\` / \`dashboard\`.
    { id: 'nav_tasks', type: 'object', objectName: 'project_task', label: 'Tasks' },
    { id: 'nav_overview', type: 'dashboard', dashboardName: 'project_overview', label: 'Overview' },
  ],
}`,
    related: ['view', 'dashboard', 'action', 'object'],
    docsPath: 'ui/app',
  },

  query: {
    name: 'Query',
    description: 'Declarative data retrieval definition used for fetching and filtering records from objects.',
    required: [
      { name: 'object', type: 'string', description: 'Target object to query' },
    ],
    optional: [
      { name: 'fields', type: 'string[]', description: 'Fields to select' },
      { name: 'filters', type: 'Filter[]', description: 'Where conditions' },
      { name: 'sort', type: 'SortConfig[]', description: 'Order by configuration' },
      { name: 'limit', type: 'number', description: 'Maximum records to return' },
      { name: 'offset', type: 'number', description: 'Pagination offset' },
    ],
    example: `{
  object: 'project_task',
  fields: ['title', 'status', 'assigned_to'],
  filters: [{ field: 'status', operator: 'eq', value: 'open' }],
  sort: [{ field: 'created_at', order: 'desc' }],
  limit: 50,
}`,
    related: ['object', 'field', 'view'],
    docsPath: 'data/query',
  },

  dashboard: {
    name: 'Dashboard',
    description: 'Grid-layout container for widgets that display aggregated data, charts, and key metrics.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'widgets', type: 'Widget[]', description: 'Widgets to display. Each needs `id`, a `dataset` to bind (ADR-0021) and at least one measure in `values`; `dimensions` selects the X/group axis and `type` names the concrete mark.' },
    ],
    optional: [
      { name: 'description', type: 'string', description: 'Dashboard description' },
      { name: 'columns', type: 'number (1-24)', description: 'Number of grid columns (default 12)' },
      { name: 'gap', type: 'number', description: 'Space between widgets, in steps of 0.25rem (4 = 1rem)' },
      // There is no dashboard-level `layout` template — the key is rejected by
      // name. Positioning is per-widget: `layout: { x, y, w, h }`, and a widget
      // with none is auto-flowed into the grid.
      { name: 'refreshIntervalSeconds', type: 'number', description: 'Auto-refresh interval in seconds' },
      { name: 'globalFilters', type: 'GlobalFilter[]', description: 'Filters broadcast into every widget\'s analytics query' },
    ],
    example: `{
  name: 'project_overview',
  label: 'Project Overview',
  columns: 12,
  widgets: [
    // ADR-0021: a widget BINDS A DATASET and selects measures/dimensions by
    // name. The pre-ADR-0021 inline analytics shape (object + groupBy +
    // aggregate) was removed, and \`type\` names the concrete mark — there is
    // no \`'chart'\` widget type.
    {
      id: 'tasks_by_status',
      type: 'column',
      title: 'Tasks by Status',
      dataset: 'project_task_metrics',
      dimensions: ['status'],
      values: ['task_count'],
      layout: { x: 0, y: 0, w: 6, h: 4 },
    },
    {
      id: 'open_tasks',
      type: 'metric',
      title: 'Open Tasks',
      dataset: 'project_task_metrics',
      values: ['task_count'],
      layout: { x: 6, y: 0, w: 3, h: 2 },
    },
  ],
}`,
    related: ['app', 'view', 'object'],
    docsPath: 'ui/dashboard',
  },

  action: {
    name: 'Action',
    description: 'User-triggered operation such as a button click, URL redirect, or screen flow launch.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'label', type: 'string (i18n)', description: 'Display label' },
      { name: 'type', type: '"script" | "url" | "modal" | "flow" | "api" | "form"', description: 'Action type. There is no "button" type — a button is a LOCATION, not a kind.' },
      { name: 'target', type: 'string', description: 'Required for every type except `script`: the URL, flow id, modal name or API endpoint this action points at. This — not a per-type `flow` / `url` key — is how a flow action names its flow.' },
    ],
    optional: [
      { name: 'icon', type: 'string', description: 'Icon name' },
      { name: 'objectName', type: 'string (snake_case)', description: 'Target object this action belongs to; when set, defineStack() merges it into that object\'s actions' },
      { name: 'confirmText', type: 'string (i18n)', description: 'Confirmation message before execution. Correct on a param-LESS action; pairing it with a non-empty `params` is refused — put the question on `description` instead.' },
      { name: 'locations', type: 'ActionLocation[]', description: 'Where the action is offered (record header, list toolbar, row, …)' },
      { name: 'params', type: 'ActionParam[]', description: 'User-input collection for the action dialog' },
      { name: 'variant', type: '"primary" | "secondary" | "danger" | "ghost" | "link"', description: 'Button visual variant' },
      { name: 'visible', type: 'Expression', description: 'Visibility predicate (CEL); the action is offered when it evaluates TRUE' },
      { name: 'requiredPermissions', type: 'string[]', description: 'Capabilities required to invoke this action — enforced with 403 on the platform action route' },
    ],
    example: `{
  name: 'close_task',
  type: 'flow',
  label: 'Close Task',
  // \`objectName\`, not \`object\`; \`target\` carries the flow id (there is no
  // \`flow\` key); \`confirmText\`, not \`confirmation\`.
  objectName: 'project_task',
  target: 'close_task_flow',
  confirmText: 'Are you sure you want to close this task?',
}`,
    related: ['flow', 'view', 'app'],
    docsPath: 'ui/action',
  },

  // Kept as a redirect topic (mirroring content/docs/automation/workflows.mdx):
  // there is NO standalone Workflow authoring type. The shape this entry used
  // to teach (states[]/transitions[]/approvers) never existed in the spec —
  // ADR-0019 folded approval processes into Flow, and the workflow service
  // slot itself retired in #4451 (v17).
  workflow: {
    name: 'Workflow (no standalone type)',
    description: 'ObjectStack has no standalone Workflow authoring type. Use Flow for event-triggered or scheduled automation, an object validation rule of type "state_machine" for strict lifecycle transitions, and Approval nodes inside a flow for human approval pauses (ADR-0019).',
    required: [],
    optional: [],
    example: `// No workflow metadata exists. Compose the live mechanisms instead:
// - Flow (type: 'record_change' | 'schedule' | 'screen') for automation
// - object validation rule { type: 'state_machine', ... } for transitions
// - a flow node of type 'approval' for human approval steps
// See: os explain flow`,
    related: ['object', 'flow', 'action'],
    docsPath: 'automation/workflows',
  },

  // Kept as a redirect topic, the same shape as `workflow` above: there is NO
  // standalone Trigger authoring type. ADR-0088 §1 retired the `trigger`
  // metadata kind — it had no stack collection, no `defineTrigger`, no FS
  // loader, no executor, and "its enum comment referenced a `TriggerSchema`
  // that never existed". Two delivered mechanisms cover "data change ->
  // reaction" with a clean seam, and the ADR states the prescription outright:
  // *Authors: use `hook` for sync data-layer logic, a `record_change` flow for
  // async automation.*
  trigger: {
    name: 'Trigger (no standalone type)',
    description: 'ObjectStack has no standalone Trigger authoring type — ADR-0088 retired the kind, and the `TriggerSchema` its registry comment once referenced never existed. Use a `hook` for synchronous, in-transaction data-layer logic (24 lifecycle events), and a Flow of `type: \'record_change\'` for asynchronous, observable/pausable automation.',
    required: [],
    optional: [],
    example: `// No trigger metadata exists (ADR-0088). Use the delivered mechanisms:
//
// - hook — sync, data-layer, in-transaction (HookSchema):
//     { name: 'notify_on_task_create',
//       object: 'project_task',
//       events: ['afterInsert'],      // \`events\` is an ARRAY; \`event\` is an alias, not a key
//       body: { ... } }               // a hook's code slot is \`body\` — there is no \`flow\` key
//
// - Flow (type: 'record_change') — async, business-layer, observable/pausable.
//     It binds its object on the START node's config, not at the top level.
//
// The \`triggers\` capability token in a package's \`requires:\` is a DIFFERENT
// namespace and is unaffected by the retirement.
// See: os explain flow`,
    related: ['object', 'flow', 'workflow'],
    docsPath: 'automation/hooks',
  },
};

// ─── Command ────────────────────────────────────────────────────────

export default class Explain extends Command {
  static override description = 'Display human-readable explanation of an ObjectStack schema';

  static override args = {
    schema: Args.string({ description: 'Schema name (e.g., object, field, view, flow, agent, app)', required: false }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Explain);
    const schemaName = args.schema;

    // ── No argument: list all schemas ──
    if (!schemaName) {
      if (flags.json) {
        await emitJson({
          schemas: Object.entries(SCHEMAS).map(([key, s]) => ({
            name: key,
            description: s.description,
          })),
        });
        return;
      }

      printHeader('Available Schemas');
      console.log('');
      for (const [key, schema] of Object.entries(SCHEMAS)) {
        const desc = schema.description;
        console.log(`  ${chalk.bold.cyan(key.padEnd(12))} ${chalk.dim(desc.length > 70 ? desc.slice(0, 70) + '...' : desc)}`);
      }
      console.log('');
      printInfo(`Run ${chalk.white('objectstack explain <schema>')} for details.`);
      console.log('');
      return;
    }

    // ── Lookup schema ──
    const schema = SCHEMAS[schemaName.toLowerCase()];
    if (!schema) {
      if (flags.json) {
        await emitJson({ error: `Unknown schema: ${schemaName}` }, 0, { compact: true });
        process.exit(1);
      }
      printError(`Unknown schema: "${schemaName}"`);
      console.log('');
      printInfo(`Available schemas: ${Object.keys(SCHEMAS).join(', ')}`);
      console.log('');
      process.exit(1);
    }

    // ── JSON output ──
    if (flags.json) {
      await emitJson(schema);
      return;
    }

    // ── Pretty output ──
    printHeader(`Schema: ${schema.name}`);
    console.log('');
    console.log(`  ${schema.description}`);

    // Required properties
    console.log('');
    console.log(chalk.bold('  Required Properties:'));
    for (const prop of schema.required) {
      console.log(`    ${chalk.green(prop.name.padEnd(18))} ${chalk.dim(prop.type.padEnd(30))} ${prop.description}`);
    }

    // Optional properties
    if (schema.optional.length > 0) {
      console.log('');
      console.log(chalk.bold('  Optional Properties:'));
      for (const prop of schema.optional) {
        console.log(`    ${chalk.yellow(prop.name.padEnd(18))} ${chalk.dim(prop.type.padEnd(30))} ${prop.description}`);
      }
    }

    // Example
    console.log('');
    console.log(chalk.bold('  Example:'));
    for (const line of schema.example.split('\n')) {
      console.log(chalk.dim(`    ${line}`));
    }

    // Related schemas
    console.log('');
    printKV('  Related', schema.related.map((r) => chalk.cyan(r)).join(', '));

    // Documentation link
    printKV('  Docs', `https://objectstack.dev/docs/${schema.docsPath}`);
    console.log('');
  }
}
