---
---

Docs-only: v17 docs sweep run 5 (rc.2 catch-up over the `2bafe62e..a2ebea2e`
window). Three hand-written pages had drifted behind changes that landed in the
window; the rest of the sweep's search surface came back clean.

- **`data-modeling/validation.mdx` contradicted itself.** The `has(x)` callout
  (added by #4763) says an unevaluable predicate is "rejected fail-closed", while
  the `condition` paragraph twelve lines later still taught the pre-17 behaviour —
  "logged and skipped rather than blocking the write". That is exactly what #4649
  reversed, and it is the sentence an upgrading author reads to decide whether
  their rules are enforcing anything. Rewritten to the shipped contract:
  `VALIDATION_FAILED` naming the rule and the offending key, `severity` still
  governing blocking, and the total stored-⊕-payload record that makes the
  `has()` callout true in the first place.

- **`automation/hooks.mdx` had no coverage of the declarative `condition` gate** —
  one passing clause under wildcard hooks, and nothing else — while three changes
  landed on it in this window, one of them breaking. Adds a "The `condition` gate"
  section: an unevaluable condition now ABORTS the operation instead of silently
  skipping the hook (#4775), the condition evaluates against stored ⊕ payload
  rather than the write's payload alone (#4770), and `previous` is bound so a
  condition can express a transition (#4784) — including the upgrade note that
  `record.x == v` alone is now true on every update of an already-matching row.

- **`concepts/metadata-lifecycle.mdx` did not list `job`**, which is the page that
  explains the two-tier overlay/runtime-create gate and therefore where an author
  looks when "create job" disappears from Studio. Adds the row with #4509's
  reasoning (`handler` names a compiled-bundle function a runtime writer cannot
  reach), and notes that the standalone `validation` kind is gone under ADR-0088.

Releases nothing.
