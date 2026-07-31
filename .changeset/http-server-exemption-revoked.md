---
"@objectstack/metadata": patch
---

fix(lint,metadata): revoke the `http.server` lint exemption — its stated reason was false (#4251)

`http.server` was added to `UNCONTRACTED_SLOTS` in #4321 on the ground that
"no IHttpServer contract exists". The contract does exist —
`packages/spec/src/contracts/http-server.ts` — and eight call sites were
already resolving the slot as `getService<IHttpServer>(…)` when the exemption
was written. An exemption is a claim like any other, and this one rested on a
premise nobody checked: the same shape as the gaps the rule exists to find.

Revoked. That surfaced **9 erasures the exemption had been hiding** — 7 in
files never grandfathered, 2 as count growth inside grandfathered ones, none of
which the baseline could legally absorb. All typed to `IHttpServer`;
`packages/metadata/src/plugin.ts` came out clean entirely, so the baseline
ratchets **DOWN to 168 sites in 36 files** and loses a file.

Two things confirmed on the way, reported rather than changed:

**`http.server` and `http-server` are the same instance under two names.**
plugin-hono-server and qa's node-plugin each register it twice, two lines
apart; runtime's `config.server` path registers only `http.server`.
`metadata/src/plugin.ts` reads both with a `??`, which is how it survived. No
registration is removed here — that is a runtime-behaviour change and belongs
with whoever picks the canonical name.

**`IHttpServer` is defined twice and the two have already diverged.**
`packages/spec/src/contracts/http-server.ts` (15 importers) declares `write?()`
and `end?()`; `packages/core/src/contracts/http-server.ts` (8 importers) does
not. Spec's is the superset and the one the ledger points at, so it is the
source; core's is a stale near-copy and should re-export it. Left for its own
change — collapsing a duplicated contract is not a lint fix.

Also worth a note for whoever writes the wider HTTP contract: `getRawApp()` now
has a **third** independent consumer (metadata's HMR routes, joining
cloud-connection's two). It is deliberately absent from `IHttpServer` — the
contract is framework-agnostic and the raw app is the framework's own handle —
so each consumer names it locally. Three is enough evidence to decide whether
that stays the right answer.
