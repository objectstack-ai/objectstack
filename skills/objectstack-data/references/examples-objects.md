# Data — object authoring examples (moved verbatim from SKILL.md)

## Field Groups (MVP)

Organize fields into logical groups (e.g., "Contact Information", "Billing",
"System") for forms, detail pages, and editors.

- Declare groups on `ObjectSchema.fieldGroups` — **array order is the display order**.
- Assign each field to a group via `Field.group`, which references an
  `ObjectFieldGroup.key`. In-group display order equals the traversal order
  of `fields`.
- Group keys must be `snake_case`; group labels are human-readable.
- Optional per-group: `icon`, `description`, and `collapse`
  (`'none'` always open · `'expanded'` collapsible, starts open ·
  `'collapsed'` collapsible, starts closed — replaces the deprecated
  `defaultExpanded` flag, ADR-0085). Groups render identically on forms,
  modals, and detail pages; for a bespoke single-page layout assign a
  custom Page instead.

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

export default ObjectSchema.create({
  name: 'account',
  label: 'Account',
  sharingModel: 'private',

  fieldGroups: [
    { key: 'contact_info', label: 'Contact Information', icon: 'user' },
    { key: 'billing',      label: 'Billing', collapse: 'collapsed' },
    { key: 'system',       label: 'System' },
  ],

  fields: {
    name:       { type: 'text',  required: true, group: 'contact_info' },
    email:      { type: 'email',                  group: 'contact_info' },
    phone:      { type: 'phone',                  group: 'contact_info' },
    vat_id:     { type: 'text',                   group: 'billing' },
    billing_address: { type: 'address',           group: 'billing' },
    created_at: { type: 'datetime', readonly: true, group: 'system' },
    created_by: { type: 'lookup', reference: 'user', readonly: true, group: 'system' },
  },
});
```

**Supported migrations at this layer:** add / rename / delete / reorder groups
(edit the `fieldGroups` array), assign a field to a group (edit `Field.group`).
Explicit per-field in-group ordering is deferred to a future iteration.

## Quick-Start Template

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

export default ObjectSchema.create({
  name: 'support_case',
  label: 'Support Case',
  pluralLabel: 'Support Cases',
  description: 'A customer-reported issue tracked to resolution.',
  icon: 'life-buoy',
  sharingModel: 'private',                 // required in practice — see above
  highlightFields: ['subject', 'status', 'priority'],
  enable: {
    trackHistory: true,
    feeds: true,
    activities: true,
  },
  fields: {
    subject:     { type: 'text', required: true, maxLength: 255 },
    description: { type: 'richtext' },
    status:      { type: 'select', required: true, options: [
      { label: 'New',       value: 'new', default: true },
      { label: 'Open',      value: 'open' },
      { label: 'Escalated', value: 'escalated', color: '#e74c3c' },
      { label: 'Resolved',  value: 'resolved',  color: '#2ecc71' },
      { label: 'Closed',    value: 'closed' },
    ]},
    priority:    { type: 'select', options: [
      { label: 'Low',    value: 'low' },
      { label: 'Medium', value: 'medium', default: true },
      { label: 'High',   value: 'high',   color: '#e67e22' },
      { label: 'Urgent', value: 'urgent',  color: '#e74c3c' },
    ]},
    account:     { type: 'lookup', reference: 'account', required: true },
    contact:     { type: 'lookup', reference: 'contact' },
    assigned_to: { type: 'lookup', reference: 'user' },
    due_date:    { type: 'datetime' },
  },
  validations: [
    {
      name: 'status_flow',
      type: 'state_machine',
      field: 'status',
      transitions: {
        new:       ['open'],
        open:      ['escalated', 'resolved'],
        escalated: ['open', 'resolved'],
        resolved:  ['open', 'closed'],
        closed:    [],
      },
      message: 'Invalid status transition.',
    },
  ],
});
```

Declared `indexes` are a separate decision — see
[Index Strategy](../rules/indexing.md).

### Lifecycle Hooks

Implement business logic at data operation lifecycle points:

<!-- os:check -->
```typescript
import { defineHook, HookContext } from '@objectstack/spec/data';

export default defineHook({
  name: 'account_defaults',
  object: 'account',
  events: ['beforeInsert'],
  handler: async (ctx: HookContext) => {
    if (!ctx.input.industry) {
      ctx.input.industry = 'Other';
    }
    ctx.input.created_at = new Date().toISOString();
  },
});
```

The `handler` above is the inline (in-process) form. The **preferred**,
metadata-native form is a sandboxed `body` — `{ language: 'js', source, capabilities }`
run in an isolated VM, the shape that AI/Studio-authored hooks and every build
artifact carry. See [references/data-hooks.md](./data-hooks.md) for all 8
lifecycle events, both registration forms, the **sandboxed `body` ctx + capability
contract**, and the canonical patterns.

## Metadata Protection (`protection`)

Package authors can lock shipped metadata against Studio edits / overlays / deletes.

The `protection` block is **declared on the source schema** (`*.object.ts`,
`*.app.ts`, `*.view.ts`, …) and stripped at load time — it never appears in
the runtime envelope. The runtime instead populates `_lock`, `_lockReason`,
`_lockDocsUrl`, `_lockSource`, and `_packageId`, which REST returns to Studio
and the lock banner reads.

### Schema

```ts
protection?: {
  /** Lock level — controls what Studio can do to this item. */
  lock: 'none' | 'no-overlay' | 'no-delete' | 'full';
  /** REQUIRED — reason shown in the Studio lock banner (1–500 chars). */
  reason: string;
  /** Optional doc URL — renders as a "View docs" link in the banner. */
  docsUrl?: string;
}
```

The block is `.strict()`: `reason` is **required** (min 1 / max 500 chars) and
unknown keys are rejected.

| `lock` | Edit (overlay) | Delete | Typical use |
|:---|:---:|:---:|:---|
| `none` (default) | ✅ | ✅ | Normal authored metadata |
| `no-overlay` | ❌ | ✅ | Schema is platform-defined but tenant can drop it (e.g. `sys_role`) |
| `no-delete` | ✅ | ❌ | Tenant may customize fields but the object itself must exist |
| `full` | ❌ | ❌ | Core admin UI / platform identity (e.g. `sys_user`, `app/setup`) |

### Example

<!-- os:check -->
```typescript
// src/objects/sys-user.object.ts
import { ObjectSchema } from '@objectstack/spec/data';

export const SysUserObject = ObjectSchema.create({
  name: 'sys_user',
  label: 'User',
  sharingModel: 'public_read',
  protection: {
    lock: 'full',
    reason: 'Core identity object',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  fields: { username: { type: 'text', required: true } },
});
```

The same block works on non-object metadata (apps, views, dashboards, flows,
agents, tools, skills, reports, email-templates). Enforcement: `PUT`/`DELETE` on
`/api/v1/meta/:type/:name` return `403 item_locked`, and an artifact lock
overrides a package lock. Default to **no** `protection` block for
tenant-authored metadata.
