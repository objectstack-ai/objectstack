---
"@objectstack/spec": minor
---

feat(spec): `ActionSession` declares `positions` as canonical and deprecates `roles` (#5779)

The action-body `ctx.session` contract gains `positions`, the ADR-0090 D3 spelling
of the caller's position names, and demotes `roles` to a deprecated alias of it.
This is the **spec half** of #5613 phase 2, under the maintainer's contract-first
ruling ("C skeleton + A semantics"): phase 1 (#5697) declared the shape the runtime
already built, and this opens the rename on top of that declaration.

**What was wrong.** `buildActionSession()` copies `ExecutionContext.positions` into
a key spelled `roles` — the one spelling ADR-0090 D3 bans — so an author met two
different answers to one key name on one platform: `session.roles` is rejected in a
hook (retired in #5050) and live, populated, and load-bearing in an action body.
Phase 1 declared that reality without endorsing it and deliberately withheld a
`positions` key, because minting a second live spelling with no closing date is the
defect rather than the fix. This change mints it **with** a closing date.

**Migration prescription — do this now.**

- Read `ctx.session.positions`. It is the canonical key and it carries exactly the
  array `roles` carried; the rename is a rename, not a semantic change.
- `ctx.session.roles` still resolves for the length of the deprecation window and
  is removed after it, on the path `session.tenantId` already walked (#3280
  deprecated, #3290 removed in v11). A body still reading it at that point sees
  `undefined` with nothing to catch the change — which is why the read moves inside
  the window, not at its close.
- Do **not** migrate an access check by renaming it. `roles.includes('admin')`
  rewritten as `positions.includes('admin')` migrates the defect: neither array is
  an authorization input. Privilege is judged by the security service, which
  evaluates capability grants, placements and the derived posture (ADR-0095).

**Sequencing — the contract leads its producer.** This release ships the contract
only. The producer change (`buildActionSession()` emitting both keys, plus the two
already-tracked wrong sentences in its docblock) is #5613's runtime half and lands
separately. Until it does, a built session still carries only `roles`, so
`positions` is meaning-fixed but not yet presence-guaranteed; both keys are
optional, which is what lets the declaration lead without breaking anything. A
reader that must straddle the seam may read `positions` and fall back to `roles`
for the window's duration only — that fallback expires with the alias.

Additive and non-breaking on its own: adding an optional key rejects nothing that
parsed before, and the runtime consistency pin
(`packages/runtime/src/action-session-shape-contract.test.ts`) is unchanged and
still green.

The reader-facing announcement is the ADR-0087 semantic migration
`action-session-roles-to-positions`, which carries the prescription above and its
acceptance criteria into `spec-changes.json`, the generated upgrade guide and the
`spec_changes` MCP tool.
