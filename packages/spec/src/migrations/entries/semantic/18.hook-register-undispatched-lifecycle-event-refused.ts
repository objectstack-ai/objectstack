// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'hook-register-undispatched-lifecycle-event-refused',
  surface:
    "engine.registerHook('beforeFindOne' | 'afterFindOne' | 'beforeCount' | 'afterCount' | "
    + "'beforeAggregate' | 'afterAggregate', handler)",
  replacement:
    "for the findOne pair, register on 'beforeFind' / 'afterFind' — they already fire for "
    + "`findOne`; for the count and aggregate pairs there is no hook seam at all, so move the "
    + 'logic to `engine.registerMiddleware(fn)` and read '
    + "`ctx.operation === 'count' | 'aggregate'`, composing the predicate onto `ctx.ast.where`",
  reason:
    '`registerHook` took `event: string` and, for a name outside the dispatched set, warned and '
    + 'then REGISTERED the handler anyway. Six of those names are inside the engine\'s own '
    + "lifecycle namespace — (`before`|`after`) x `OperationContext['operation']` minus the eight "
    + 'the engine dispatches — so an author writing one of them believes they are subscribing to '
    + 'an engine lifecycle event, and what they get back is an inert declaration: ADR-0078\'s '
    + 'prohibited fourth state (parsed, unmarked, silently inert) on an authorable seam.\n\n'
    + 'The measured consequence is a data-visibility one, which is why this is not a cosmetic '
    + 'warning. A downstream consumer registered READ FILTERS on `beforeFindOne` and '
    + '`beforeCount`, expecting them to scope single-record reads and list totals; they sat inert '
    + 'through every boot behind about forty warning lines. `findOne` was still filtered — '
    + '`beforeFind` covers it — so the mistake gave no signal there. `count` was not: a `limit`ed '
    + 'list answered a `total` counting rows the caller could not see. `aggregate` was not '
    + 'either: a `groupBy` was not narrowed at all. A filter that was supposed to narrow '
    + 'visibility and silently did not run is a guardrail the author believes they armed.\n\n'
    + 'Refused at REGISTRATION rather than repaired on the dispatch side. Making `count()` and '
    + '`aggregate()` dispatch hooks would widen what a hook may intercept — a different and much '
    + 'larger decision — and it would also be the wrong seam: read authorization and row '
    + 'filtering are the middleware chain\'s job, which is what `HookEvent` in `@objectstack/spec` '
    + 'already says and what `count()` already honours (its AST rides the operation context '
    + 'precisely so the security and sharing middlewares can scope it). The refusal names the '
    + 'per-seam repair in its own message, because "this never fires" alone cannot tell the two '
    + 'seams apart: one is a rename, the other is a different API.\n\n'
    + 'The refusal is scoped to those six names, not to everything outside the dispatched set. '
    + '`triggerHooks` is public, so a plugin dispatching its own event under a name outside the '
    + "engine's vocabulary (`'myPlugin:flush'`) is a legitimate reading — that is why #3195 made "
    + 'this branch a warn — and it still warns and still registers. The population is DERIVED '
    + 'from the operation union rather than typed out, so a new engine verb widens it without an '
    + 'edit; a hand-written list of refused names would be this same defect one layer up.\n\n'
    + 'This is a RUNTIME registration API, not stored metadata, so — like '
    + '`hook-register-empty-object-target-refused` at the previous step — there is no '
    + '`sys_metadata` row for the D2 chain to rewrite, and the ledger entry is the notification '
    + 'channel. The metadata door was never open on this axis: `HookSchema.events` is '
    + '`z.array(HookEvent)`, and `HookEvent` enumerates exactly the eight dispatched names, so no '
    + 'authored or stored hook could ever carry one of the six. The exposure was entirely on the '
    + 'code door. #17713, #3195, ADR-0078.',
  acceptanceCriteria:
    'No `registerHook` call site passes `beforeFindOne`, `afterFindOne`, `beforeCount`, '
    + '`afterCount`, `beforeAggregate` or `afterAggregate`. Every read filter that was written '
    + 'against one of those names has been moved: the findOne pair to `beforeFind` / `afterFind`, '
    + 'the count and aggregate pairs to a middleware registered with '
    + '`engine.registerMiddleware`. Boot completes with no '
    + '"[ObjectQL] Hook \'...\' is an engine lifecycle event name the engine never dispatches" '
    + 'throw, and any list `total` or `groupBy` that was expected to be scoped is scoped by a '
    + 'middleware rather than by a hook.',
};
