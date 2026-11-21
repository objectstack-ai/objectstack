---
name: objectstack-data
description: >
  Design or change an ObjectStack data model, in a project or through MCP:
  objects, fields, relationships, validation rules, indexes, record hooks,
  permissions, seed / demo data, external datasources, and field `visibleWhen` /
  `requiredWhen` rules. Use when modelling records or editing `*.object.ts` /
  `src/data/*.ts`. Not for querying records (objectstack-query), flows or
  approvals (objectstack-automation), or plugin hooks (objectstack-platform).
license: Apache-2.0
compatibility: Requires @objectstack/spec 18.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: data
  tags: object, field, validation, index, relationship, hook, schema, permission, rls, security, seed, fixture
---

# Data Modeling — ObjectStack Data Protocol

## First checks

1. **Version.** This skill targets the `@objectstack/spec` major in its
   `compatibility` line. Read the installed one
   (`node_modules/@objectstack/spec/package.json`); where they differ, the
   installed contract is right.
2. **Read what exists.** Read the object being changed, those it references,
   and the hooks, seeds and permission sets naming it. Extend what is there:
   no second status field, owner field or look-alike object.
3. **Read the type's contract.** [references/_index.md](./references/_index.md)
   points at each type's Zod source in `node_modules/@objectstack/spec/src/`.
   `Read` it for exact keys, defaults and enum members, never from memory. A running environment serves the parsed shape as JSON Schema
   (`GET /api/v1/meta/types`, `entries[].schema`): a defaulted key reads as
   required and a bare-string predicate as `{}`.
4. **Verify before reporting done.** `os validate` (`npm run validate` in a
   scaffolded project), then `os lint`
   ([its rules](./references/lint-rules.md)). Most traps below pass both.

## Traps — each parses, then fails at run time

1. **A changed field does not reach a database that already has rows.** The
   sync only adds: a column is never altered or dropped, and the column wins
   at write time. Rename with `renamedFrom: ['old_key']`; `required` is the
   write contract, never `NOT NULL`
   ([Field Types](./rules/field-types.md#changing-a-field-that-has-data)).
2. **Search reads only this object's own stored columns.** To search by a
   related record's title, mirror it into a stored text field in
   `searchableFields`, kept fresh by hooks on both objects; a dotted path or a
   `formula` there is refused
   ([Search Fields](./references/examples-objects.md#search-fields-searchablefields)).
3. **An object you do not own is extended, never redeclared**:
   `defineObjectExtension`, relabelling the owner's fields through
   `fieldPatches` (redeclared in `fields`, a field is taken over and cut off
   from the owner's upgrades). An installed package's object is extended from
   its paired `.custom` package, each added field ending in `__c`
   ([Object Extension Model](./references/examples-objects.md#object-extension-model)).

## Where to go

Open the file for what you are writing before you write it.

| Authoring | Open first |
|:--|:--|
| An object's other keys, a starter object, field groups, `protection`, an extension | [examples-objects.md](./references/examples-objects.md) |
| A field's type and config, a default, changing a field that has data | [Field Types](./rules/field-types.md) |
| Names; labels in the request's language | [Naming](./rules/naming.md) |
| `lookup` or `master_detail`, junctions, delete behaviour, roll-ups, line items | [Relationships](./rules/relationships.md) |
| Validation rules, state machines, uniqueness, conditional field rules | [Validation](./rules/validation.md) |
| `indexes`, unique scope | [Indexing](./rules/indexing.md) |
| Record hooks: the sandboxed `body`, `ctx.api`, refusals, transactions | [data-hooks.md](./references/data-hooks.md) |
| Permission sets, RLS, field permissions, `secret`, tenancy, ownership queues | [Security](./rules/security.md) |
| Retention, append-only and audit objects, the save notice | [Lifecycle](./rules/lifecycle.md) |
| Seed and demo data | [seeds.md](./references/seeds.md) |
| External databases, federated objects | [Datasources](./rules/datasources.md) |

## Conditional Field Rules

`visibleWhen`, `requiredWhen` and `readonlyWhen` go on the **field**, as CEL
over `record.*` (`P\`record.status == 'paid'\``), so every form and
API write honours them.

- **`readonlyWhen` and `readonly: true` drop the value; they do not refuse the
  write.** `readonly: true` binds non-system writes only; a `runAs:'system'`
  flow, system hook or seed does write it
  ([objectstack-automation → Failure routing & `runAs`](../objectstack-automation/SKILL.md#failure-routing--runas)).
- **`requiredWhen` is a transition gate, not an invariant**: it judges the
  write, not the stored row. A fact true of every stored record is a
  `validations[]` `script` rule.

Example and syntax: [Validation](./rules/validation.md#conditional-field-rules).

## Core Concepts

### Object Definition

An **Object** maps to a database table and exposes automatic CRUD APIs. As JSON
(in TypeScript the same literal goes inside `ObjectSchema.create({...})`):

```json
{ "name": "crm_account", "label": "Account", "pluralLabel": "Accounts", "icon": "building",
  "sharingModel": "public_read_write",
  "fields": { "name": { "type": "text", "label": "Name", "required": true } } }
```

- `name` and field keys are immutable `snake_case`; a module prefix goes in
  `name` (`namespace` is not a key).
- **Author `sharingModel` on every object**: Zod marks it optional, but a
  publish without it is refused (`security-owd-unset`). Choose it from the
  request, not by habit. `public_read_write`: a business object a team shares
  (`private` would hide every colleague's records). `private`: personal or
  sensitive data only its owner should see (HR reviews, pay), widened by
  sharing rules, RLS or `readScope` / `writeScope`. `public_read`: reference
  data everyone reads and the owner maintains (price lists, policies).
  `controlled_by_parent`: a `master_detail` child, inherited from its master.
- Author `pluralLabel` and `icon` beside `label`. The record title is
  `nameField`: one stored text or email field, never a text formula.

Every other key: [examples-objects.md](./references/examples-objects.md#object-keys).

### Field Type Selection

Credentials are `secret` (encrypted at rest), never `password`, which on a
generic object is plaintext at rest. A person is `type: 'user'` with no
`reference`, optional unless the request says otherwise. `formula` takes CEL
in `expression`, a `{ dialect: 'cel', source }` envelope (`F\`...\`` in
TypeScript; **objectstack-formula**).

- A yes/no flag is `{ type: 'boolean', defaultValue: false }`. `required` on
  it refuses only `null`, so it never means "must be checked": that is a
  `validations[]` rule.
- A dynamic default (`defaultValue: 'current_user'`) resolves when
  the record is SAVED with the field empty. Describe it as save-time, not as
  a pre-filled form.

More: [Field Types](./rules/field-types.md#choosing-a-type).

### Relationship Patterns

| Need | Model it as |
|:--|:--|
| Many-to-many | multi-value `lookup` (`multiple: true`), an **array of ids**; with attributes, a junction object with two `lookup` fields |
| Record status / lifecycle | a `select` on the business object (plus a `state_machine` validation), never a separate status / stage / step table |
| Approval, review, routing, audit trail | not objects: an approval is a flow node (**objectstack-automation**) and its trail is platform history; model only the people, as `user` fields |
| Record owner | the platform's `owner_id` (`ownership: 'user'`, the default), also when the request says assignee, 负责人 or 处理人; never a hand-added owner field, which owner-scoped visibility and "My records" views never read |

The rest, and a handler named apart from the owner:
[Relationships](./rules/relationships.md).

### Validation Patterns

**⚠️ Script validation is inverted:** it **fails** when the expression is
`true`. On insert an omitted optional field reads as `null` in the predicate.

A `state_machine` rule that runs on insert declares `initialStates` (entry
states only), or publish refuses it: a record could be created already
`approved`. **There is NO `unique` validation type**:
uniqueness is a unique index with its scope
([Validation](./rules/validation.md#uniqueness--use-unique-indexes)).

### Access depth (scope-depth) — the ERP "see my unit / my unit and below" axis

On a `private` object a permission-set grant may carry `readScope` /
`writeScope`: `own` (default) · `own_and_reports` · `unit` · `unit_and_below` ·
`org`. Only `own` and `org` work in open source: the other three need the paid
`@objectstack/security-enterprise` plugin, **fail closed to `own`** without
it, and need `requires: ['hierarchy-security']` on the stack.
