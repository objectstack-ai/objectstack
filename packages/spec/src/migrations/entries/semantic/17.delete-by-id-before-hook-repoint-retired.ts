// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'delete-by-id-before-hook-repoint-retired',
  surface:
    'a `beforeDelete` handler on a BY-ID `delete()` assigning `ctx.input.id` a DIFFERENT id, '
    + 'to move the delete onto that row',
  replacement:
    'delete the other row explicitly — `ctx.ql.delete(object, otherId)` / `ctx.api` — and let '
    + 'the addressed delete proceed or `throw` from the handler to stop it; to delete MANY rows, '
    + "have the CALLER pass `{ multi: true, where: … }`. Writing the SAME id back is unaffected "
    + 'and stays legal.',
  reason:
    'The by-id target of an `update()` or `delete()` is now IMMUTABLE inside a `before*` '
    + 'handler, on both verbs, cleared or rebound. `delete()` was the last cell of that table '
    + 'still answering differently: it HONOURED a repoint, re-resolving the new target by '
    + "re-reading its pre-image and rebinding `previous` (#5272), so `afterDelete` and the "
    + 'roll-up recompute saw the row actually deleted. It now refuses with '
    + '`HookTargetRebindError` / `ERR_HOOK_TARGET_REBIND`, `path: \'by-id\'`, exactly as the '
    + '`update()` twin and both per-row paths (ADR-0058 Amendment II.1 / D4) already did.\n\n'
    + 'Read this as a RULING, not a defect report — that distinction is the reason the entry '
    + 'is worth its length. #5272\'s re-resolution was internally CORRECT and nothing stale '
    + 'ever leaked from it; the case that retires a rebind on `update()` (the write landing on '
    + 'a row whose pre-image, `readonlyWhen` locks and validation rules were never evaluated) '
    + 'simply did not apply to it. #5574\'s engine half (PR #6697) therefore left the asymmetry '
    + 'standing on purpose rather than folding a behaviour removal into an ordering change, and '
    + 'filed it as #6752. The 2026-08-09 maintainer ruling on that card closed it on three '
    + 'measured axes instead: compatibility cost zero (a repository-wide grep for assignments '
    + "into a hook's `input.id`, re-run on the implementing PR's base, found six sites and ALL "
    + 'SIX are this family\'s own pins — no consumer anywhere repoints); one rule across both '
    + 'verbs beats two individually-correct rules an author has to memorize, since the '
    + 'justification for the split lived in an ADR rather than at the call site; and "a hook '
    + 'silently redirects which row gets deleted" is a top-grade footgun for authored — '
    + 'especially AI-authored — handlers however correctly the redirect is implemented. '
    + 'Correctness of a mechanism does not justify the surface it exposes. Aligning the other '
    + 'way, by building `update()` the same re-resolution, stays excluded by #5574\'s own '
    + 'recorded ruling ("do not silently pick re-resolution instead").\n\n'
    + 'Why this is a D3 semantic TODO and not a D2 conversion, on the same two grounds as '
    + '`hook-register-empty-object-target-refused` and `hook-context-session-roles-retired` at '
    + 'this step: FIRST, there is no source to convert — a `HookContext` is constructed per '
    + 'write and never persisted, so no `sys_metadata` row, example or template can carry the '
    + 'assignment. SECOND, the only place it is ever SPELLED is inside a handler body: '
    + 'author-written JS/TS, or a sandboxed script whose context is `unknown`. A declarative '
    + 'transform cannot safely rewrite an assignment inside free-form code, and the intent is '
    + 'not recoverable anyway — only the author knows whether the repoint meant "delete that '
    + 'row INSTEAD" or "delete that row TOO".\n\n'
    + 'What makes this one cheaper to meet than its two siblings, and worth saying because it '
    + 'bounds the work: the removed capability has an ENFORCED channel at run time. The refusal '
    + 'throws before anything is written and its message NAMES the retired capability and the '
    + 'three replacement routes, so a handler that still repoints fails loudly and self-'
    + 'describingly on its first execution rather than going quiet. This ledger entry is the '
    + 'channel that reaches an upgrader BEFORE that first execution. #6752, #5272, #5574, '
    + 'PR #6697, ADR-0058 Amendment II.2.',
  acceptanceCriteria:
    'No `beforeDelete` handler assigns `ctx.input.id` anything but the id it arrived with — '
    + 'grep handler bodies for assignments into `input.id` and rewrite each into an explicit '
    + '`ctx.ql.delete()` for the other row, a caller-side `{ multi: true, where: … }`, or a '
    + '`throw`. A delete-heavy smoke run completes with no `HookTargetRebindError` '
    + "(`ERR_HOOK_TARGET_REBIND`, `path: 'by-id'`, `event: 'beforeDelete'`) — and any that does "
    + 'raise names its `expectedId` and `observedId`, which identifies the handler that moved '
    + 'the target.',
};
