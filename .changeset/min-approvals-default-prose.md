---
'@objectstack/spec': patch
---

Approval nodes: `minApprovals` now documents its real per-behavior default.

The property described itself as "Default 1", but an omitted threshold has never
meant 1 under `behavior: 'quorum'` — the approval runtime falls back to the
resolvable approver count, so a quorum node authored without `minApprovals`
requires **every** approver rather than one. Under `behavior: 'per_group'` the
fallback really is one approval per group.

The schema text and the generated reference table now state both defaults. This
is a documentation correction only: no schema default was added, the accepted
value set is unchanged, and no stored approval flow changes behavior.
