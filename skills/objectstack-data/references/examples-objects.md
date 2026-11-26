# Data — object keys, examples, search, extensions

## Object keys

Beyond `SKILL.md` § Object Definition. Every key, `enable` flag
(`ObjectCapabilities`) and default: `data/object.zod.ts`
([_index.md](./_index.md)). The ones to get right:

| Property | Default | Description |
|:--|:--|:--|
| `color` | `gray` | Tile colour behind the white `icon`: `gray` `blue` `teal` `green` `amber` `orange` `red` `pink` `purple` (no hex). Group the app's objects into a few business families, one name each, as the platform's own objects do: people `blue`, security `purple`, approvals and work `orange`, messaging `pink`, integrations `teal`, reference data and finance `green`, audit and settings `amber`. `red` only for an alert object; one nobody opens gets none |
| `highlightFields` | derived | Ordered field keys used as a record's compact face: the columns a **related list** renders on the parent's detail page, and what a lookup picker shows. Declare it on the CHILD object (see [Relationships](../rules/relationships.md)) |
| `nameField` | derived (e.g. `'name'`/`'title'`) | Record-title field: the stored field used as the record's display name. Use a single text/email field; a composite title to import, sort or search by is a stored computed field (a non-`formula` field with an `expression`); a text formula is display-only |
| `ownership` | `'user'` | Whether `owner_id` exists at all, a different axis from `sharingModel` |

### Object Capabilities (`enable`)

| Flag | Default | Purpose |
|:--|:--|:--|
| `fieldHistory` | on | A changed field's old → new values on the activity timeline, served per the reader's field read rule. `false`: off for the object. A field opts out with its own `fieldHistory: false`; a media or structured field (`json`, `address`, `code`…) shows values only with `true`, a credential never. `sys_audit_log` keeps its own grant |
| `trackHistory` | `false` | Ledger view on the record page and the `history` API verb; not the values switch |
| `apiMethods` | all | Whitelist over the six primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`); derived verbs (search/export/upsert/…) follow automatically |
| `feeds` | `true` | Feed, comments, mentions; `false` hides the feed UI and rejects new comments |
| `activities` | `true` | Activity timeline (`sys_activity` mirror of CRUD); `false` stops mirroring and hides the timeline |
| `aiReadable` | — | Platform `sys_*` objects only; on an app object, `false` included, refused at parse |

## Field Groups (MVP)

- Declare groups on `ObjectSchema.fieldGroups` — **array order is the display order**.
- A group lists its members, in display order, in its own `fields`. Absent,
  its members are the fields whose `group` names its `key` (older, still read).
  A field listed by two groups, or listed while its `group` names another, is refused.
- Group keys must be `snake_case`.
- Optional per-group: `icon`, `description`, and `collapse`
  (`'none'` always open · `'expanded'` foldable, starts open ·
  `'collapsed'` starts closed). Forms keep it; the default record page
  lets readers fold any titled group.
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
    { key: 'contact_info', label: 'Contact Information', icon: 'user', fields: ['name', 'email', 'phone'] },
    { key: 'billing', label: 'Billing', collapse: 'collapsed', fields: ['vat_id', 'billing_address'] },
    { key: 'system', label: 'System', fields: ['created_at', 'created_by'] },
  ],

  fields: {
    name:       { type: 'text', required: true },
    email:      { type: 'email' },
    phone:      { type: 'phone' },
    vat_id:     { type: 'text' },
    billing_address: { type: 'address' },
    created_at: { type: 'datetime', readonly: true },
    created_by: { type: 'user', readonly: true },
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
  color: 'orange',
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
    // assignee: the injected owner_id
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
import { defineHook } from '@objectstack/spec/data';

export default defineHook({
  name: 'crm_account_defaults',
  object: 'account',
  events: ['beforeInsert'],
  body: {
    language: 'js',
    source: `if (!ctx.input.industry) ctx.input.industry = 'Other';`,
  },
});
```

`body` is the metadata-native form: `source` is a function body run against
`ctx` in an isolated VM (`capabilities` gates `ctx.api`, `ctx.log`, …), the
shape AI/Studio-authored hooks and every build artifact carry. The inline
`handler` function is deprecated. See [references/data-hooks.md](./data-hooks.md) for all 8
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

A type excerpt, so `check:skill-examples` skips it:

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

## Search Fields (`searchableFields`)

`searchableFields` on the object is the canonical set `$search` scans.
Leave it unset and search auto-defaults to the `nameField` plus the object's
short-text and enum columns (`text` / `email` / `phone` / `url` / `autonumber` /
`textarea` / `markdown` / `select`) plus every field marked `searchable: true`,
of any type except `secret` / `password` / `vector` or a virtual `formula`. `searchable: false`, the
default, never removes a field the type default scans; declare
`searchableFields` to choose the set. Views may narrow it, never widen it.

### ⛔ Searching by a related record's title — mirror the value, always

`$search` scans **the queried object's own columns**. A dotted path is never a
search target: unlike `fields` / `sort` / `filters`, the search axis does not
resolve traversal, and `project_id.name` in `searchableFields` (or in a
`$searchFields` override) is **refused** (`os validate`
`searchable-field-unknown`; a request, `400 INVALID_FIELD`).

**The one prescription** (`SKILL.md` trap 2), for a task list searched by project name:

```typescript
{
  name: 'task',
  enable: { searchable: true },
  fields: {
    name:         { type: 'text', required: true },
    project_id:   { type: 'lookup', reference: 'project' },
    project_name: { type: 'text', label: 'Project Name' },
  },
  searchableFields: ['name', 'project_name'],
}
```

`?search=apollo` expands to `name $contains 'apollo' OR project_name $contains
'apollo'` — one single-table scan, every driver.

❌ **Never mirror onto a `formula` field.** It is *virtual* (no column to scan)
and CEL reads only this record's own fields, so it cannot hold the related title;
a `formula` entry in any `searchableFields` is refused — `os validate`
`searchable-field-unsearchable`, a request `400 INVALID_FIELD`.

**Mirror maintenance is the trade-off.** Cover both paths: a `beforeInsert` / `beforeUpdate` hook on `task`
stamps `project_name` from the incoming `project_id`'s parent; an `afterUpdate`
hook on `project` re-stamps its tasks when it is renamed. Rows written past the hooks (bulk import, direct SQL) need a
one-off backfill. See [Lifecycle Hooks](./data-hooks.md).

## Object Extension Model

To add fields/validations/indexes to an object you do not own, author
`defineObjectExtension({ extend, fields, fieldPatches, place, priority })` and register it on
`defineStack({ objectExtensions: [...] })`. `priority` sets merge order (default
`200`, `0–999`); an extension adds, never removes, except that a new
`label` without `pluralLabel` clears the base plural unless a tenant authored it (set both). ⛔ `extend`
is not object-level `ownership` (`'user' | 'business_unit' | 'org' | 'none'`).

`place: [{ field: 'tax_id', group: 'basic', after: 'industry' }, { list: 'acme_contract', after: 'crm_opportunity' }]`
puts the extension's own fields, groups (`{ group: { key, label }, after }`) and child lists
after (or `before`) a named item, where the target declares `fieldGroups` / `relatedLists`.

**A `fieldPatches` patch** (`SKILL.md` trap 3) carries display keys only:
`label`, `description`, `inlineHelpText`,
`placeholder`, and an option's `label` keyed by its stored `value`; the type,
values and rules stay the owner's. A key the tenant edited keeps the tenant's
text; between two extensions the higher `priority` wins. A patch naming a field
or option value the target lacks is refused at install and by `os validate`, and
a `picklist`-bound field's options are never patchable. Example:
`defineObjectExtension({ extend: 'crm_account', fieldPatches: { industry: { label: 'Sector' }, type: { options: { customer: { label: 'Client' } } } } })`.
Translate patched text in the patching package's `translations`, under the
owner's keys (`objects.crm_account.fields.industry.label`, `.help`,
`.options.<value>`): the owner's translation of the replaced text never applies, a
pair `.custom` translation comes first on `/meta`, and an untranslated locale
serves the patch text.

**An object an installed package ships** is extended from the
base's paired `.custom` package (`hotcrm.custom`; **objectstack-platform**
§ Customizing an installed package), never replaced: it takes no `overrides`
declaration. Every field the pair adds ends in `__c` (`region__c`). The suffix is
reserved to the pair, so a `__c` field in any other package, or an unsuffixed
field in a `.custom` extension, is refused at save, publish and install and by
`os validate` / `os build`.
Only the pair's extension may also write `fieldGroups` and `relatedLists`, shaped
as on an object. A written key replaces that arrangement whole (the owner's and
every `place`): an unlisted field shows after the last group, an unnamed tab
still shows after the listed ones, and `{ list: 'crm_note', hidden: true }` hides
a tab. Outside a `.custom` package both keys are refused at those doors: use `place`.
Studio's **Add field** on a base object writes the same extension, as an
`object_extension` item of the pair.
