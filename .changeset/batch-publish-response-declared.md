---
"@objectstack/spec": minor
"@objectstack/client": minor
"@objectstack/runtime": patch
---

The batch publish response is declared (#9406). `POST /packages/:id/publish-drafts` (Studio's "publish whole app") now has a spec contract behind it: `PublishPackageDraftsResponseSchema` in `@objectstack/spec/api` declares the full wire payload — `success` / `publishedCount` / `failedCount` / `published[]` (each element with its ADR-0008 `version` OCC token and the optional omitted-when-empty `advisories` from #9343) / `failed[]` / `seedApplied` / `materializeApplied` / `commitId`, plus the REST door's own receipts (`unhiddenApps` / `unhideError` / `rebindError`) — the #5745/#7294 "declared = returned" discipline carried to the batch door, with the two pin suites mirroring the single door's pair (spec-side declaration pins plus producer- and route-side conformance gates). `probes` is deliberately opaque in the declaration per the #9406 ruling: the key is declared and carried through verbatim, but its inner `BuildProbeReport` shape is staged until a consumer needs a field of it. `@objectstack/client`'s `packages.publishDrafts` now resolves `PublishPackageDraftsResponse` instead of `any`, and the runtime route ledger names the schema. Additive declaration of an existing wire face — no response bytes change.
