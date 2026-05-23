// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata-as-code scaffolding manifest.
 *
 * One entry per metadata type the Studio knows how to scaffold from
 * the "+ New" dialog. Each template describes the canonical on-disk
 * location (directory + file suffix), the icon and copy shown in the
 * type picker, and a `snippet()` function that emits a runnable
 * `defineX(...)` body pre-filled with the user-supplied name/label.
 *
 * The shape is intentionally simple so plugins (eventually) and the
 * CLI can share the same source-of-truth without dragging React into
 * non-UI consumers.
 *
 * Conventions:
 *   - `type`     — short metadata-type id (singular, matches the registry).
 *   - `dir`      — sub-directory under `packages/<pkg>/src/`.
 *   - `suffix`   — file suffix including the leading dot (`.view.ts`).
 *   - `snippet`  — receives `(name, label, object?)`. When `object` is
 *                  provided, templates that take an objectName bake it
 *                  in directly and skip the placeholder comment.
 */

import type { ElementType } from 'react';
import {
  Database, Table, FileText, LayoutDashboard, BarChart3,
  Workflow, Webhook, Stamp, Bot, Wrench, Sparkles, Lock, Shield,
  Globe, Layers,
} from 'lucide-react';

export interface TypeTemplate {
  type: string;
  label: string;
  icon: ElementType;
  description: string;
  /** Directory under `packages/<pkg>/src/`. */
  dir: string;
  /** Source-file suffix, e.g. ".view.ts". */
  suffix: string;
  /**
   * Generate the file body. `name` is snake_case, `label` is human.
   * `object` is an optional prefilled object machine name.
   */
  snippet: (name: string, label: string, object?: string) => string;
}

/** Render the optional `objectName` placeholder comment when no prefill is provided. */
const placeholderComment = (o?: string) => (o ? '' : ' // ⚠ replace with your object');

export const METADATA_TEMPLATES: TypeTemplate[] = [
  {
    type: 'object', label: 'Object', icon: Database,
    description: 'A table of records with fields, validations, and permissions.',
    dir: 'objects', suffix: '.object.ts',
    snippet: (n, l) => `import { defineObject } from '@objectstack/spec';

export default defineObject({
  name: '${n}',
  label: '${l}',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 255 },
  },
});
`,
  },
  {
    type: 'view', label: 'Grid view', icon: Table,
    description: 'A data table over an existing object.',
    dir: 'views', suffix: '.view.ts',
    snippet: (n, l, o) => `import { defineView } from '@objectstack/spec';

export default defineView({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${placeholderComment(o)}
  viewType: 'grid',
  columns: ['name'],
});
`,
  },
  {
    type: 'app', label: 'App', icon: Layers,
    description: 'Top-level navigation container with tabs.',
    dir: 'apps', suffix: '.app.ts',
    snippet: (n, l, o) => `import { defineApp } from '@objectstack/spec';

export default defineApp({
  name: '${n}',
  label: '${l}',
  tabs: [
    { type: 'object', objectName: '${o ?? 'account'}' },
  ],
});
`,
  },
  {
    type: 'page', label: 'Page', icon: FileText,
    description: 'A custom screen composed of SDUI blocks.',
    dir: 'pages', suffix: '.page.ts',
    snippet: (n, l) => `import { definePage } from '@objectstack/spec';

export default definePage({
  name: '${n}',
  label: '${l}',
  route: '/${n.replace(/_/g, '-')}',
  blocks: [
    { type: 'heading', level: 1, text: '${l}' },
  ],
});
`,
  },
  {
    type: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    description: 'A grid of widgets, charts, and KPIs.',
    dir: 'dashboards', suffix: '.dashboard.ts',
    snippet: (n, l) => `import { defineDashboard } from '@objectstack/spec';

export default defineDashboard({
  name: '${n}',
  label: '${l}',
  widgets: [],
});
`,
  },
  {
    type: 'report', label: 'Report', icon: BarChart3,
    description: 'A saved query with columns, filters, sorts, and grouping.',
    dir: 'reports', suffix: '.report.ts',
    snippet: (n, l, o) => `import { defineReport } from '@objectstack/spec';

export default defineReport({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${placeholderComment(o)}
  columns: ['name'],
});
`,
  },
  {
    type: 'flow', label: 'Flow', icon: Workflow,
    description: 'A multi-step automation triggered by events or schedules.',
    dir: 'flows', suffix: '.flow.ts',
    snippet: (n, l) => `import { defineFlow } from '@objectstack/spec';

export default defineFlow({
  name: '${n}',
  label: '${l}',
  trigger: { type: 'manual' },
  steps: [],
});
`,
  },
  {
    type: 'hook', label: 'Hook', icon: Webhook,
    description: 'A side-effect that fires on object lifecycle events.',
    dir: 'hooks', suffix: '.hook.ts',
    snippet: (n, l, o) => `import { defineHook } from '@objectstack/spec';

export default defineHook({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${placeholderComment(o)}
  on: 'after-create',
  run: async (ctx) => {
    // your side-effect here
  },
});
`,
  },
  {
    type: 'approval', label: 'Approval', icon: Stamp,
    description: 'A multi-step approval chain on an object.',
    dir: 'approvals', suffix: '.approval.ts',
    snippet: (n, l, o) => `import { defineApproval } from '@objectstack/spec';

export default defineApproval({
  name: '${n}',
  label: '${l}',
  objectName: '${o ?? 'account'}',${placeholderComment(o)}
  entryCriteria: { all: [] },
  steps: [],
});
`,
  },
  {
    type: 'agent', label: 'Agent', icon: Bot,
    description: 'An LLM-backed assistant with tools and instructions.',
    dir: 'agents', suffix: '.agent.ts',
    snippet: (n, l) => `import { defineAgent } from '@objectstack/spec';

export default defineAgent({
  name: '${n}',
  label: '${l}',
  model: 'openai/gpt-4',
  instructions: 'You are a helpful assistant.',
  tools: [],
});
`,
  },
  {
    type: 'tool', label: 'Tool', icon: Wrench,
    description: 'A typed function an Agent can invoke.',
    dir: 'tools', suffix: '.tool.ts',
    snippet: (n, l) => `import { defineTool } from '@objectstack/spec';
import { z } from 'zod';

export default defineTool({
  name: '${n}',
  label: '${l}',
  description: 'Describe what this tool does.',
  parameters: z.object({}),
  run: async (input, ctx) => {
    return { ok: true };
  },
});
`,
  },
  {
    type: 'skill', label: 'Skill', icon: Sparkles,
    description: 'A composable agent capability.',
    dir: 'skills', suffix: '.skill.ts',
    snippet: (n, l) => `import { defineSkill } from '@objectstack/spec';

export default defineSkill({
  name: '${n}',
  label: '${l}',
  description: '',
  tools: [],
});
`,
  },
  {
    type: 'permission', label: 'Permission', icon: Lock,
    description: 'A capability that can be granted to a role.',
    dir: 'security', suffix: '.permission.ts',
    snippet: (n, l) => `import { definePermission } from '@objectstack/spec';

export default definePermission({
  name: '${n}',
  label: '${l}',
});
`,
  },
  {
    type: 'role', label: 'Role', icon: Shield,
    description: 'A set of permissions assigned to users.',
    dir: 'security', suffix: '.role.ts',
    snippet: (n, l) => `import { defineRole } from '@objectstack/spec';

export default defineRole({
  name: '${n}',
  label: '${l}',
  permissions: [],
});
`,
  },
  {
    type: 'api', label: 'API endpoint', icon: Globe,
    description: 'A custom REST endpoint.',
    dir: 'apis', suffix: '.api.ts',
    snippet: (n, l) => `import { defineEndpoint } from '@objectstack/spec';

export default defineEndpoint({
  name: '${n}',
  label: '${l}',
  method: 'GET',
  path: '/${n.replace(/_/g, '-')}',
  handler: async (ctx) => ({ ok: true }),
});
`,
  },
];

/** Find a template by metadata-type id. */
export function getTemplate(type: string): TypeTemplate | undefined {
  return METADATA_TEMPLATES.find((t) => t.type === type);
}
