---
"@objectstack/rest": patch
---

refactor(rest): the history door call site is compiled against the declared contract (#12005)

The `GET /meta/:type/:name/history` door in `packages/rest/src/rest-server.ts`
reached its protocol method through `(p as any)` — once for the
feature-detection guard, once for the call — so the compiler checked nothing
about the request literal it built. The cast was load-bearing on **member
existence** (`historyMetaItem` was undeclared in `packages/spec` entirely —
removing the cast answered `TS2339`), the same half the audit twin's cast
carried before #11678.

With `MetadataProtocol.historyMetaItem` declared (the spec half of this
landing), the guard is now `if (!p.historyMetaItem)` and the request is a named
const typed as `TransportScopedMetaRequest<HistoryMetaItemRequest>` — the
reset-door spelling, not the audit door's plain request type, because this door
still spreads the transport-level `environmentId` (long-standing wire shape,
deliberately unchanged; the #9741 ruling keeps it layered on by the wrapper
rather than becoming a protocol key).

**No behaviour change of any kind, and nothing about the wire moves.** The
outgoing payload is byte-identical (same keys, same conditional spreads, same
`Number.isFinite` drops); the 501 refusal is untouched (its bare-string
envelope remains the #7035-family ratcheted debt it already was — converging it
is a behaviour change this declaration must not smuggle). The guard survives
with identical truthiness semantics: the member is declared **optional** (a
kernel may implement neither door), and the guard is also what narrows it to
callable at the call site. An undeclared key in the literal is now a compile
error instead of a payload member no contract has ever seen.
