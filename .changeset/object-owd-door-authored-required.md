---
"@objectstack/lint": minor
"@objectstack/plugin-security": minor
---

feat(lint): an authored OWD is required at the runtime object door — `runtimeTypes` gains `object`, completing the #7891 flip; the plugin gate's R2 `owd_external_wider` arm is retired as its duplicate (#8310, maintainer-ruled)

The security publish linter (`validateSecurityPosture`, ADR-0090 D7) now runs
for runtime-authored **object** publishes, alongside the `seed` /
`permission` / `book` types that crossed earlier in the #7891 rollout. An
active-state object publish — Studio publish, direct REST save, AI builders —
with **no authored `sharingModel`** is refused with `422 INVALID_METADATA`
(`security-owd-unset` in `issues`): absence is not a decision. Previously the
runtime door accepted OWD-less bodies and silently defaulted them to
`private` (ADR-0090 D1) while the CLI refused the same body — the runtime
door was permanently weaker than the build door on exactly the hottest
AI-author write path.

Door order at `saveMetaItem`, now pinned end-to-end: the **422 lint door
answers first** (all 12 rule ids of the D7 block, external ≤ internal
included), then the ADR-0094-seam plugin gate answers for what passes lint.
Consequences:

- `objectPostureGate`'s **R2 arm (`403 owd_external_wider`, external ≤
  internal) is retired as a duplicate** of the lint door (maintainer ruling
  on #8310; ADR-0094 amendment rides this change). An external-wider pair now
  answers `422` / `security-external-wider-than-internal` instead of `403` /
  `owd_external_wider`. R2's only non-shadowed refusals were false positives
  (system objects, whose unset OWD is effectively PUBLIC at runtime, and
  draft saves, which the lint discipline defers to the draft→active
  promotion gate per #4463 D1).
- **R1 stays**: an environment overlay may still only TIGHTEN a packaged
  object's posture (`403 owd_widening_forbidden`) — no lint rule can judge
  the packaged baseline.
- Draft saves are ungated (work-in-progress may be dirty); the draft→active
  promotion runs the same 422 gate, so no defective body reaches `active`.
- The `package-author` channel carve-out (#6710) is unchanged on both doors.

Migration: author `sharingModel` explicitly on every runtime-published object
body (`'private'` is the recommended default; `'public_read'`,
`'public_read_write'`, `'controlled_by_parent'` for master-detail children).
Stored metadata is untouched — the gate judges new writes only, and a clean
write is never blamed for a pre-existing OWD-less object in the environment
(the gate's baseline/candidate differential cancels context findings).
`OS_ALLOW_UNLINTED_METADATA_WRITES=1` remains the loud migration hatch.
