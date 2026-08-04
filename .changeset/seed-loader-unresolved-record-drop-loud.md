---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a seed record dropped for an unresolvable reference now says so at `error` (#4997)

When a seed's `lookup` / `master_detail` / `user` reference could not be
resolved and no pass 2 would run (`multiPass: false`), the loader dropped the
**whole record** — the right call, since writing it would put the raw
natural-key string into the FK column or, on an upsert UPDATE, corrupt the row
already there. The drop was counted (`errored`) and reported
(`result.errors` → `success: false`), and the code comment above it claimed
"LOUD", but the branch made **no logger call at all**. On the console a seed
that silently dropped N records was indistinguishable from a clean one, and the
`packages/runtime` seed call sites that only `await` the load never look at
`result.success` — so the loss surfaced later as "the app installed but the data
isn't there".

That branch now logs at `error`, per AGENTS.md → "Degradation log levels"
(#4632): the line names the record (`<object>` record #i), the field, the target
`<object>.<field>` it could not find, and the **consequence** (the whole record
was not seeded — not merely the association), followed by all three **remedies**
— seed the target object first, enable `multiPass` so pass 2 back-fills the
reference, or fix the natural key in the seed data.

The same objective criterion (does the outcome enter `errors`/`allErrors`?)
found one more never-logged branch in the same file and aligned it: a **deferred
reference still unresolved after pass 2** was counted exactly like its sibling
whose back-fill *write* fails — which has logged at `error` since #4729 — and
logged nowhere. It now reports that the row was seeded while the relationship is
permanently missing, and how to complete it.

The **dry-run** branch stays deliberately quiet and is pinned that way by test:
a dry run writes nothing, its caller is by definition reading the result object,
and an `error` line about a simulated outcome only trains readers to skim
`error`. No counters, result shapes or messages in `result.errors` changed —
this is console output that was missing, not a contract change.
