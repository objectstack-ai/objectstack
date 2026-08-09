---
'@objectstack/spec': major
'@objectstack/metadata-protocol': major
'@objectstack/objectql': major
---

refactor(spec)!: `api` is code-only — withdraw a runtime create door the endpoint matcher could never read (#5488, ADR-0049 remove side)

<!-- adr-0087: registered api-runtime-create-withdrawn -->

**FROM → TO:** `PUT /api/v1/meta/api/{name}` (200 "Saved") → declare the endpoint as a
stack artifact (`**/*.api.ts`, or `defineStack({ apis })`) and ship it through
`publishPackage`. The runtime write now answers **403 `NOT_CREATABLE`**, in `?mode=draft`
as well as direct-active. The artifact route is **unchanged** — a `**/*.api.ts` file valid
before this release is valid after it, byte for byte.

`DEFAULT_METADATA_TYPE_REGISTRY`'s `api` entry declared `allowRuntimeCreate: true` and the
runtime never honoured it. Measured on a real showcase boot (`objectstack dev --fresh`, 47
plugins):

```
PUT /api/v1/meta/api/e8_backdoor   → 200 {"success":true,…,"message":"Saved …"}
GET /api/v1/apps/showcase/backdoor → 404      (anonymous AND authenticated)
```

…and **no** `[EndpointMatcher] … EXCLUDED` line anywhere in the boot log: the endpoint was
not gated out, it was never in the index at all. The serving criterion belongs to
`IMetadataService.matchEndpoint` → `EndpointMatcher` → `MetadataManager.listForIndex('api')`,
which reads the manager's own registry plus its registered loaders
(`["filesystem","memory"]` on dev/serve). A runtime write lands in `sys_metadata`, which is
in neither. So the declaration promised a capability that could not exist.

A declared-but-unhonoured capability is ADR-0049 false compliance, and "answers Saved, then
404s forever" is its most dangerous shape for the AI authors ADR-0033 targets. The
maintainer ruled REMOVE on 2026-08-07 rather than converge the read path: making the matcher
read `sys_metadata` re-opens cache, invalidation, tenancy and the ADR-0110 D3
miss-vs-outage distinction on a new read path, and there is no business pull for
Studio-authored endpoints today — 17.x serves declarative endpoints through stack artifacts,
which is what showcase uses (#5040 E8, LIVE).

## The retirement kit

- **`allowRuntimeCreate: false`** on the `api` registry entry. With `allowOrgOverride`
  already `false`, the type is now **code-only** — the `job` / `agent` / `capability` shape —
  so the existing #5086 inlet refuses before persistence, on every kernel, with
  `code: 'NOT_CREATABLE'`, `status: 403` and a prescription derived from the entry's own
  `filePatterns[0]`. No new refusal mechanism was written for this.
- **`gateApiDraftsForPublish` is retired** (`metadata-protocol`), together with its nine
  tests and the `PUBLISH_DRAFTS_NAMESPACE_REMEDY` string only it appended. It landed two
  days earlier in PR #5279 and is removed **deliberately and on the record**, not lost in a
  refactor: it gated a draft→active promotion into a state the matcher can never read, and
  with the inlet closed no `api` draft can exist for it to judge. The in-place comment at
  its old call site carries the reasoning.
- **The `metadata-plugin.zod.ts` decision block is rewritten as a recorded overturn.** It
  used to record CODE-ONLY as "considered and rejected"; its three bullets are kept verbatim
  with what became of each, so the reversal is auditable rather than silently contradicted.
- **The `api` create seed is removed** and `api` joins `KNOWN_UNSEEDED`. A pre-filled "New
  API Endpoint" form whose save can only 403 is the UI half of the same false compliance.
- **Pins, not deletions.** The two #5271 tripwire pins that asserted
  `allowRuntimeCreate: true` are **replaced** by retirement pins asserting the new verdict —
  their comments predicted this exact consequence, and both predictions were correct. Every
  rejection case asserts `code` **and** `status` (ADR-0112 envelope), never `toThrow()`
  alone (#6142).

## What did NOT change

`validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure` remain the one judge
of what is servable, on the route that serves: the stack schema, `publishPackage` (#5189),
and again at load in `buildEndpointIndex` (PR #5203). ADR-0121's "publish REJECTS" ruling is
intact. `deleteMetaItem` stays ungated so pre-existing rows can be cleaned up, and
`OS_METADATA_WRITABLE=api` remains the single operator escape hatch — note it unlocks the
**write** only; the endpoint still will not be served, which is why it is a diagnostic
rather than a workaround.

**Re-entry path**, recorded by the ruling: if #2657 Part B promotes `apis` to a registered
type **with a real consumption path**, the flag and the publish gate come back together —
implementation first, declaration second.
