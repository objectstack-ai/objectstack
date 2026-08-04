---
"objectstack-vscode": patch
---

fix(vscode): every contributed snippet expands to metadata the spec accepts — and a gate that keeps it that way (#4917)

The extension's snippets are a metadata **producer**: whatever `os-view-grid`
expands to is the first `.view.ts` an author (human or AI) ever writes. Nothing
in this repo has ever parsed that output, so the snippets drifted out of the
spec in silence. An audit of all eight found **five** broken against
`@objectstack/spec` 17:

| snippet | what was rejected | canonical form now |
|---|---|---|
| `os-view-grid` | `list.defaultSort`, `list.pageSize` (never declared on `ListViewSchema`); plus `type` / `objectName` on the **container**, which is the flat-view-where-a-container-goes mistake `ViewSchema`'s own guidance names | `defineView({ object, list: { …, sort: [{ field, order }], pagination: { pageSize } } })` |
| `os-flow` | node `name` / `next` (the keys are `label` + an `edges` array), and a top-level `trigger` block | `defineFlow` with the object binding on the START node's `config: { objectName, triggerType }` and an explicit `edges: []` |
| `os-agent` | `tools` — removed in protocol 17 (#3894) | `skills: []` |
| `os-stack` | `manifest` missing the required `id` and `type` | `{ id, namespace, version, type, name, engines }` |
| `os-field-lookup` | `reference: { object, labelField }` — `reference` is a plain object name | `reference: 'target_object'` + `displayField` |

Separately, **all five** module snippets imported `{ Data }` / `{ UI }` /
`{ Automation }` / `{ AI }` from the package root. Those namespace re-exports
were removed for being untree-shakeable (see `packages/spec/src/index.ts`), so
the very first line of each scaffold did not resolve. They now import from the
subpath and author through the domain's validating factory — `ObjectSchema.create`,
`defineView`, `defineFlow`, `defineAgent`, `defineStack` — which parses at
authoring time and, being a *value* import, fails loudly instead of degrading
to `any` (issue #2035's rationale, applied to the scaffolds themselves).

**The recurrence is what actually got fixed.** `os-view-grid` broke because
#4001 closed `ListViewSchema` for unknown keys and no gate anywhere could see a
snippet body; the next strictness batch would have broken another one the same
way. The package now has a `test` script that expands every snippet, evaluates
it against the real spec, and `safeParse`s the authored literal with the schema
the runtime uses. Three independent failure modes are covered — the expansion
does not evaluate, the literal does not parse, or an import names a binding the
spec no longer exports — with a negative control asserting the pre-fix shape is
still rejected, a plan table that fails when a snippet arrives ungated, and a
lockstep check on the `engines.protocol` major so that stamp cannot rot either.

No authoring change is required of anyone: this only replaces snippet output
that never validated.
