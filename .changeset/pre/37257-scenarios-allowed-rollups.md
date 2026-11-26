---
'@objectstack/scenarios': patch
---

feat(scenarios): a scenario card may name the roll-ups a persona is meant to read over rows it withholds

Clause-②: no
Metadata-protocol: none

A persona on a scenario card may now carry `allowedRollups` (`[{ "object": "invoice", "field": "amount_paid" }]`, in the card's bare names). The runner's Build charge for `security-rollup-source-unreadable` does not charge a finding the build acknowledged (`rollupSourceUnreadableReason` on the persona's set) on one of those roll-ups; an unacknowledged finding on it, and every other roll-up over withheld data, is still charged. The schema refuses an allowed roll-up the persona's own `hidden` names. The `order_to_cash` card uses it: a sales rep sees their invoices' amount paid, balance and status, never the payment rows.
