// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The protocol-17 leg of the #4001 unknown-key strictness wave, registered as ONE
// entry for the major rather than one per batch — the shape both existing
// precedents already take (`ui-schemas-strict-unknown-keys` at 15,
// `dashboard-widget-strict-unknown-keys` at 16), and the maintainer's ruling on
// #7630 (2026-08-12) against the two alternatives (eleven entries, or a
// per-surface grouping). An upgrader reads ONE prescription covering the whole
// wave; the per-batch trace lives here so an archaeologist can still walk it
// batch by batch. Batches folded into this entry, in landing order:
//
//   1. `unknown-key-strictness-tier-a`                — #4001 Tier-A: `security/permission.zod.ts`
//      (permission set / object / field / admin scope) and `automation/flow.zod.ts`'s four outer
//      shapes (flow / node / edge / variable), plus the shared `strictUnknownKeyError` factory.
//   2. `unknown-key-strictness-step2`                 — #4001 step 2: `security/rls.zod.ts`,
//      `security/sharing.zod.ts` (base + criteria + recipient), `identity/position.zod.ts`.
//   3. `strict-automation-control-flow-state-machine` — #4001 batch 10: five shapes in
//      `automation/control-flow.zod.ts`, six in `automation/state-machine.zod.ts`.
//   4. `unknown-key-strictness-automation-batch11`    — #4001 batch 11: flow's six NESTED blocks,
//      `time-relative-trigger.zod.ts`, `flow-function.zod.ts`, `webhook.zod.ts`.
//   5. `unknown-key-strictness-ui-batch13`            — #4001 batch 13: all four shapes in
//      `ui/responsive.zod.ts` (strictness does not recurse, so `PageComponentSchema.strict()`
//      had never reached them).
//   6. `unknown-key-strictness-ui-batch15`            — #4001 batch 15: `ui/theme.zod.ts` 14/14,
//      `ui/chart.zod.ts` 5/7 (two arms left open, measured `no gate`).
//   7. `unknown-key-strictness-ui-batch16`            — #4001 batch 16: `AriaPropsSchema`
//      (`ui/i18n.zod.ts`), carried as `aria:` on ~30 live shapes under six metadata roots.
//   8. `view-subblock-strictness-batch18`             — #4001 batch 18: fifteen `ui/view.zod.ts`
//      sub-blocks (view data arms, filter/gantt options, conditional formatting, empty state,
//      subforms, submit behaviour).
//   9. `rare-jars-shave`                              — `ViewItemSchema` split into a strict
//      authoring gate and a `.strip()` wire variant; `ViewFilterRuleSchema` and `ListView.sort[]`
//      closed with it.
//  10. `user-filters-allow-add-tab-promote-and-close` — #5073: `userFilters.allowAddTab` promoted
//      into the contract, `UserFiltersSchema` closed behind it, `ObjectUserFiltersSchema`
//      rejecting the three page-only keys.
//  11. `view-union-identity-precondition`             — #5599: the `view` write-path union stops
//      matching every object — one level ABOVE the object schemas the ten batches closed.
//
// Two adjacent seams are deliberately NOT covered here and are recorded on #7630: the 45 `~`
// rows of the #6350 audit (a ledger file was touched by some commit, which does not prove the
// entry covers that face) and the 7 borderline candidates PR #7624 judged not-owed.
export const entry: SemanticMigration = {
  id: 'authoring-schemas-strict-unknown-keys',
  surface:
    'the protocol-17 authoring schemas closed against undeclared keys (#4001) — `automation/` '
    + '(flow and its six nested blocks, control-flow, state-machine, webhook, time-relative '
    + 'trigger, flow function), `security/` (permission sets, RLS policies, sharing rules) and '
    + '`identity/position`, `ui/` (responsive, theme, chart, `AriaProps`, fifteen `view` '
    + 'sub-blocks, `ViewItem`, `userFilters`) — plus the `view` write-path identity precondition '
    + 'one level above them',
  replacement:
    'declared keys only. Each rejection names the surface, echoes the offending key and — where '
    + 'the word is recognisable — gives the canonical spelling, a retired-key tombstone, or a '
    + 'prescription where a rename would be wrong. A `view` body must additionally carry at '
    + 'least one key some union member declares, discounting the identity keys the write path '
    + 'stamps itself (`VIEW_WRITE_PATH_IDENTITY_KEYS`)',
  reason:
    "zod's default `.strip` discarded any key these schemas did not declare and let the parse "
    + 'SUCCEED, so the author — increasingly an AI — got a success envelope and shipped metadata '
    + 'that quietly ignored what they wrote. Closing them turns that into a loud parse error '
    + '(ADR-0049 enforce-or-remove, ADR-0078 no-silently-inert). It is not losslessly '
    + 'convertible for the same reason the two precedent entries at majors 15 and 16 are not: '
    + 'an arbitrary unknown key has no mapping target, and auto-deleting it would be exactly '
    + 'the silent data loss ADR-0078 bans — so each occurrence needs the author to decide, fix '
    + 'the typo, move it to the layer that owns it, or delete dead metadata. The named renames '
    + 'the errors carry are a help, not a transform: a large share of this wave is '
    + 'PRESCRIPTIONS rather than renames precisely because renaming would be wrong '
    + "(`inputSchema.optional` is the opposite polarity of `required`; `errorHandling.maxAttempts` "
    + 'counts the first attempt where `maxRetries` counts the ones after it; a `responsiveStyles` '
    + 'bucket written on `responsive` is a wrong-layer pointer, and the two breakpoint '
    + 'vocabularies sixteen lines apart cannot be bridged by edit distance; `aria.live` is real '
    + 'on exactly one renderer and `ariaLabelledBy` has nothing to rename to; `finally` on '
    + '`try_catch` and `context` on a state machine have no key at all). The eleventh member '
    + 'is not an unknown-key close but the same defect one level up — the `view` union had an '
    + 'arm that both stripped and required nothing, so it matched every object and `saveMetaItem` '
    + 'persisted garbage as an ACTIVE view overlay that read back badged valid. '
    + 'This is ONE entry for the whole major by the ruling on #7630 (2026-08-12), mirroring the '
    + "registry's only two precedents of this shape; the eleven batches it folds are the "
    + 'changesets `unknown-key-strictness-tier-a`, `-step2`, `-automation-batch11`, `-ui-batch13`, '
    + '`-ui-batch15`, `-ui-batch16`, `strict-automation-control-flow-state-machine`, '
    + '`view-subblock-strictness-batch18`, `rare-jars-shave`, '
    + '`user-filters-allow-add-tab-promote-and-close` and `view-union-identity-precondition`, '
    + 'each carrying its own FROM → TO table in `CHANGELOG.md`. ADR-0049 / ADR-0078 / ADR-0087, '
    + '#4001, #5073, #5599 (registered #7630, backfilling #6350).',
  acceptanceCriteria:
    '`objectstack validate` passes with no unknown-key parse errors on any authoring surface — '
    + 'the sweep is "fix until nothing raises", and every rejection carries its own fix. '
    + '⚠️ Parsing clean is the weaker half on three of these faces, because the key was being '
    + 'dropped rather than refused and a config that silently did nothing looked exactly like '
    + 'one that worked: re-check that responsive/theme/chart styling actually renders as '
    + 'authored, that every `aria` block still names the element it was written for, and that '
    + 'each state machine and loop config still carries the transitions and caps you declared. '
    + 'For stored `view` bodies, `GET /api/v1/meta/diagnostics?type=view` lists every overlay '
    + 'the identity precondition now rejects, one row per view with the reason; each is fixed by '
    + 'giving the body a real view shape or deleting an overlay that was never a view.',
};
