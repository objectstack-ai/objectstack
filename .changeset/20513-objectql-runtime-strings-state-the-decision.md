---
'@objectstack/objectql': patch
---

objectql refusals, log lines and metadata text no longer cite tracker numbers; each states the reason in words

Clause-②: no

Many messages the query engine shows to authors, administrators and operators ended with an
issue-tracker number where the reason belonged. The number goes, and where the sentence did not
already say what was decided, it now does:

- Refusals: the bulk update and bulk delete row-scoping refusals now name the seed they are missing
  (the AST seeded before the middleware chain, which RLS and sharing compose their row-scoping onto,
  so a bulk write reaches only the rows the caller may edit); the hook-target rebind refusal says
  why `delete()` stopped honouring a rebind (a handler that silently redirects which row gets
  deleted is a trap) and names the `dispatchUnscopedMultiWrite` registration the whole-operation
  dispatch goes to, on update and delete alike. The unknown-option, filter-array,
  credential-aggregation, HAVING-operator, empty-hook-target, strict read-only and system-write
  organization refusals lose only the citation, because their sentences already said it.
- Metadata text: the lifecycle `retention_overrides` setting description and the search companion
  field description lose their citation.
- Log lines: the non-atomic cascade warning says a single-datasource cascade is now one
  transaction; the system-ledger transaction line calls the ledger the one class carved out of the
  cross-datasource write refusal; the dangling-reference audit summary says findings are reported,
  never rewritten, because a system-context write is exempt from the write-time reference check;
  the legacy `apiMethods` warning says the authorable values are the six primitives only, every
  other operation being derived from them or retired; the two unevaluable-rule warnings say such a
  rule fails closed and is never skipped. The ADR-0104 value-shape gate lines, the delegated
  protocol-assembly line and the read-only and runtime-owned strip warnings lose only the citation.

The `findOne` no-predicate refusal keeps its citation for now: `@objectstack/metadata-core`
carries a byte-identical copy that this package's tests compare against, and both move together.

Text only: no error code, field name, status or behaviour changes.
