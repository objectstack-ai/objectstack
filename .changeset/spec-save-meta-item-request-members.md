---
"@objectstack/spec": minor
---

**`SaveMetaItemRequestSchema` declares the contract members the save door sends** (#12004 — the #11006 maintainer-ruled pattern, 2026-08-22 option B, carried one door over exactly as #11679/PR #12003 carried it to the reset twin and #12005/PR #13521 to the history door).

`PUT /api/v1/meta/:type/:name` — the save door — was the biggest remaining request-shape gap in the meta write family: `saveMetaItem` is a REQUIRED protocol member (so a scan for undeclared members walked past it), while its request schema declared 3 of the ~11 members the REST door sends, and the call-site literal had to stay behind an `as any` cast (removing it surfaced `TS2353` on every undeclared key — pure request-shape smuggling, never member-existence feature detection).

Additive, not breaking — every member below already ships, and each is read and enforced by the implementation in `@objectstack/metadata-protocol`, whose parameter type is mirrored member for member:

- `organizationId?` — the write-side tenant partition (ADR-0005): selects WHICH overlay row the save writes, is stamped on the audit row, and an org-scoped write of a non-overridable type is refused 403.
- `parentVersion?: string | null` — the ADR-0008 optimistic-concurrency pin (`If-Match` on the REST door). Nullable, unlike the reset twin's plain optional string, because this verb passes a present `null` through to the repository conflict check unchanged: `null` is the first-write pin (409 when a row already exists), absent is unpinned (the implementation adopts the current hash — last-write-wins).
- `actor?` — identity recorded on the history event (`recorded_by`) and audit row; on the REST door the request's authenticated identity, never a caller-supplied header.
- `force?` — the destructive-change acknowledgement (`?force=true`): skips the safety diff that refuses an `object` save dropping fields or narrowing types the stored item still carries.
- `mode?: 'draft' | 'publish'` — the ADR-0005 per-item lifecycle; anything but `draft` (absent included) is the legacy straight-to-live default.
- `packageId?: string | null` — the ADR-0048 package binding (`?package=<id>`); a named read-only base package is refused, and absent keeps the env-local overlay.
- `writeFace?: 'package-duplicate' | 'meta-envelope' | 'meta-dispatch'` — which write door a refusal is rendered FOR. Server-stated: every producer builds the request field by field and never spreads a wire body into it, so a client cannot smuggle a face in; declared because it is a real implementation parameter with three server-side producers and two refusal renderers branching on it (the 409 destructive-change remedy and the 422 findings clause).

Two members stay deliberately OUT: `environmentId` (transport-level multi-kernel routing key, the #9741 ruling — it rides `packages/rest`'s `TransportScopedMetaRequest` wrapper, never a protocol schema) and `source` (implementation-internal write provenance whose only producer is the implementation's own migrate call; the #11426 publish precedent leaves it undeclared until a producer on this contract pulls it). Both non-declarations are pinned shape-absent.
