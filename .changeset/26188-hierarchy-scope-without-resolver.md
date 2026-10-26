---
'@objectstack/metadata-protocol': patch
'@objectstack/plugin-security': patch
'@objectstack/spec': patch
---

fix(metadata-protocol)!: a permission set that grants a hierarchy scope is refused on publish, and warned on a draft save, when the runtime mounts no hierarchy resolver; explain names the absent resolver (#26188)

Clause-②: yes (narrowing: on a runtime with no hierarchy resolver, publishing a permission set whose grant uses `own_and_reports`, `unit` or `unit_and_below` is refused, where it used to answer 200; widened: `@objectstack/spec/security` gains the export `findHierarchyScopeGrants`, and `@objectstack/plugin-security`'s `ExplainEngineDeps` gains the optional member `hierarchyResolverMounted`)
Metadata-protocol: none
Ruling-ref: #26059 ruling Q3 / Q4 (`6416233738`), items 9a and 9b of the item reading (`6415971852`)

`own_and_reports`, `unit` and `unit_and_below` are enforced only by the enterprise hierarchy resolver (capability `hierarchy-security`, ADR-0057). Without it the open sharing service evaluates them as `own`. `defineStack` already refuses such a grant unless the stack declares `requires: ['hierarchy-security']`, but a runtime save of the same permission set answered 200 with no word, and explain then told a manager that a subordinate's record was outside their unit.

What changes:

- The runtime authoring gate reads whether a hierarchy resolver is mounted (the kernel service `hierarchy-scope-resolver`) on every metadata write. When none is, a permission set whose `readScope` or `writeScope` is a hierarchy depth is refused on publish: a direct active save, the per-item publish of a draft, the package batch publish and a restore to such a version all answer 422 `INVALID_METADATA`, with one `issues[]` entry per grant under the rule `hierarchy-scope-capability-required`. The entry is located at the grant and names the `hierarchy-security` requirement.
- A draft save of the same body still succeeds. Its answer carries the same finding, at `severity: 'warning'`, in `advisories`.
- With a resolver mounted, nothing changes. A host with no service registry (the CLI) judges nothing here; `defineStack` is that host's door.
- `explainAccess`: on a deployment with no resolver, the depth layer's record cell for a hierarchy read depth now reads "Hierarchy resolver absent — requires enterprise; depth evaluated as 'own'." instead of saying the owner is outside the caller's read depth.
- `@objectstack/spec/security` exports `findHierarchyScopeGrants`, the one list of hierarchy depths and the one finding sentence. `defineStack`'s refusal reads it too, and its message is unchanged.

**BREAKING** for a runtime with no hierarchy resolver that publishes hierarchy-scope grants at runtime.

- **Before.** The publish answered 200 and the grant was enforced as owner-only.
- **Now.** The publish answers 422 `INVALID_METADATA` with the rule `hierarchy-scope-capability-required`. A draft save warns.
- **Fix.** Set the grant's `readScope` / `writeScope` to `own` or `org`, or run the permission set on a runtime that mounts the enterprise hierarchy resolver (`hierarchy-security`). Rows already stored are read as before.

<!-- adr-0087: not-required (no-migration-prescription) a run-time narrowing at the metadata publish door, conditional on a deployment fact (no hierarchy resolver mounted). No authorable key, spelling or stored shape moves: the permission-set schema parses exactly as before, `defineStack` already refused the same grant, and no stored row is read, rewritten or converted. The repair is the author's choice between a non-hierarchy depth and an enterprise runtime, which no ledger entry can derive. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers this verdict (not already-registered); the one spec export is added, not moved, renamed or removed; and nothing a stored artifact carries changes type, so no conversion has a source to rewrite. -->
