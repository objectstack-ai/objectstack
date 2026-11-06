# Data — object authoring examples (moved verbatim from SKILL.md)

## Field Groups (MVP)

- Declare groups on `ObjectSchema.fieldGroups` — **array order is the display order**.
- Assign each field to a group via `Field.group`, which references an
  `ObjectFieldGroup.key`. In-group display order equals the traversal order
  of `fields`.
- Group keys must be `snake_case`.
- Optional per-group: `icon`, `description`, and `collapse`
  (`'none'` always open · `'expanded'` collapsible, starts open ·
  `'collapsed'` collapsible, starts closed). Groups render identically on forms,
  modals, and detail pages.
- Hide a whole group, header included, with `visibleWhen` (CEL over
  `record.*`; FALSE or a fault hides it) or `requiresFeature` (a deployment
  feature flag from `PUBLIC_AUTH_FEATURES` in `@objectstack/spec/kernel`; an
  unknown flag is refused). At parse `requiresFeature` is lowered into the
  group's `visibleWhen` and stripped, AND-combined after an authored
  `visibleWhen`. Presentation only: the fields stay readable through the API.
  `sys_organization` hides Parent Organization and Sort Order on one
  organization:
  `{ key: 'group_structure', label: 'Group Structure', requiresFeature: 'multiOrgEnabled' }`.

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
    created_by: { type: 'user', readonly: true, group: 'system' },
  },
});
```

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
  sharingModel: 'private',                 // required in practice
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
    assigned_to: { type: 'user' },
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

<!-- os:check -->
```typescript
import { defineHook, HookContext } from '@objectstack/spec/data';

export default defineHook({
  name: 'crm_account_defaults',
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

Package authors can lock shipped metadata against edits / deletes.

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

| `lock` | Edit | Delete | Typical use |
|:---|:---:|:---:|:---|
| `none` (default) | ✅ | ✅ | Normal authored metadata |
| `no-overlay` | ❌ | ✅ | Platform-defined schema a deployment may drop (e.g. `sys_role`) |
| `no-delete` | ✅ | ❌ | The object may be extended but must exist |
| `full` | ❌ | ❌ | Core admin UI / platform identity (e.g. `sys_user`, `app/setup`) |

### Example

<!-- os:check -->
```typescript
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
