---
'@objectstack/client': minor
'@objectstack/rest': patch
---

`client.meta.getHistory` answers the published `HistoryMetaItemResponse` on **both** of its exits, and the route ledger names the schema.

**BREAKING (types):** the unscoped `client.meta.getHistory` declared a hand-written inline shape whose `actor` member was `string`. The door answers `null` there for every system-initiated write — boot sync, migration, a scheduled job — and the published schema declares it "never a sentinel string", so consumers that resolve the actor against `sys_user` must be able to tell "nobody" from "a user id". Reading `actor` without a null check compiled against a promise the door has never made; it no longer compiles. The same rebind closes the vocabulary of `op` (the ADR-0008 §2.4 change-log verbs, previously a plain `string`).

Three members the inline shape omitted become reachable in the same move: `version` (the per-`(org,type,name)` lineage counter that `rollbackItem({ toVersion })` pins against), `previousName` (set on `op: "rename"`), and `ref.version`. `ref.org` was declared optional and is now what the producer always writes.

The scoped twin — `client.environments.use(id).meta.getHistory` — carried no declaration at all: no return annotation, and the SDK's internal unwrap called with no type argument, so the published method resolved to `Promise<unknown>` and every caller had to narrow by hand against nothing. It is the SAME mount as the unscoped exit, replayed against `/environments/:environmentId`, so it answers a byte-identical body; the two now name one type. Binding only one exit would have relocated that divergence rather than removed it, and the equality of the two declared types is pinned rather than left to review.

`@objectstack/rest` is `patch`: the route-ledger row for `GET /api/v1/meta/:type/:name/history` now names `HistoryMetaItemResponseSchema`. Data only, in a package-internal module — no route, handler or emitted byte changes. The row could not name the schema before because the declaration (#12005) landed after the row was written.

No wire byte moves anywhere in this change. `HistoryMetaItemResponseSchema` is a describe-only transcription of what `historyMetaItem` already returned, and the SDK's runtime path is untouched — only what the compiler knows about it.

<!-- adr-0087: not-required (no-migration-prescription) Nothing here is reachable by `objectstack migrate meta`: no spec property, metadata key, accepted value or exported symbol is retired, `packages/spec` is not touched at all, and no stored metadata changes shape. The affected party is a TypeScript consumer and the delivery channel is the compiler at their own call site; the remedy is a null check on `actor`, which is application code rather than a metadata migration. `type-surface-only` is deliberately NOT claimed: its predicate 4 admits a narrowing that starts from `any`, `unknown` or no annotation, and while the scoped exit is exactly that case, the unscoped exit starts from a CONCRETE inline object type whose members change — the case that category's header names as outside its class. -->
