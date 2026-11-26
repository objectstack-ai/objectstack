# Context packs (`ai_context`)

A context pack says which material of **one record** a model is handed: fields
of the root object, child lists that point at the record, and one long-text
field read as its body. Its only reader is the `get_record_context` tool, which
reads every part **as the caller**. A pack is no permission: it grants nothing
and hides nothing. Several packs may root on one object.

Author it under `aiContexts` on the stack, or as a `*.ai-context.ts` /
`*.ai-context.yml` file.

<!-- os:check -->
```typescript
import type { AiContext } from '@objectstack/spec/ai';

export const AccountBrief: AiContext = {
  name: 'account_brief',
  label: 'Account brief for sales',
  object: 'account',
  fields: ['name', 'industry', 'tier', 'annual_revenue'],
  related: [{
    object: 'opportunity',
    field: 'account',
    fields: ['name', 'stage', 'amount', 'close_date'],
    where: { stage: { $nin: ['closed_won', 'closed_lost'] } },
    orderBy: [{ field: 'close_date', order: 'asc' }],
    limit: 10,
  }],
  body: { field: 'notes' },
};
```

## Keys

Strict: an unknown key, or a pack over a bound, is refused at parse, so nothing
is cut silently at call time. `name`, `label` and `object` are required.

| Key | Contract |
|:--|:--|
| `name` | snake_case; what the tool's `context` argument names |
| `label` | The answer's header, and how the pack is listed when its object has several. Say the audience here: there is no `description` key |
| `object` | The root object. A call reads one record of it |
| `fields` | Up to 30 root fields, in order, none twice. A lookup is answered with the name of the record it points at |
| `related` | Up to 3 child lists, one level deep |
| `body` | `{ field }`: a `textarea`, `markdown`, `html` or `richtext` field of the root |

A `related` entry:

| Key | Contract |
|:--|:--|
| `object` | A child object with a reference field (lookup, master-detail, user, tree) that points at the root |
| `field` | That reference field. Required when the child has several |
| `fields` | Up to 10 columns per row. Omitted: the row's name only |
| `where` | Which rows: a filter on the child's **own** fields. A bare value is `$eq`; the operators are `$eq` `$ne` `$in` `$nin` `$gt` `$gte` `$lt` `$lte` `$null` `$exists`, joined by `$and` / `$or`. Comparands are literals: a dotted path, `{ $field }`, `$now` and a `{…}` placeholder are refused at parse |
| `orderBy` | `[{ field, order }]` on the child's own fields; `order` is `asc` (default) or `desc`. Omitted: the data engine's order |
| `limit` | 1 to 20 rows; 20 is the default and the cap. A cut list says so in the answer |

Give a list its `where`, `orderBy` and `limit`, so the model gets the rows that
matter and not the first 20.

**The body.** Up to 8,000 characters it is carried whole. A longer body comes
back as an outline of its headings, each with an `anchor`, and the model reads
one section by calling again with that `anchor`. Headings are Markdown `#`
lines in `textarea` / `markdown`, `<h1>` to `<h6>` in `html` / `richtext`. A
long body with no headings is cut at the bound and marked `truncated`, so give
a long body headings.

## Serving and calling it

`get_record_context` exists only on a host that mounts
`@objectstack/service-record-context`: declare `requires: ['record-context']`
on the stack (the CLI mounts it), or list `new RecordContextServicePlugin()` in
`plugins` in a host that composes its own kernel. With neither, no such tool is
served, whatever packs the stack holds. Over MCP it sits under `data:read`.

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
  `?package=`; without it the read is refused `409`.

## What the caller is not shown, and what `os validate` reports

Read as the caller: a field the caller cannot read carries no value, and a
related list is left out when the caller cannot read its object or link field,
or cannot query on a field its `where` / `orderBy` names. `notes` then state
that some material is not visible: for a list, one `not_visible` note naming
nothing. The whole call is refused (`403 PERMISSION_DENIED`) for a `related`
object nobody is served (a system object the record tools refuse, one closed
to API list reads or in a disabled package), and for a lookup shown to the
caller whose target is such a system object.

An author's mistake is silent at the tool. `os validate` reports it as a
warning:

| Rule | The pack names |
|:--|:--|
| `ai-context-object-unknown` | a root or `related` object the stack does not define |
| `ai-context-field-unknown` | a field its object lacks. In a `where` or `orderBy`, the whole list is left out of every answer |
| `ai-context-related-link-unknown` | no reference field to the root, or several and no `field` |
| `ai-context-body-not-long-text` | a `body.field` that is not long text: the answer carries no body |
| `ai-context-sort-field-unsortable` | an `orderBy` field that is a formula or declares `sortable: false`: the list is left out |
