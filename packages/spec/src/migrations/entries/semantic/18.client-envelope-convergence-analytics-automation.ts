// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Anchors for this entry, kept in source rather than in the strings below: the
// entry's prose is projected into `packages/spec/spec-changes.json` and
// `docs/protocol-upgrade-guide.md`, which are read by consumers who cannot
// resolve this repo's internal issue numbers.
//
//   card            objectstack-ai/objectstack#13079
//   landing PR      objectstack-ai/objectstack#14526
//   registration    objectstack-ai/objectstack#14996
//   precedents      objectstack-ai/objectstack#13023 (the two entries this is
//                   shaped on: `client-delete-result-success`,
//                   `client-meta-reset-result-reset`)
//   consumer        objectstack-ai/objectui#7028 (the one measured production
//                   call site, tightened after this lands)
//   census          `packages/client/src/envelope-caller-census.test.ts`
//   contract        `AutomationResult` in
//                   `packages/spec/src/contracts/automation-service.ts`
//                   (`success: boolean`, `error?: string`)

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'client-envelope-convergence-analytics-automation',
  surface:
    'client.analytics.query / client.analytics.meta / client.analytics.explain / '
    + 'client.automation.trigger (the resolved value of four published '
    + '`@objectstack/client` methods — the runtime dispatcher\'s '
    + '`{ success, data }` envelope before, its `data` member after)',
  replacement:
    'the payload — `r.data.X` → `r.X` on all four. `client.analytics.query(q)` now '
    + 'resolves to `AnalyticsResult` (`r.data.rows` → `r.rows`); '
    + '`client.analytics.meta(cube?)` to `AnalyticsMetadataResponse[\'data\']`, the bare '
    + 'cube list (`r.data[0].name` → `r[0].name`); `client.analytics.explain(q)` to '
    + '`AnalyticsSqlResponse[\'data\']`, `{ sql, params }` (`r.data.sql` → `r.sql`); '
    + '`client.automation.trigger(name, payload)` to `AutomationResult` '
    + '(`r.data.status` → `r.status`, `r.data.runId` → `r.runId`) — the same value '
    + '`client.automation.execute` already answered for the same handler. Same call, '
    + 'same wire body, one SDK calling convention',
  reason:
    '`ObjectStackClient` had two response readers. `unwrapResponse` strips the runtime '
    + 'dispatcher\'s `{ success, data }` envelope and hands back `data`; every other '
    + 'dispatcher-served method already used it, and these four alone ended '
    + '`return res.json()`, so their callers alone had to read `.data`. All four now end '
    + '`return this.unwrapResponse(res)` and their return declarations are the payload '
    + 'types. THE WIRE IS BYTE-IDENTICAL: every route answers exactly the body it '
    + 'answered before, no Zod schema moves, no `packages/spec` declaration moves, no '
    + 'authorable key and no stored representation is involved — the landing diff '
    + 'touches no `packages/spec` path at all — so a raw-HTTP caller is unaffected and '
    + '`objectstack migrate meta` has nothing to rewrite. This is registered rather than '
    + 'exempted because the change is NOT wholly compiler-delivered, and the gap is '
    + 'exact rather than theoretical. For the three analytics methods it is: every old '
    + 'read is `error TS2339: Property \'data\' does not exist on type …`, so tsc names '
    + 'each site. `client.automation.trigger` is the exception — `AutomationResult` '
    + 'itself declares `success: boolean` and `error?: string` '
    + '(`AutomationResult` in `packages/spec/src/contracts/automation-service.ts`, '
    + 'byte-identical at the merge base and at this landing), so `r.success` and '
    + '`r.error` COMPILE ON BOTH SIDES while their meaning moves: before, `r.success` '
    + 'was the envelope\'s flag — always `true` on a resolved call — and `r.error` was '
    + 'never set on a 2xx; now they are the run\'s own, and a refusal the door does not '
    + 'classify as 400 / 409 / 422 is answered 200 carrying `success: false` with '
    + '`error` set. A consumer branching on either reads a DIFFERENT QUESTION at the '
    + 'same spelling, with no diagnostic anywhere. And there is no authored source for '
    + 'the conversion chain to rewrite: this is a published TypeScript surface whose '
    + 'enforced channel is tsc at the call site, and for an untyped JS caller there is '
    + 'no constrained channel at all — `.data` simply reads `undefined` — which is why '
    + 'the ledger entry is the only notification that reaches them. That is the same '
    + 'argument the two sibling entries on this package make '
    + '(`client-delete-result-success`, `client-meta-reset-result-reset`), and this one '
    + 'is the stronger case of the three: those corrected declarations that were '
    + 'UNINHABITED, revealing a defect rather than breaking working code, whereas this '
    + 'moves reads that work today. ⛔ Do not write `r.rows ?? r.data.rows`: there is '
    + 'one producer shape, and a consumer accepting two spellings is what contract-first '
    + 'exists to prevent. The failure path is unchanged and deliberately so — '
    + '`ObjectStackClient.fetch` rejects on every non-2xx BEFORE either reader runs, '
    + 'carrying the ADR-0112 error envelope, and `unwrapResponse` itself never throws. '
    + 'ADR-0087 D3.',
  acceptanceCriteria:
    'No code reads `.data` off a `client.analytics.query()`, `client.analytics.meta()`, '
    + '`client.analytics.explain()` or `client.automation.trigger()` result. For the '
    + 'three analytics methods `tsc` names every site for a typed caller (TS2339); an '
    + 'untyped JS caller must be swept by hand for the four spellings, because nothing '
    + 'will report it. ⚠️ `client.automation.trigger` needs the hand sweep even WITH a '
    + 'type-checker: every branch on `r.success` or `r.error` off `trigger` has to be '
    + 're-read one by one, because both compile before and after while their subject '
    + 'moved from the envelope to the run. A branch that treated `r.success` as "the '
    + 'call was accepted" now asks "the run succeeded" — the two differ on exactly the '
    + '200-answered refusals — and a `catch`-only error path now has a resolved '
    + '`success: false` sibling it never had to consider. Nothing about the request, the '
    + 'route, the status codes or the thrown error shapes changes, and no server needs '
    + 'upgrading: the value you may now read is the one that was already arriving, one '
    + 'level in. `client.analytics.queryDataset` is NOT part of this move — it is served '
    + 'with no envelope at all and resolved to the bare payload before and after. '
    + 'Populations: in the ObjectStack repo, zero production call sites and the loud '
    + 'test pins that ship with this change; in objectui, one production row-extraction '
    + 'chain that tolerates both spellings today and is tightened to the post-unwrap '
    + 'spelling once this lands; `objectstack-ai/cloud` is NOT MEASURED — a `.data` read '
    + 'on any of the four there is a runtime break after this change, and this entry is '
    + 'the only notice it gets.',
};
