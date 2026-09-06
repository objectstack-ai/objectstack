// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Anchors for this entry, kept in source rather than in the strings below: the
// entry's prose is projected into `packages/spec/spec-changes.json` and
// `docs/protocol-upgrade-guide.md`, which are read by consumers who cannot
// resolve this repo's internal issue numbers.
//
//   card            objectstack-ai/objectstack#15451
//   landing PR      objectstack-ai/objectstack#15675
//   disposition     objectstack-ai/objectstack#15674 (ruled D, 2026-09-05: this
//                   class routes through ADR-0087 `registered`)
//   precedents      objectstack-ai/objectstack#13023, #13079 (the three sibling
//                   entries this is shaped on: `client-delete-result-success`,
//                   `client-meta-reset-result-reset`,
//                   `client-envelope-convergence-analytics-automation`)
//   family          objectstack-ai/objectstack#14312 (the `oauth.*` binding card
//                   whose ruling fenced this method out, PR #15445)
//   pins            `packages/client/src/oauth-applications-delete.test.ts`,
//                   `packages/client/src/return-type-precision.test.ts`
//   vendor          `StrictEndpoint<'/oauth2/delete-client', ..., void>` in
//                   `@better-auth/oauth-provider`

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'client-oauth-applications-delete-void',
  surface:
    'client.oauth.applications.delete(clientId) — both halves of what a caller of this '
    + 'published `@objectstack/client` method observes: the DECLARED return, '
    + '`Promise<any>` before and `Promise<void>` after, and the SETTLE BEHAVIOUR, which '
    + 'rejected with `SyntaxError: Unexpected end of JSON input` on every successful '
    + 'delete before and resolves after',
  replacement:
    'no value — `void`. There is nothing to move a read TO, because the promise never '
    + 'resolved for a caller to read anything off it. The migration is on the settle '
    + 'path instead: `try { await client.oauth.applications.delete(id); } catch { '
    + '/* it probably worked */ }` → drop the workaround, the `catch` was executing on '
    + 'EVERY successful delete and now executes only on a real failure. A read off the '
    + 'resolved value — `(await client.oauth.applications.delete(id)).deleted` — was '
    + 'unreachable code that has never executed and now stops compiling (TS2339). Same '
    + 'call, same request, same wire body',
  reason:
    'The route answers HTTP 200 with a ZERO-BYTE body: `POST {auth}/oauth2/delete-client` '
    + 'returns nothing from its handler, the vendor declares the endpoint `void`, and the '
    + 'response carries `content-type: application/json` with NO `content-length` header '
    + 'at all. The method ended `return res.json()`, so it rejected `SyntaxError: '
    + 'Unexpected end of JSON input` on every successful delete — after the row had '
    + 'already been removed server-side. There was no success path a caller could '
    + 'observe, and the obvious recovery made it worse: the retry failed DIFFERENTLY, '
    + 'with the route\'s 404 `not_found`, because the client was already gone. The method '
    + 'now reads the body as text, returns on the empty case, and still parses (and still '
    + 'throws on) a non-empty one — so the ONLY behaviour that moved is the zero-byte '
    + 'case, which is the defect itself. THE WIRE IS BYTE-IDENTICAL: same route, same '
    + 'request body, same status codes, same ADR-0112 error envelope; no Zod schema and '
    + 'no `packages/spec` declaration moves, no authorable key and no stored '
    + 'representation is involved, so a raw-HTTP caller is unaffected and '
    + '`objectstack migrate meta` has nothing to rewrite. This is registered rather than '
    + 'exempted because the change is NOT compiler-delivered where it matters, and the '
    + 'gap is exact rather than theoretical. The change has two halves and only one of '
    + 'them has a diagnostic. (1) The declared return moves from a ledgered `any` to '
    + '`void`, so a typed caller that read a property off the resolved value now gets '
    + '`error TS2339` — but that read was UNREACHABLE, since the promise never resolved, '
    + 'so the compiler names only code that has never run. (2) The half that DID run on '
    + 'every call — a `try`/`catch` wrapped around the delete — compiles identically '
    + 'before and after, with no diagnostic anywhere, while its `catch` block stops '
    + 'executing. So for the only behaviour that was ever observable, `tsc` names ZERO '
    + 'sites; and for an untyped JS caller there is no constrained channel at all. That '
    + 'is why the ledger entry is the only notification that reaches an upgrader — the '
    + 'same argument the three sibling entries on this package make '
    + '(`client-delete-result-success`, `client-meta-reset-result-reset`, '
    + '`client-envelope-convergence-analytics-automation`). ⚠️ Note the DIRECTION, which '
    + 'is the inverse of the usual break: this does not stop working code from working, '
    + 'it makes a method that could never succeed succeed. The hazard is therefore '
    + 'inverted too — code written to survive a permanent failure is now inert, and any '
    + 'alerting or error budget fed by this method\'s rejections goes quiet. ⛔ Do not '
    + 'keep the old behaviour behind a flag or a wrapper that re-throws: there is one '
    + 'producer shape, and the rejection was never a contract, it was a parse of an empty '
    + 'string. ⛔ Do not synthesise `{ deleted: true }` either: the 200 carries zero bytes '
    + 'and therefore zero information, and "it was already gone" is distinguished on the '
    + 'ERROR channel — a client that is not there answers 404 `{ error: \'not_found\' }`, '
    + 'which `ObjectStackClient.fetch` raises as a throw before the body reader runs — so '
    + 'a synthesised success value would be a shape the wire never sends and strictly '
    + 'less informative than the 404 the caller already receives. ADR-0087 D3.',
  acceptanceCriteria:
    '⚠️ The real work is behavioural and NOTHING will report it: every `try`/`catch` '
    + 'wrapped around `client.oauth.applications.delete()` has to be re-read one by one, '
    + 'because it compiles identically before and after while its `catch` block goes from '
    + 'running on every successful delete to running only on a real failure. Anything '
    + 'that block did — treating the delete as failed, retrying it (the retry answered '
    + '404 `not_found`, which may itself have been swallowed), skipping post-delete '
    + 'cleanup, cache invalidation, audit writes or a UI refresh, or reporting the delete '
    + 'to a user as failed — is now on the other branch, and the cleanup paths that were '
    + 'skipped run for the first time. Verify that is what you want rather than assuming '
    + 'it restores prior behaviour. Alerting, error budgets and dashboards fed by '
    + '`SyntaxError` rejections from this method drop to zero: that is the fix landing, '
    + 'not an outage. Any test that passed while asserting this call rejects on a '
    + 'successful delete was asserting on the defect and needs rewriting, not renaming. '
    + 'On the type side, no code reads a property off the resolved value; `tsc` names '
    + 'those sites for a typed caller (TS2339), but every one of them was unreachable, so '
    + 'a clean type-check is NOT evidence that the sweep above was done. An untyped JS '
    + 'caller gets no report at all. Nothing about the request, the route, the status '
    + 'codes or the thrown error shapes changes and no server needs upgrading — the '
    + 'server has always answered this way; only the client stopped mis-reading it. '
    + 'Populations, measured at this landing: in the ObjectStack repo, ZERO production '
    + 'call sites — the only references are the pins that ship with this change '
    + '(`oauth-applications-delete.test.ts`, `return-type-precision.test.ts`); in '
    + 'objectui at the pinned `.objectui-sha`, ZERO — neither `oauth.applications` nor '
    + '`delete-client` appears anywhere in that tree; `objectstack-ai/cloud` is NOT '
    + 'MEASURED, and a `catch` there that swallowed this method\'s rejection is now dead '
    + 'code that this entry is the only notice of.',
};
