---
'@objectstack/spec': major
'@objectstack/service-automation': patch
'@objectstack/plugin-approvals': patch
---

refactor(spec)!: retire `ActionDescriptor.isAsync` — a second spelling of `supportsPause` that nothing ever read (#6748, ADR-0049)

<!-- adr-0087: registered action-descriptor-is-async-retired -->

**FROM → TO:** `isAsync: true` → delete the key; declare `supportsPause: true` (plus the
`resumeAuthority` its pauses need) and return `suspend: true` from `execute()`.
`isAsync: false` → delete the key; there was never anything to preserve.

`ActionDescriptor.isAsync` declared "suspends the flow awaiting an external reply" and no
execution path read it. Measured fresh before removal across all three repos — objectstack,
objectui and cloud — with zero property reads: every hit was the declaration itself, a
generated baseline, one of five shipped descriptors WRITING it, a fixture pinning the
shape, or prose. Declaring it never made a node suspend; omitting it never stopped one.

This is the remove leg of the ADR-0049 disposition its sibling took the other way. The two
keys said the same thing — "this node type can suspend the run" — and #6667 split them by
evidence: `supportsPause` became an enforced fact (`AutomationEngine` now refuses a
suspension whose type does not declare it, at the one seam every suspension passes
through), while `isAsync` had no consumer to grow into. Keeping both would leave the
platform publishing two names for one capability with only one of them honoured — and
`screen` declared BOTH, so a plugin author copying it had no way to tell which.

The retirement kit:

- **Tombstone, not deletion** (`retiredKey()`): `ActionDescriptorSchema` is not `.strict()`,
  so a plain delete would let existing descriptors parse clean and lose the key in silence
  (the ADR-0104 shape). Authoring `isAsync` now fails `tsc` at the descriptor literal and
  fails the parse inside `defineActionDescriptor()` — with the prescription in the message.
- **ADR-0087 D3 `SemanticMigration`** (`action-descriptor-is-async-retired`) plus the exact
  `RETIRED_KEYS_BY_MAJOR` entry. No D2 conversion, deliberately: a descriptor is published
  from an executor's TypeScript and never stored in stack metadata, so there is no source
  for `os migrate meta` to rewrite — the `EnhancedApiError.fieldErrors` disposition.
- The five shipped writers stop writing it (`screen`, `map`, `wait`, `approval`,
  `approval_revise`); the descriptors they publish lose the key, which is why the two
  runtime packages appear here.
- Generated baselines (`authorable-surface/automation.json` gains `[RETIRED]`,
  `authorable-defaults/automation.json` loses the default line), `spec-changes.json`, the
  upgrade guide and the reference docs regenerated.

No runtime behaviour changes — that impossibility is the reason for the removal. The same
commit also corrects `supportsPause`'s TSDoc, which still described itself as a declaration
no execution path reads; #6667 made that false (#6749).
