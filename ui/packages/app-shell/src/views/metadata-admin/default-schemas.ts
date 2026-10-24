// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * default-schemas — minimal JSONSchemas used by SchemaForm ONLY when the
 * framework's `/meta/types` registry row carries no `schema` field. The
 * framework derives that field from each type's Zod schema (and keeps a
 * hand-crafted fallback for a type whose schema does not derive), so against
 * a current server the served schema wins and the entry here is not read:
 * `ResourceEditPage` takes `entry.schema` first and `defaultSchema` second.
 * What an entry here still decides is the form shown against a server that
 * serves no schema for the type — so an entry must never offer a key the
 * spec has retired, because the save would send it and be refused.
 *
 * These schemas cover the universal metadata header (name/label/
 * description/scope) plus the small set of per-type "obvious" fields
 * users expect on day one. Anything that doesn't fit here can still be
 * edited via the raw JSON escape hatch — the schema is intentionally
 * lax (no `additionalProperties: false`) so unknown payload keys round-
 * trip untouched.
 */

import { registerMetadataResource } from './registry.js';

/** Shared header fields every metadata item has. */
const headerProps = {
  name: {
    type: 'string',
    title: 'Name',
    description: 'Machine name. snake_case, used as the URL path and DB key.',
    pattern: '^[a-z_][a-z0-9_]*$',
  },
  label: {
    type: 'string',
    title: 'Label',
    description: 'Human-readable display name.',
  },
  description: {
    type: 'string',
    title: 'Description',
    format: 'multiline',
  },
} as const;

/** Per-type fallback schemas. */
const SCHEMAS: Record<string, Record<string, unknown>> = {
  // Position is deliberately flat (ADR-0090 D3) — no level, no parent; the
  // hierarchy lives on the business-unit tree. `role`/`profile` schemas are
  // gone with the spec-13 vocabulary (positions replace roles; D2 removed
  // the profile concept).
  position: {
    type: 'object',
    title: 'Position',
    required: ['name'],
    properties: {
      ...headerProps,
    },
  },

  permission: {
    type: 'object',
    title: 'Permission',
    required: ['id', 'resource', 'actions', 'description'],
    properties: {
      id: {
        type: 'string',
        title: 'ID',
        description: 'Stable identifier (e.g. crm.account.read).',
      },
      resource: {
        type: 'string',
        title: 'Resource',
        description: 'What this permission applies to.',
        enum: [
          'data.object', 'data.record', 'data.field',
          'ui.view', 'ui.dashboard', 'ui.report',
          'system.config', 'system.plugin', 'system.api', 'system.service',
          'storage.file', 'storage.database',
          'network.http', 'network.websocket',
          'process.spawn', 'process.env',
        ],
      },
      actions: {
        type: 'array',
        title: 'Actions',
        description: 'Permitted operations on the resource.',
        items: {
          type: 'string',
          enum: [
            'create', 'read', 'update', 'delete',
            'execute', 'admin', 'manage', 'configure',
            'import', 'export', 'share',
          ],
        },
      },
      description: {
        type: 'string',
        title: 'Description',
        description: 'Why this permission exists (shown in admin UIs).',
      },
      scope: {
        type: 'string',
        title: 'Scope',
        enum: ['tenant', 'user', 'plugin', 'global', 'resource'],
        default: 'tenant',
      },
      required: {
        type: 'boolean',
        title: 'Required',
        description: 'Must be present for the holder to function.',
      },
      justification: {
        type: 'string',
        title: 'Justification',
      },
    },
  },

  translation: {
    type: 'object',
    title: 'Translation Bundle',
    required: ['name'],
    properties: {
      name: { ...headerProps.name, description: 'Bundle id (e.g. zh_CN, en_US, package-locale).' },
      label: headerProps.label,
      description: headerProps.description,
      locale: {
        type: 'string',
        title: 'Locale',
        description: 'BCP-47 tag, e.g. en, zh-Hans, ja-JP.',
      },
      strings: {
        type: 'object',
        title: 'Strings',
        description: 'Key → translated string map.',
      },
    },
  },

  tool: {
    type: 'object',
    title: 'AI Tool',
    required: ['name'],
    properties: {
      ...headerProps,
      kind: {
        type: 'string',
        title: 'Kind',
        enum: ['function', 'http', 'mcp'],
      },
      inputSchema: { type: 'object', title: 'Input Schema (JSON Schema)' },
      outputSchema: { type: 'object', title: 'Output Schema (JSON Schema)' },
    },
  },

  skill: {
    type: 'object',
    title: 'AI Skill',
    required: ['name'],
    properties: {
      ...headerProps,
      instructions: { type: 'string', title: 'Instructions', format: 'multiline' },
      tools: { type: 'array', title: 'Tools', items: { type: 'string' } },
      surface: {
        type: 'string',
        title: 'Surface',
        description: "Agent surface this skill binds to (ADR-0063).",
        enum: ['ask', 'build', 'both'],
      },
      // No `triggerPhrases`: retired in spec 17 (objectstack#3896) — the
      // phrases were never matched against anything, and the spec now refuses
      // the key with a migration note.
      triggerConditions: {
        type: 'array',
        title: 'Trigger Conditions',
        description: 'Programmatic activation conditions (context field / operator / value). The activation-critical field — previously only hand-editable (objectstack-ai/objectstack#1878 / objectstack-ai/objectstack#1895).',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', title: 'Field' },
            operator: {
              type: 'string',
              title: 'Operator',
              enum: ['eq', 'neq', 'in', 'not_in', 'contains'],
            },
            value: { type: 'string', title: 'Value' },
          },
        },
      },
    },
  },

  app: {
    type: 'object',
    title: 'Application',
    required: ['name'],
    properties: {
      ...headerProps,
      icon: { type: 'string', title: 'Icon' },
      navigation: { type: 'array', title: 'Navigation', items: { type: 'object' } },
    },
  },

  page: {
    type: 'object',
    title: 'Page',
    required: ['name'],
    properties: {
      ...headerProps,
      route: { type: 'string', title: 'Route', description: 'URL path under the app.' },
      layout: { type: 'string', title: 'Layout' },
    },
  },

  view: {
    type: 'object',
    title: 'View',
    required: ['name'],
    properties: {
      ...headerProps,
      type: {
        type: 'string',
        title: 'View Type',
        enum: ['grid', 'kanban', 'calendar', 'gantt', 'simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal'],
      },
    },
  },

  dashboard: {
    type: 'object',
    title: 'Dashboard',
    required: ['name'],
    properties: {
      ...headerProps,
      widgets: { type: 'array', title: 'Widgets', items: { type: 'object' } },
    },
  },

  report: {
    type: 'object',
    title: 'Report',
    required: ['name'],
    properties: {
      ...headerProps,
      object: { type: 'string', title: 'Object' },
      filters: { type: 'array', title: 'Filters', items: { type: 'object' } },
    },
  },

  book: {
    type: 'object',
    title: 'Documentation Book',
    required: ['name', 'groups'],
    properties: {
      ...headerProps,
      slug: {
        type: 'string',
        title: 'Slug',
        description: 'Portal URL segment; defaults to the name without its package prefix.',
      },
      icon: { type: 'string', title: 'Icon' },
      order: {
        type: 'number',
        title: 'Order',
        description: 'Orders books within the portal.',
      },
      audience: {
        title: 'Audience',
        description:
          "Access audience. 'org' (default) inherits the package grant; 'public' is anonymously readable; { permissionSet } gates by a permission set the reader must hold (ADR-0090).",
        // Union of the two scalar literals and the { permissionSet } object — kept lax
        // so the permission-set-gated object form round-trips untouched through the form.
        oneOf: [
          { type: 'string', enum: ['org', 'public'] },
          {
            type: 'object',
            title: 'Permission-set gated',
            properties: { permissionSet: { type: 'string', title: 'Permission set' } },
            required: ['permissionSet'],
          },
        ],
      },
      groups: {
        type: 'array',
        title: 'Groups (spine)',
        description: 'Ordered sections. Membership is derived from each group\'s include rule — edit the structure visually in the Preview tab.',
        items: {
          type: 'object',
          required: ['key', 'label'],
          properties: {
            key: { type: 'string', title: 'Key', pattern: '^[a-z][a-z0-9_]*$' },
            label: { type: 'string', title: 'Label' },
            order: { type: 'number', title: 'Order' },
            include: { title: 'Include rule', description: 'Glob over doc names (e.g. crm_guide_*) or { tag }.' },
            package: { type: 'string', title: 'Package scope' },
            pages: { type: 'array', title: 'Explicit pages (override)', items: {} },
          },
        },
      },
    },
  },

  email_template: {
    type: 'object',
    title: 'Email Template',
    required: ['name', 'label', 'subject', 'bodyHtml'],
    properties: {
      ...headerProps,
      // No `category` and no `isSystem`: both are retired from the spec's
      // `EmailTemplateDefinitionSchema` (objectstack-ai/objectstack#22876,
      // ADR-0049 enforce-or-remove). Nothing ever read either one, and a
      // fallback form that offered them would write a key the server refuses.
      locale: { type: 'string', title: 'Locale', default: 'en-US', description: 'BCP-47 tag (en-US, zh-CN, …)' },
      subject: { type: 'string', title: 'Subject', description: 'Supports {{var.path}} interpolation' },
      bodyHtml: { type: 'string', title: 'HTML Body', format: 'multiline' },
      bodyText: { type: 'string', title: 'Plain-Text Body', format: 'multiline' },
      variables: { type: 'array', title: 'Variables', items: { type: 'object' } },
      fromOverride: { type: 'object', title: 'From Override' },
      replyTo: { type: 'string', title: 'Reply-To' },
      active: { type: 'boolean', title: 'Active', default: true },
    },
  },
};

/**
 * Register fallback schemas for every writable type. Idempotent — uses
 * `registerMetadataResource` so any prior registration (e.g. a bespoke
 * EditPage from PermissionMatrixEditor) is merged via the engine.
 */
export function registerDefaultMetadataSchemas(): void {
  for (const [type, schema] of Object.entries(SCHEMAS)) {
    registerMetadataResource({
      type,
      defaultSchema: schema,
      fieldOrder: ['name', 'label', 'description'],
    });
  }

  // `doc` (ADR-0046) carries NO fallback schema: the server serves
  // `DocSchema`'s own on `/meta/types`, and a copy here could only drift from
  // it. What it does carry is the create form's hints, because its body is
  // written on the canvas (`previews/DocPreview`, objectui#10188): the form
  // asks for the header keys only, suggests `name` from the title, and seeds
  // the one other key the spec requires — an empty `content` is a valid doc.
  registerMetadataResource({
    type: 'doc',
    createFields: ['label', 'name', 'description'],
    createDerive: [{ from: 'label', to: 'name', transform: 'slugify' }],
    createDefaults: { content: '' },
  });

  // objectui#13337 — a position is created together with the permission sets
  // it distributes (ADR-0131 D4). With no list declared, the create form falls
  // back to the required fields plus the header keys, so the `permissionSets`
  // row appeared only after the first save, and binding a set took a save, an
  // edit and a second save. The row is the served form's `ref-multi:permission`
  // picker, whose catalog loads in create mode as well.
  registerMetadataResource({
    type: 'position',
    createFields: ['label', 'name', 'description', 'permissionSets'],
  });
}
