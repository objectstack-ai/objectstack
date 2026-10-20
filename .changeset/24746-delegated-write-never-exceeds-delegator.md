---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an on-behalf-of by-id write never admits a row its delegator's own by-id write refuses (ADR-0090 D10)

Clause-②: no

ADR-0090 D10 says a delegated principal, such as an OAuth agent acting for a user, never exceeds its delegator. The by-id write already asked every row gate as the delegator too. But it composed the delegator's row-level write filter differently from the filter the delegator's own direct write of the same row gets. Where an app-authored row-level write policy bounds the delegator, a write on the delegator's behalf could therefore be admitted for a row the delegator's own write is refused.

Each gate that judges a delegated by-id write now also composes the delegator's filter as the delegator's own direct write gets it, and requires both:

- the pre-image check of a by-id `update` or `delete`;
- the post-image check of the row an `update` stores;
- the master gate of a `controlled_by_parent` detail write, on the delegator's pass.

The change only narrows. A write is admitted only where it was admitted before AND the delegator's own write of that row is admitted. Nothing refused before is admitted now: where the delegator's own write admits a row that the delegated write has always refused, that row stays refused. `security.explain`'s record verdict for an on-behalf-of `update` or `delete` composes the same two filters, so it still gives the answer the door gives. Writes that are not delegated are unchanged.
