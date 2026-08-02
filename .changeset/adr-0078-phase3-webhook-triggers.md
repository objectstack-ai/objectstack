---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

ADR-0078 Phase 3: a webhook with no `triggers` now fails at author time — and the Tier-B candidate list is corrected to what verification actually supports.

**The rule.** `webhook/without-triggers`, error severity, in the shared `@objectstack/spec/kernel` predicate alongside the Phase 1 rules, walked by `@objectstack/lint`'s `validate-functional-completeness` over `stack.webhooks` in both collection spellings. A webhook that declares no trigger materializes into `sys_webhook`, renders in Setup looking armed, and delivers nothing.

**Why it needed two sources, and why the first one argued against it.** The runtime skip site reads:

```
if (triggers.size === 0) {
    // No dispatchable triggers (or a manual-only webhook with none) —
    // skip auto-enqueue.
    return null;
```

That parenthetical *blesses* the empty case as a deliberate mode — structurally identical to the `multiselect`-without-options NON-rule, where `record-validator.ts`'s `// free-form (tags without options)` is exactly why we do not flag it. On that evidence alone this candidate stays unenforced.

The mode it names does not exist. `webhook.zod.ts`'s #3196 note records that the `api` (manual/programmatic fire) trigger was *removed* because "no manual fire path exists — the only webhook HTTP surface re-queues already-failed deliveries". There is no way to fire a webhook the auto-enqueuer dropped. Inert on every path, so: `error`.

> **The generalization, now written into the module and pinned by a test:** a runtime comment records what its author believed, and beliefs go stale when a sibling feature is deleted. A blessing has to be corroborated by something showing the blessed mode is still *reachable* — otherwise it is a comment about a mode that no longer exists. The test asserts the finding carries both citations, so nobody demotes this rule on the strength of the comment alone.

`triggers: []` is flagged identically to an omitted `triggers`. Unlike an action's `locations: []` — the documented headless spelling — an empty array here carries no "I meant it" signal, because turning a webhook off has its own key (`isActive`). The repo's one real webhook (`showcase_task_changed`) confirms it: shipped inactive via `isActive: false`, with a full trigger list.

**The corrected Tier-B disposition.** Phase 3 was scoped from the 2026-06 audit's Tier-A/B catalog. Verifying each candidate before writing it — the discipline that caught four false prescriptions in #4001 — found most of the list already closed or misfiled:

| candidate | disposition |
|---|---|
| A2 action without `locations` | **already shipped** — `validate-action-locations.ts`, which already exempts the documented `locations: []` |
| B approval empty/unresolvable approvers | **already shipped** — `validate-approval-approvers.ts` |
| B select/multiselect without options | shipped in Phase 1 |
| B write-side referential integrity | **not an authoring-lint item** — a runtime gap; no metadata omission to detect |
| B `unique:true` no-op on memory driver | **not an authoring-lint item** — a driver gap |
| B composite/repeater sub-field constraints | **not an authoring-lint item** — a runtime gap |
| B nav targets of type page/report/url/component/action | **genuine gap, different module** — the key is present but dangling, which is reference resolvability (ADR-0072), not completeness (ADR-0078) |
| B dataset with zero measures | **unverified — not shipped.** No runtime consumer in this repo; the dataset compiler lives elsewhere |
| B webhook without triggers | ✅ **this change** |
| B schedule trigger with invalid cron | **unverified — not shipped.** `normalizeSchedule` accepts any non-empty string, but the scheduler's behaviour on an invalid one was not traced |

Two candidates are deliberately left unshipped rather than written on the audit's stated confidence, and one is left for the module that actually owns it. The audit's own lesson stands: it produces *candidates*, not confirmed bugs — the scariest one collapsed on a three-file read.

Tracked in #4544.
