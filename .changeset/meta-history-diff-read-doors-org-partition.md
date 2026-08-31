---
"@objectstack/rest": patch
---

fix(rest): `/meta/:type/:name/history` and `/diff` state the org partition they read (#13406)

`GET /api/v1/meta/:type/:name/history` answered `{ events: [] }`, and
`GET /api/v1/meta/:type/:name/diff` answered an all-empty diff, for metadata
whose overlay was authored **org-scoped** — while `sys_metadata_history` held
the full log. Both doors named no organization, and `sys_metadata_history` is a
**per-org** table: `SysMetadataRepository.history()` and `diffMetaItem` filter
`organization_id` by **strict equality** (no `$or`), so a door that states no
organization does not read "everything" — it reads the **env** partition
(`request.organizationId ?? null`). The write door has stated the org since
#8805; only these two read doors had not.

Direction is **fail-closed**: the caller's OWN org data was under-served. There
was no cross-org read, and the pins added here keep it that way (an org-less
caller, and a second organization, are both refused the rows).

**Call-side only.** `packages/spec` and the protocol implementation are
untouched: `organizationId` was already declared on the request contract
(`HistoryMetaItemRequestSchema`), and `request.organizationId ?? null` is the
legitimate expression of env scope that every correct caller depends on.

**The scope predicate is `organizationIdForMetaRead`, not the audit twin's raw
`ctx?.tenantId ?? null`** — measured, not stylistic. `auditMetaItem` reads with
`$or: [{organization_id: org}, {organization_id: null}]`, a union, so naming a
tenant there can only add rows. Under these doors' strict equality, a raw tenant
id would ask the **org** partition for the history of every
`allowOrgOverride: false` type that is still runtime-writable (`object`, `hook`,
`page`, `app`, `dataset`) — types whose rows `organizationIdForMetaWrite`
deliberately lands **env-wide** under the #6190 ruling. That would answer
`{ events: [] }` for them: this same defect, newly minted one type family over.
Gating the read on the same registry predicate the write uses is what keeps the
two sides incapable of drifting.

The key is **spread, never `organizationId: x ?? null`**:
`HistoryMetaItemRequestSchema` declares `z.string().optional()` — optional plain
`string`, not nullable, mirroring the implementation's `organizationId?: string`
— so `?? null` is a compile error on the history door, and on the diff door
(reached through a cast) it type-checks and is a silent runtime no-op.

Users of a single-DB multi-org deployment (`OS_TENANCY_POSTURE=isolated`) now
see the change log and version diffs for overlays their own organization
authored. Org-less callers, and every `allowOrgOverride: false` type, read
exactly what they read before.
