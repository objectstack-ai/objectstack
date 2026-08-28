---
"@objectstack/metadata-core": patch
"@objectstack/metadata": patch
---

feat(metadata-core,metadata): warn the operator when a pre-current-era artifact carries form-view predicates that fault open (#12915)

A form-view predicate binds `record` (+ `previous`, `parent`) in runtime record
forms, or `data` in metadata-editing forms. The contract states the failure mode
beside the vocabulary: **a bare identifier is unbound, the predicate faults, and
`visibleWhen`'s fault fallback is `true`** — so a field the predicate was
authored to hide renders for everyone.

That is quiet alone and lethal in combination with the authoring pattern it
serves. Measured on a real deployment: an artifact built by released
`@objectstack/cli` 17.1.0 authors
`{ field: 'disqualification_reason', required: true, visibleWhen: 'status == "unqualified"' }`
— the era's working spelling. On a 17.2 runtime the predicate faults open, the
conditionally hidden field renders, and its unconditional `required: true`
blocks **every** record creation through the console, while the same payload
POSTs 201 through REST. Nothing refused and nothing logged, so the operator —
the only person who can rebuild the artifact — had no signal at all.

The framework artifact door now emits **one deduped `warn` line per artifact**
naming the authored `engines.protocol` floor and the runtime spec version, how
many predicates on which views (with the first path as an anchor), the
fault-open consequence, and the remedy (`os build`). It rides the same funnel
that already carries the forward-conversion summaries, so both SaaS shapes are
covered: a single-DB multi-org runtime warns once at boot, and per-tenant-DB
kernels each warn at their own.

**No behaviour change.** No refusal, no rewrite, no schema or contract edit —
the predicate keeps faulting open exactly as before, and the artifact bytes are
untouched. Rewriting a bare root to `record.` is a separate, deferred ADR-0087
conversion.

**Scoped to legacy artifacts by construction.** The notice fires only inside the
versioned window the forward conversion already opens (declared floor below the
running spec, or undeclared), read off that pass's own verdict rather than
recomputed. An artifact declaring the current or a newer floor gets zero notices
from this feature even when it carries bare roots — the boundary that keeps a
notice about legacy artifacts out of contract territory.

Detection is exported from `@objectstack/metadata-core` as
`detectUnboundFormViewPredicateRoots` (with `BOUND_FORM_VIEW_PREDICATE_ROOTS`)
so other composed artifact doors can reuse one policy rather than fork it. It is
pure, read-only, and tuned to prefer silence over a false accusation: string
literals are stripped before the scan, only root position counts, call targets
are not roots, comprehension macros (whose iteration variable is locally bound)
are skipped whole, and AST-only envelopes pass.
