---
'@objectstack/lint': minor
---

**BREAKING** fix(lint)!: an app navigation `visible` that does not parse is refused like a page `visibleWhen`, and page variables must be unique, named and seeded with a default of their type

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches a navigation entry's `visible` grammar or the page `variables` list; the refusals carry their own fix and `os explain` entries.

<!-- adr-0087: not-required (no-migration-prescription) The narrowing is a refusal at the authoring doors (the metadata save door, a draft's diagnostics and its publish, and os validate / os build / os lint) of two value shapes that never worked at runtime: a navigation `visible` the CEL front end cannot parse (the console hides the entry from every viewer), and a page `variables` list with a duplicate name, an empty name, or a `defaultValue` of another type than the declared one. No metadata key, accepted key, export or error code is removed or renamed, and no stored shape changes. The fix is the author's choice of the predicate or the declaration they meant, so there is no mechanical conversion for `objectstack migrate meta` to apply; the shipped corpus (examples, platform packages) carries 1 navigation `visible` and 5 page variables, none of them refused. -->

Two authoring shapes saved, read `valid: true` as drafts, published and passed `os validate`, and then did something the author never asked for.

**A navigation `visible` that does not parse.** `navigation[].visible`, `areas[].navigation[].visible` and every entry's `children` are now judged by `visibility-predicate-syntax`, the verdict a page component's `visibleWhen` already gets. A bare string and a `{ dialect: 'cel' }` envelope are CEL (the console evaluates both on the CEL engine); an envelope of another dialect is the console's legacy reading and is not judged. Only the syntax is judged on a navigation entry: it binds the shell's roots (`current_user`, `user`, `features`, …), not a page's `record`, so the reference checks a page predicate gets do not apply. The finding is located at the key (`apps[0].navigation[0].visible`), and its verdict says the entry is hidden from every viewer, since the console's navigation gate falls closed on a fault.

**Page variable declarations.** A new rule, `validatePageVariables`, refuses at the same doors:

- `page-variable-name-duplicate`: the same `name` twice (the console keeps the last declaration, so the first one's type and default were silently dropped);
- `page-variable-name-empty`: an empty or blank `name` (no `page.NAME` read can reach it);
- `page-variable-default-type`: a `defaultValue` of another kind than the declared `type` (a string for `string` and `record_id`, a finite number for `number`, a boolean for `boolean`, a plain object for `object`, an array for `array`; `null` is admitted for any type, and a variable with no `type` is a `string`).

**Where.** The metadata save door (`PUT /api/v1/meta/app/:name` and `/meta/page/:name`, Studio, MCP), a draft's `_diagnostics`, the publish (`422 INVALID_METADATA`), and `os validate` / `os build` / `os lint`. Stored apps and pages keep loading and serving; only the next save of one with a finding is refused, with the fix.
