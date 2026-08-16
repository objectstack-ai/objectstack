---
"@objectstack/dogfood": patch
---

docs(qa): narrow the ADR-0056 D10 authz conformance matrix's advertised completeness claim to what its ratchet actually checks (#8711)

The matrix header and its companion test's header previously read as though
a new declared-but-unenforced authorization primitive would "break CI." It
would not, for most of the ledger: the completeness `discover()` ratchets is
over a **curated table of HTTP/transport entry points** (15 probes over 11
named source files), not over primitives. A primitive enforced by a predicate
inside an existing resolver — the `sys_permission_set.active` /
`sys_position.active` rows added in #8812 are the normal case, not an
exception — adds no entry point, so it can be neither UNCLASSIFIED nor STALE.

Both headers now say so explicitly, carrying the measured numbers so the
narrowed claim is load-bearing rather than vague: 43 of the matrix's 50 rows
carry no `covers` key at all, 37 of the 43 `enforced` rows are exactly that
in-resolver shape, and — preserved, because it is real — 5 of the file's 9
`covers` keys are gate-pins that vanish (and fail CI) when the guard call
they name is deleted. Prose and comments only; nothing about the ratchet's
checking behaviour, the `discover()` table, or any row changes. Maintainer
ruling on #8711 (Option A): narrow the claim, do not build a
primitive-discovery ratchet (measured unachievable in general form).
