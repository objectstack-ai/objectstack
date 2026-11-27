# Context packs (`ai_context`)

A context pack says which material of **one record** a model is handed. Its
only reader is the `get_record_context` tool, which reads every part **as the
caller**: a pack grants nothing and hides nothing.

Author it under `aiContexts` on the stack, or as a `*.ai-context.ts` /
`*.ai-context.yml` file.

<!-- os:check -->
```typescript
import type { AiContext } from '@objectstack/spec/ai';

export const AccountBrief: AiContext = {
  name: 'account_brief',
  label: 'Account brief for sales',
  object: 'account',
  fields: ['name', 'industry'],
  related: [{
    object: 'opportunity',
    field: 'account',
    fields: ['name', 'stage'],
    where: { stage: { $nin: ['closed_won', 'closed_lost'] } },
    orderBy: [{ field: 'close_date', order: 'asc' }],
    limit: 10,
  }],
  body: { field: 'notes' },
};
```

## Keys

Strict: an unknown key, or a pack over a bound, is refused at parse. `name`,
`label` and `object` are required.

| Key | Contract |
|:--|:--|
| `name` | snake_case |
| `label` | The answer's header. Say the audience here: there is no `description` key |
| `object` | The root object |
| `fields` | Up to 30 fields, in order, none twice. A lookup is answered with its target's name |
| `related` | Up to 3 child lists, one level deep |
| `body` | `{ field }`: a `textarea`, `markdown`, `html` or `richtext` field of the root |

A `related` entry:

| Key | Contract |
|:--|:--|
| `object` | A child object with a reference field (lookup, master-detail, user, tree) that points at the root |
| `field` | That reference field. Required when the child has several |
| `fields` | Up to 10 columns per row. Omitted: the row's name only |
| `where` | A filter on the child's **own** fields. A bare value is `$eq`; the operators are `$eq` `$ne` `$in` `$nin` `$gt` `$gte` `$lt` `$lte` `$null` `$exists`, joined by `$and` / `$or`. Comparands are literals: a dotted path, `{ $field }`, `$now` and a `{…}` placeholder are refused at parse |
| `orderBy` | `[{ field, order }]` on the child's own fields; `order` is `asc` (default) or `desc`. Omitted: the data engine's order |
| `limit` | 1 to 20 rows, default 20 |

Give a list its `where`, `orderBy` and `limit`, so the model gets the rows that
matter and not the first 20.

**The body.** Up to 8,000 characters it is carried whole. A longer body comes
back as an outline of its headings; the model reads one section by
calling again with a heading's `anchor`. Headings are Markdown `#`
lines in `textarea` / `markdown`, `<h1>` to `<h6>` in `html` / `richtext`. A
long body with no headings is cut at the bound and marked `truncated`: give
it headings.

## Serving and calling it

`get_record_context` exists only on a host that mounts
`@objectstack/service-record-context`: declare `requires: ['record-context']`
on the stack (the CLI mounts it), or list `new RecordContextServicePlugin()` in
`plugins` in a host that composes its own kernel. Over MCP it sits under
`data:read`.

The call is `{ objectName, recordId, context?, anchor? }`; the answer is
`{ data, notes, framing }`. `data` is record material, never instructions;
`notes` say what was withheld or cut.

- **`context` omitted** reads the object's one pack. No pack is refused `404`
  (read the record with `get_record`); several are refused `400`, each listed
  by its face and `label`.
- **A pack is identified by its package and its name**, as a skill is. A
  namespace holds one pack per name: a second holder is refused at install
  (`422 NAMESPACE_CONFLICT`) and by `os validate`.
- **`context` takes a pack's face**: `NAMESPACE-NAME` for a pack a package
  ships, the bare name for the environment's own. A bare name also resolves
  when one package holds it; held by two, it is refused
  `409 RESOURCE_CONFLICT`, naming each face.
- `GET /api/v1/meta/ai_context/NAME` for a name two packages hold needs
  `?package=`, or is refused `409`.

**A skill's `context`.** Where it resolves to a pack and the server serves
`get_record_context`, the skill's MCP prompt takes an optional `recordId`.
With it the message is the instructions, a fixed line asking for that call
and its arguments as JSON; the record is never inlined. Without it the prompt
is unchanged.

## What the caller is not shown, and what `os validate` reports

A field the caller cannot read carries no value, and a
related list is left out when the caller cannot read its object or link field,
or cannot query on a field its `where` / `orderBy` names. `notes` then state
that some material is not visible: for a list, one `not_visible` note naming
nothing. The whole call is refused (`403 PERMISSION_DENIED`) for a `related`
object nobody is served (a system object the record tools refuse, one closed
to API list reads or in a disabled package), and for a lookup shown to the
caller whose target is such a system object.

`os validate` warns on an author's mistake, silent at the tool:

| Rule | Reported for |
|:--|:--|
| `ai-context-object-unknown` | a root or `related` object the stack does not define |
| `ai-context-field-unknown` | a field its object lacks. In a `where` or `orderBy`, the list is left out |
| `ai-context-field-unprovisioned` | an injected column with no storage on an `external` object |
| `ai-context-related-link-unknown` | no reference field to the root, or several and no `field` |
| `ai-context-body-not-long-text` | a `body.field` that is not long text: the answer carries no body |
| `ai-context-sort-field-unsortable` | an `orderBy` field that is a formula or declares `sortable: false`: the list is left out |
| `ai-skill-context-unknown` | a skill's `context` no pack of the stack's own has (a dependency's is not read) |
| `ai-skill-context-omitted` | a skill binding `get_record_context` without `context`, while an object has several packs |
