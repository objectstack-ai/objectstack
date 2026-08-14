---
"@objectstack/runtime": patch
---

fix(runtime): the HTTP MCP prompt bridge reads the merged skill listing, so a runtime meta PUT finally reaches `/api/v1/mcp` (#8726)

<!-- adr-0087: not-required (no-migration-prescription) One consumer moves up a
layer — from `IMetadataService.list('skill')` to the protocol's `getMetaItems`.
No authorable key is added, renamed, retired or tombstoned, and no stored shape
changes, so there is no conversion to register. -->

`PUT /api/v1/meta/skill/{name}` with `{active:true}` returned 200 and the flip
was **not** reflected over MCP prompts. This is the second of the two skill
reads behind that symptom, and the one #8328's own three-step reproduction
actually runs through.

The two surfaces read different layers:

- **stdio** (long-lived server, `packages/mcp` → `bridgePrompts`) — fixed by
  PR #8724.
- **HTTP** `/api/v1/mcp`, built **per request** by `packages/runtime`
  (`domains/mcp.ts` → `buildMcpBridge.listSkills`) — this change. It read
  `metadataService.list('skill')`, the registry/loader listing, one layer
  **below** where any `sys_metadata` overlay merging happens. So the overlay row
  the PUT wrote was never seen, while `GET /api/v1/meta/skill` served it
  correctly from the merged read: two surfaces, one skill name, two answers.

The read now goes through the protocol layer's `getMetaItems`, per the
maintainer's ruling on #8328 (2026-08-13, option 3) — and ⛔ **not** by pushing
the overlay merge down into `MetadataService.list()` for every consumer, which
is a wider contract change archived unscheduled as #8722.

**Resolved per request, on the same per-environment seam `getMeta()` already
uses** — never captured once at boot, which on a multi-tenant host would serve
one environment's overlay rows to every other one. Pinned by two
multi-environment tests.

**⛔ No fallback to the un-merged listing when the merged read throws.** That
would answer registry rows in the shape of merged ones — this exact defect,
restored silently at the moment the overlay store is unreadable, which is
precisely when an overlay is most likely to be the thing being missed. The
throw travels to the MCP client instead. Structural absence is treated as the
different thing it is: a host assembled without the metadata protocol has no
merged read to offer, so it keeps the registry listing unchanged, including the
load-bearing `?? []` for a host with no metadata service at all.

**#6504's completeness verdict is added here rather than preserved** — unlike
the stdio bridge, this read never had a diagnosed wrapper, so a known-partial
skill surface presented as a complete one. The verdict is asked of
`IMetadataService.listDiagnosed` directly rather than taken from the merged
read, because `getMetaItems` swallows a MetadataService read failure into its
own `catch` and reports a merged list either way. It is reported at `warn`
(functional degradation: the prompt surface is visibly smaller than the
environment declares), and a verdict probe that itself fails is reported as
"could not be determined" rather than failing a read whose items succeeded.
