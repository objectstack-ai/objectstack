// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printKV,
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
      { name: 'ownership', type: "'user' | 'org' | 'none'", description: 'Record-ownership model: user (default, injects a reassignable owner_id) | org | none (no per-record owner). Distinct from the package own/extend contribution kind.' },
      { name: 'enable', type: 'ObjectCapabilities', description: 'Feature flags (trackHistory, apiEnabled, etc.)' },
      { name: 'icon', type: 'string', description: 'Icon identifier for UI display' },
    ],
    example: `{
  name: 'project_task',
  label: 'Project Task',
  fields: {
    title: { type: 'text', label: 'Title', required: true },
    status: { type: 'select', label: 'Status', options: ['open', 'closed'] },
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
      { name: 'options', type: 'string[]', description: 'Available choices (select fields)' },
    ],
    example: `{
  type: 'text',
  label: 'Email Address',
  required: true,
  maxLength: 255,
}`,
    related: ['object', 'view', 'query'],
    docsPath: 'data/field',
  },

  view: {
    name: 'View',
    description: 'Defines how data is displayed and interacted with. Views can be list views (grid, kanban, calendar) or form views (simple, tabbed, wizard).',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'object', type: 'string', description: 'Target object to display' },
      { name: 'type', type: '"list" | "form"', description: 'View category' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'layout', type: '"grid" | "kanban" | "calendar" | "gantt" | "simple" | "tabbed" | "wizard"', description: 'Layout style' },
      { name: 'columns', type: 'string[]', description: 'Visible fields for list views' },
      { name: 'filters', type: 'Filter[]', description: 'Default query filters' },
      { name: 'sort', type: 'SortConfig', description: 'Default sort configuration' },
    ],
    example: `{
  name: 'task_board',
  object: 'project_task',
  type: 'list',
  label: 'Task Board',
  layout: 'kanban',
  columns: ['title', 'status', 'assigned_to'],
}`,
    related: ['object', 'app', 'action', 'dashboard'],
    docsPath: 'ui/view',
  },

  flow: {
    name: 'Flow',
    description: 'Visual logic orchestration for business processes. Flows can be auto-launched, screen-based, or scheduled.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'type', type: '"autolaunched" | "screen" | "schedule"', description: 'Trigger type' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'description', type: 'string', description: 'Documentation for the flow' },
      { name: 'trigger', type: 'TriggerConfig', description: 'Event that starts the flow' },
      { name: 'steps', type: 'FlowStep[]', description: 'Sequence of actions' },
      { name: 'variables', type: 'Variable[]', description: 'Flow-scoped variables' },
    ],
    example: `{
  name: 'assign_on_create',
  type: 'autolaunched',
  label: 'Auto-Assign on Create',
  trigger: { object: 'project_task', event: 'afterInsert' },
  steps: [
    { type: 'assignment', field: 'assigned_to', value: '$currentUser' },
  ],
}`,
    related: ['object', 'trigger', 'agent'],
    docsPath: 'automation/flow',
  },

  agent: {
    name: 'Agent',
    description: 'Autonomous AI actor that can perform tasks using tools, instructions, and context from the ObjectStack data model.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'role', type: 'string', description: 'Agent purpose description' },
    ],
    optional: [
      { name: 'instructions', type: 'string', description: 'System prompt / behavioral instructions' },
      { name: 'tools', type: 'ToolReference[]', description: 'Tools the agent can invoke' },
      { name: 'model', type: 'string', description: 'LLM model to use' },
      { name: 'objects', type: 'string[]', description: 'Objects the agent can access' },
      { name: 'temperature', type: 'number', description: 'Creativity parameter (0-1)' },
    ],
    example: `{
  name: 'support_agent',
  role: 'Customer Support Assistant',
  instructions: 'Help users resolve issues by searching the knowledge base.',
  tools: [{ name: 'query', object: 'knowledge_article' }],
  model: 'gpt-4o',
}`,
    related: ['object', 'flow', 'query'],
    docsPath: 'ai/agent',
  },

  app: {
    name: 'App',
    description: 'Application shell that groups navigation, branding, and views into a cohesive user experience.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'description', type: 'string', description: 'App description' },
      { name: 'navigation', type: 'NavItem[]', description: 'Menu tree structure' },
      { name: 'logo', type: 'string', description: 'Logo URL or asset path' },
      { name: 'theme', type: 'string', description: 'Theme reference' },
      { name: 'defaultRoute', type: 'string', description: 'Landing page route' },
    ],
    example: `{
  name: 'project_manager',
  label: 'Project Manager',
  navigation: [
    { type: 'object', object: 'project_task', label: 'Tasks' },
    { type: 'dashboard', dashboard: 'project_overview', label: 'Overview' },
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
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'widgets', type: 'Widget[]', description: 'Dashboard widget definitions' },
      { name: 'layout', type: 'GridLayout', description: 'Widget positioning' },
      { name: 'refreshInterval', type: 'number', description: 'Auto-refresh interval in seconds' },
    ],
    example: `{
  name: 'project_overview',
  label: 'Project Overview',
  widgets: [
    { type: 'chart', object: 'project_task', groupBy: 'status' },
    { type: 'metric', object: 'project_task', aggregate: 'count' },
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
      { name: 'type', type: '"button" | "url" | "flow" | "api"', description: 'Action type' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display text' },
      { name: 'icon', type: 'string', description: 'Button icon' },
      { name: 'object', type: 'string', description: 'Target object context' },
      { name: 'flow', type: 'string', description: 'Flow to launch (for flow actions)' },
      { name: 'url', type: 'string', description: 'Target URL (for url actions)' },
      { name: 'confirmation', type: 'string', description: 'Confirmation dialog message' },
    ],
    example: `{
  name: 'close_task',
  type: 'flow',
  label: 'Close Task',
  object: 'project_task',
  flow: 'close_task_flow',
  confirmation: 'Are you sure you want to close this task?',
}`,
    related: ['flow', 'view', 'app'],
    docsPath: 'ui/action',
  },

  workflow: {
    name: 'Workflow',
    description: 'State machine and approval process that governs record lifecycle transitions.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'object', type: 'string', description: 'Target object' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'states', type: 'State[]', description: 'Defined workflow states' },
      { name: 'transitions', type: 'Transition[]', description: 'Allowed state transitions' },
      { name: 'approvers', type: 'ApproverConfig', description: 'Approval chain configuration' },
    ],
    example: `{
  name: 'task_approval',
  object: 'project_task',
  label: 'Task Approval',
  states: ['draft', 'pending', 'approved', 'rejected'],
  transitions: [
    { from: 'draft', to: 'pending', action: 'submit' },
    { from: 'pending', to: 'approved', action: 'approve' },
    { from: 'pending', to: 'rejected', action: 'reject' },
  ],
}`,
    related: ['object', 'flow', 'action'],
    docsPath: 'automation/workflow',
  },

  trigger: {
    name: 'Trigger',
    description: 'Event-driven automation hook that fires when specific data events occur on an object.',
    required: [
      { name: 'name', type: 'string (snake_case)', description: 'Machine name identifier' },
      { name: 'object', type: 'string', description: 'Target object to monitor' },
      { name: 'event', type: '"beforeInsert" | "afterInsert" | "beforeUpdate" | "afterUpdate" | "beforeDelete" | "afterDelete"', description: 'Event type' },
    ],
    optional: [
      { name: 'label', type: 'string', description: 'Display name' },
      { name: 'condition', type: 'FilterExpression', description: 'Conditional guard' },
      { name: 'flow', type: 'string', description: 'Flow to execute' },
      { name: 'async', type: 'boolean', description: 'Whether to execute asynchronously' },
    ],
    example: `{
  name: 'task_created_notify',
  object: 'project_task',
  event: 'afterInsert',
  label: 'Notify on Task Creation',
  flow: 'send_task_notification',
  async: true,
}`,
    related: ['object', 'flow', 'workflow'],
    docsPath: 'automation/trigger',
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
        console.log(JSON.stringify({
          schemas: Object.entries(SCHEMAS).map(([key, s]) => ({
            name: key,
            description: s.description,
          })),
        }, null, 2));
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
        console.log(JSON.stringify({ error: `Unknown schema: ${schemaName}` }));
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
      console.log(JSON.stringify(schema, null, 2));
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
