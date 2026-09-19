// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The action facade's `find` took the `where` HALF of a query while every other
// `find` on the platform took the whole envelope. The rewrite is mechanical and
// lossless, but it lives in an action HANDLER's source — a TypeScript function
// body, not a keyed metadata document — so `objectstack migrate meta` cannot
// reach it and it is a semantic entry rather than a D2 conversion.
export const entry: SemanticMigration = {
  id: 'action-engine-facade-find-query-envelope',
  surface: 'Action handler body — `ctx.engine.find(object, filter)` '
    + '(`ActionEngineFacade.find`, `@objectstack/spec/ui`)',
  replacement: '`ctx.engine.find(object, { where: filter })` — the engine\'s own query envelope '
    + '(`EngineQueryOptions`), the same options bag `IDataEngine.find` takes. The filter moves under '
    + '`where` verbatim: `find(\'task\', { status: \'open\' })` → '
    + '`find(\'task\', { where: { status: \'open\' } })`. An unfiltered `find(object, {})` is unchanged, '
    + 'and the rest of the envelope — `fields`, `orderBy`, `limit`, `offset`, `expand` — becomes '
    + 'reachable from a handler for the first time. A caller-supplied `context` is ignored: the '
    + 'facade is trusted and stamps its own elevated one.',
  reason:
    'The rewrite itself is lossless and mechanical, but it is not automatable here: an action handler '
    + 'is authored TypeScript, and the chain rewrites stored metadata by key, so no `os migrate meta` '
    + 'step can reach a call expression inside a function body. The change is a WITHDRAWAL of the '
    + 'parameter shape #14175 chose, ruled by the director seat (decision batch #123 item 3, '
    + '2026-09-12, 「同意」) on the long-term axis 「one platform, one query shape」. The facade had been '
    + 'given a shape different from the engine\'s — the `where` half alone — which made the most '
    + 'natural spelling the wrong one: an author who passed the engine\'s envelope got '
    + '`{ where: { where: … } }`, matching no row and resolving to `[]` with no error, while an '
    + 'unfiltered `{}` kept working under either belief so a dead handler looked partially alive. The '
    + 'alternative — refusing `where` at the top level with an intersection — was rejected because it '
    + 'asserts a vocabulary fact the spec declares nowhere, reserving the field name `where` across '
    + 'every customer\'s data model to buy one parameter\'s compile-time check.',
  acceptanceCriteria:
    'Every `ctx.engine.find(...)` in the app\'s action handlers passes an envelope, and the package '
    + 'type-checks: a bare filter is now a compile error at the call site — an object literal fails '
    + 'the excess-property check and a `FilterCondition` variable fails TS2559 — so `tsc --noEmit` '
    + 'over the handlers finds every unmigrated call, with no runtime run needed. Then confirm the '
    + 'reads that were already SILENTLY EMPTY: any handler that had been passing the envelope was '
    + 'resolving to `[]` on every call, so a suite written against the mistake passed and the row '
    + 'count is the only witness — re-run each migrated handler against seeded data and assert it now '
    + 'returns the rows its filter selects, rather than asserting it still resolves.',
};
