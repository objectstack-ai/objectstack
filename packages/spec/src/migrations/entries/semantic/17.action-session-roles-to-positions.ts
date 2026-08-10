// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'action-session-roles-to-positions',
  surface: 'ui.actionSession.roles',
  replacement: 'ui.actionSession.positions (an action body reads `ctx.session.positions`)',
  reason:
    'The MIRROR-IMAGE sibling of `actor-user-roles-to-positions`, and the reason both are in this '
    + 'step: the hook `ctx.session` carried `roles` declared-and-never-produced (removed '
    + 'outright, #5050), while the ACTION body\'s `ctx.session` carries it '
    + 'produced-and-really-populated. `buildActionSession()` '
    + '(`packages/runtime/src/action-execution.ts`) copies `ExecutionContext.positions` '
    + 'into a key spelled `roles` — the ADR-0090 D3 vocabulary handed to the author under '
    + 'the one spelling that ADR bans — so a body author met two different answers to one '
    + 'key name on one platform: rejected in a hook, live and full of values in an action. '
    + '#5613 ruled contract-first (maintainer, 2026-08-06: "C skeleton + A semantics"): '
    + 'phase 1 (#5697) declared the previously undeclared shape as `ActionSessionSchema`, '
    + 'and phase 2 renames the key. `positions` is now the canonical key on that schema '
    + 'and `roles` a deprecated alias of it (#5779); the producer emits both for one '
    + 'deprecation window (#5613 runtime half), after which `roles` is removed on the path '
    + 'the v11 session-alias removal already walked (#3280 deprecated → #3290 removed). '
    + 'Why this is a D3 semantic TODO and not a D2 conversion, on two independent grounds: '
    + 'FIRST, there is no source to convert — an action `ctx.session` is constructed per '
    + 'dispatch and never persisted, so no `sys_metadata` row, example or template can '
    + 'carry the key — the `openApi31` (#4579) / `activationEvents` (#4657) / '
    + '`hook-context-session-roles-retired` (#5050) shape. SECOND, the only place the key '
    + 'is ever SPELLED is inside an action body: author-written JS/TS, or a sandboxed '
    + 'script whose `ScriptContext.session` is still `unknown`. A declarative transform '
    + 'cannot safely rewrite an identifier inside free-form code — exactly the reason the '
    + 'ADR-0090 wave delegated `current_user.roles` to the author at step 13 '
    + '(`cel-current-user-roles-to-positions`) instead of substituting text. '
    + 'Note what is deliberately NOT done here: the alias is not tombstoned. A '
    + '`retiredKey()` REJECTS the key, and a deprecation window exists precisely so the '
    + 'old spelling keeps working while its readers move — tombstoning during the window '
    + 'would be the removal it is meant to defer. The tombstone (or the plain deletion the '
    + 'authorable-surface ratchet adjudicates) belongs to the release that closes the '
    + 'window. Until then this entry IS the channel: `spec-changes.json` and the generated '
    + 'upgrade guide are how a reader learns the rename before the removal reaches them. '
    + 'ADR-0090 D3, ADR-0087, #5613 / #5779.',
  acceptanceCriteria:
    'No action body reads `ctx.session.roles`; every such read is `ctx.session.positions` '
    + 'and observes the same array (the rename is a rename — the VALUE is '
    + '`ExecutionContext.positions` on both sides, which the runtime pin '
    + '`action-session-shape-contract.test.ts` asserts independently of the key name). '
    + 'Privilege is NOT re-derived from either spelling: a read that was '
    + '`roles.includes(\'admin\')` as an access check is rewritten to ask the security '
    + 'service (capability grants / placements / derived posture, ADR-0095), never '
    + 'renamed to `positions.includes(\'admin\')` — renaming that read migrates the defect '
    + 'rather than the code. Verify against a real dispatch, not a fixture: invoke an '
    + 'action as a caller holding positions and assert the body observed them under the '
    + 'canonical key. During the window both keys are present and equal, so a reader can '
    + 'be migrated and verified before the alias is removed; after it, `roles` is absent '
    + 'and a body still reading it sees `undefined` — which is why the read must be moved '
    + 'inside the window rather than at its close.',
};
