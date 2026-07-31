---
"@objectstack/spec": patch
"@objectstack/core": patch
"@objectstack/cloud-connection": patch
"@objectstack/metadata": patch
"@objectstack/plugin-hono-server": patch
---

fix(spec,core,cloud-connection,metadata): one HTTP contract, one canonical slot name — and the dead shadow copy that helped cause the false exemption is deleted (#4251)

**`packages/core/src/contracts/` was a dead near-copy of the real contracts,
and it is gone.** The directory (http-server.ts, data-engine.ts, logger.ts) had
ZERO importers — no relative import, no subpath export, not a tsup entry;
core's barrel has re-exported the `@objectstack/spec/contracts` versions all
along ("Re-export contracts from @objectstack/spec for backward
compatibility"). But the shadow had already **diverged** from the live
contract (spec's `IHttpResponse` grew `write?`/`end?` and `IHttpRequest` grew
`rawBody?`; the copy never did), so anyone who grepped their way into it read a
stale contract that nothing enforces — the exact both-humans-and-AI failure
mode behind the false `http.server` exemption (#4382). Deleting it is
zero-risk by construction: nothing could reach it.

**`http.server` is the canonical slot name, and the ledger now says so.**
`ServiceSlotContracts` gains `'http.server': IHttpServer` plus the deprecated
`'http-server'` alias entry (same instance — hono-plugin and qa's node-plugin
register both two lines apart; cloud's two server entrypoints do the same).
Canonical is the only name present on EVERY provider path: runtime's
`config.server` path registers no alias, so the three cloud-connection plugins
that read the alias alone (marketplace-proxy, runtime-config,
marketplace-install-local) found an empty slot there — a live miss, now fixed:
all readers go canonical-first with the alias as a fallback that dies with the
alias registrations. The registrations themselves are untouched this release;
both sites now carry the deprecation note.

**`getRawApp?(): any` joins `IHttpServer`** — the deliberate framework-handle
escape, declared once. Four consumers were each declaring it locally
(cloud-connection ×2, metadata's HMR routes, cloud's serverless node-server);
those local `RawAppHost`/`HttpServerWithRawApp` types are deleted. The `any`
return is deliberate and documented at the single declaration: the handle's
real type belongs to the framework, and naming it would give the contract a
framework dependency. Adapters are not required to expose it; consumers
feature-detect.

**`IMetadataService.bulkRegister`/`bulkUnregister` declare the write options
their implementation has always accepted.** `bulkRegister`'s contract options
dropped the `MetadataWriteOptions` half its implementation intersects in
(`notify` is destructured on the method's first line); `bulkUnregister`
declared no options at all while the manager takes them. Same shape as the
`IDataEngine` read-methods gap from B2: a caller typed to the contract could
not reach the channel without erasing the lookup. Both additive; no implementor
or caller breaks.

Slot-lookup baseline ratchets 168 → 167 (marketplace-install-local's lookup
typed while touched).
