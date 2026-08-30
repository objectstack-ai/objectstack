// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'client-meta-reset-result-reset',
  surface:
    'client.meta.deleteItem(...).deleted / .type / .name (the return of '
    + '`client.meta.deleteItem()` and the environment-scoped '
    + '`client.environment(id).meta.deleteItem()`)',
  replacement:
    '`reset` — `r.deleted` → `r.reset`. Same call, same wire body, declared shape. Both '
    + 'twins now declare `DeleteMetaItemResponse` (`@objectstack/spec/api`); `type` and '
    + '`name` have no replacement because the reset door never echoed them — the caller '
    + 'already holds both, it passed them in',
  reason:
    'Both `deleteItem` declarations on `@objectstack/client` declared '
    + '`Promise<{ type: string; name: string; deleted: boolean }>` while '
    + '`DeleteMetaItemResponseSchema` declares `{ success, reset?, message? }`. The '
    + 'declaration was not merely imprecise, it was UNINHABITED: '
    + '`DELETE /meta/:type/:name` ends in `res.json(result)` with `deleteMetaItem`\'s '
    + 'return, and not one of that method\'s four return branches carries `type`, `name` '
    + 'or `deleted`. Both surfaces are pure `unwrapResponse` / `_unwrap` passthroughs — '
    + 'and the reset body carries no `data` key, so nothing is stripped — which makes the '
    + 'declaration a CLAIM about the wire, never a rewrite of it, and the claim was false '
    + 'in the one direction that matters: the compiler endorsed a spelling no server has '
    + 'ever sent. `if (r.deleted)` compiled and read `undefined` on EVERY reset, including '
    + 'the ones that really removed an overlay row; `if (r.reset)` was rejected by the '
    + 'compiler and correct on the wire. So this REVEALS a defect rather than breaking '
    + 'working code — every reader of the old key was already reading `undefined`, on '
    + 'every deployment and not just some. The truthful flag also carries the distinction '
    + 'the phantom one could not express at all: `reset: true` means an overlay row was '
    + 'deleted, `reset: false` means none existed and the item was already at its artifact '
    + 'default. Registered as a semantic entry rather than a mechanical conversion for the '
    + 'reason the rewrite does not capture: a call site that branched on `r.deleted` has '
    + 'been taking the FALSE branch unconditionally since it was written, and whatever '
    + 'that branch did — or skipped — is what has to be re-read. There is no authored '
    + 'source for the chain to rewrite either; this is a published TypeScript surface whose '
    + 'enforced channel is tsc at the call site, and for an untyped JS caller there is no '
    + 'constrained channel at all, which is why this entry is the only notification that '
    + 'reaches them. ⛔ Do not write `r.reset ?? r.deleted`: there is one producer shape, '
    + 'and a consumer accepting two spellings is what contract-first exists to prevent. No '
    + 'deprecated `deleted?: boolean` transition key ships, for the same reason — a '
    + 'transition period is for keys that WORKED, and this one never did. The identical '
    + 'correction one door over is `client-delete-result-success` (#5638); the wire is '
    + 'deliberately untouched here, per the 2026-08-29 ruling that reality is the '
    + 'contract. ADR-0087, #13023.',
  acceptanceCriteria:
    'No code reads `.deleted`, `.type` or `.name` off a `client.meta.deleteItem()` / '
    + '`client.environment(id).meta.deleteItem()` result; `tsc` names every site for a '
    + 'typed caller, and an untyped JS caller must be swept by hand because nothing will '
    + 'report it. Nothing about the request, the route, the status codes or the error '
    + 'shapes changes, and no server needs upgrading — the value you may now read is the '
    + 'one that was already arriving. ⚠️ The real work is behavioural: every '
    + '`if (r.deleted)` has been false since it was written, so re-read what each of those '
    + 'branches was supposed to do. Cache invalidation, registry refreshes and UI reloads '
    + 'guarded that way have never run, and switching to `r.reset` turns them ON for the '
    + 'first time — verify that is what you want rather than assuming it restores prior '
    + 'behaviour. Note `reset` is OPTIONAL in the contract and distinguishes two successful '
    + 'outcomes, so `if (r.reset)` and `if (r.success)` are different questions: the former '
    + 'asks whether a row went away, the latter whether the call was accepted. Any test '
    + 'that passed while asserting on `deleted` was asserting on `undefined` and needs '
    + 'rewriting, not renaming.',
};
