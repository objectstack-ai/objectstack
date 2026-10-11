---
'@objectstack/spec': patch
---

docs(spec): `RuntimeAuthoringIssueSchema.path` states the name-keying rule for every collection-resident write type, so a `dataset` write's name-keyed paths are no longer described as positional

Clause-②: no

The description of `path` on a runtime publish-gate finding (the 422 `issues[]` and the 2xx `advisories[]`) named `object`, `permission` and `book` as the only write types whose top-level collection entry is keyed by name, and called every other write type positional. A `dataset` write's findings have been name-keyed too (for example `datasets.acme_invoice_metrics.dimensions[0].field`), so a consumer that followed the text would have expected `datasets[N]` and never received it.

The description now states the rule instead of a list: a write type is collection-resident when the gate's per-write snapshot holds the tenant's other stored items of that type beside the written one, and there the top-level entry is keyed by name. Every other write type is the only member of its collection in that snapshot, so its `[0]` stays positional. The set is derived inside `@objectstack/lint`'s runtime gate, and the description names that derivation rather than copying its members. It also states the fallback the gate already applies: an entry whose name cannot be spliced into a dotted path keeps its index.

Description text only: the schema's shape, accepted values and types are unchanged. The generated `content/docs/references/api/protocol.mdx` is regenerated.
