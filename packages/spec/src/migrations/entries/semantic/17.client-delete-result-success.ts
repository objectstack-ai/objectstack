// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'client-delete-result-success',
  surface: 'client.DeleteDataResult.deleted (the return of `client.data.delete()`)',
  replacement: '`success` — `r.deleted` → `r.success`. Same call, same wire body, declared name',
  reason:
    '`DeleteDataResult` carried the comment `Spec: DeleteDataResponseSchema` above a '
    + 'declaration that contradicted it: the interface declared `deleted: boolean` while '
    + '`DeleteDataResponseSchema` declares `{ object, id, success }`. `deleted` has never '
    + 'been declared by any schema and no server path has ever returned it on '
    + '`/data/:object/:id`. Both delete surfaces — `client.data.delete()` and the '
    + 'project-scoped `client.project(id).data.delete()` — are pure `unwrapResponse` / '
    + '`_unwrap` passthroughs, so the interface is a CLAIM about the wire, never a rewrite of '
    + 'it, and the claim was false in the one direction that matters: the compiler endorsed '
    + 'the wrong spelling. `if (r.deleted)` compiled, read `undefined` at runtime, and the '
    + 'branch was never taken; `if (r.success)` was rejected by the compiler and correct on '
    + 'the wire. So this rename REVEALS a defect rather than breaking working code — every '
    + 'reader of the old key was already reading `undefined`, on every deployment and not '
    + 'just some, because the protocol path has always answered `success`. It is registered '
    + 'as a semantic entry rather than a mechanical conversion for the reason the rewrite '
    + 'itself does not capture: the key is one token, but a call site that branched on '
    + '`r.deleted` has been taking the FALSE branch unconditionally since it was written, and '
    + 'whatever that branch did — or skipped — is what actually has to be re-read. There is '
    + 'no authored source for the chain to rewrite either; this is a published TypeScript '
    + 'surface whose enforced channel is tsc at the call site, and for an untyped JS caller '
    + 'there is no constrained channel at all, which is why the ledger entry is the only '
    + 'notification that reaches them. ⛔ Do not write `r.success ?? r.deleted`: there is one '
    + 'producer shape, and a consumer accepting two spellings is what contract-first exists '
    + 'to prevent (the same ruling #5581 applied on the producer side). No deprecated '
    + '`deleted?: boolean` transition key ships, for the same reason — a transition period is '
    + 'for keys that WORKED, and this one never did. Registered by the #6350 stock '
    + 'reconciliation. ADR-0087, #5638 (backfilled #6350).',
  acceptanceCriteria:
    'No code reads `.deleted` off a `client.data.delete()` / `client.project(id).data.'
    + 'delete()` result; `tsc` names every site for a typed caller, and an untyped JS caller '
    + 'must be swept by hand because nothing will report it. Nothing about the request, the '
    + 'route, the status codes or the error shapes changes, and no server needs upgrading — '
    + 'the value you may now read is the one that was already arriving. ⚠️ The real work is '
    + 'behavioural: every `if (r.deleted)` has been false since it was written, so re-read '
    + 'what each of those branches was supposed to do. Post-delete cleanup, cache '
    + 'invalidation, audit writes and UI refreshes guarded that way have never run, and '
    + 'switching to `r.success` turns them ON for the first time — verify that is what you '
    + 'want rather than assuming it restores prior behaviour. Any test that passed while '
    + 'asserting on `deleted` was asserting on `undefined` and needs rewriting, not renaming.',
};
