---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `getMetaItems` applies the registry read gate itself, so a sweep that reads more than one type per request is scoped per type (#14683)

`getMetaItems` applied no organization gate of its own: whatever `organizationId`
arrived was spent on whatever `type` arrived. The scope of a metadata sweep was
therefore decided per type **by the caller** — which a request carrying one
organization can only get right when it sweeps **one** type. It now resolves
`organizationIdForMetaRead(request.type, request.organizationId)` once, after the
canonical type fold, and both the active-overlay read and the `previewDrafts`
read spend that one resolution.

Three live callers sweep more than one type and could not have been right:

- `getMetaDiagnostics` with no `type` — `targetTypes` is the whole registry, the
  five `allowOrgOverride: true` types and every other declared type together,
  under one request-level organization.
- `findReferencesToMeta` — `request.type` is the **target**; the organization is
  spent on `matcher.fromType`, the **sources**, so the target's own registry flag
  says nothing about the types actually read.
- the runtime's package export sweep (`assemblePackageManifest`) — every plural
  key of `PLURAL_TO_SINGULAR`, with one raw active organization.

**The harm class is resurrection, not concealment**, and which one it is decides
that the registry-gated predicate is the right instrument.
`SysMetadataRepository.history()` filters `organization_id` by strict equality,
so naming the tenant *there* hides an `allowOrgOverride: false` type's rows. On
this path the two `queryByOrg` reads are UNIONed, so naming it can only **add** —
and what it adds are the pre-#6190 phantoms: org-scoped rows of types with no
per-org read channel, which `loadMetaFromDb` walks past and
`reportUnhydratableOrgScopedRows` exists to warn about. Read back, they surface
in the admin "Used by" panel and the Studio governance directory, inside a
clearance rendered before a destructive action — where a resurrected row is worse
than an omission because it reads as evidence.

**Why `patch`, from this change's own lineage.** A published `/meta` read door's
row set changing is not a new class here — it is the class this predicate was
born in, and all three landed instances shipped `patch`:

| commit | what changed | level |
|:--|:--|:--|
| `b6c769019` (#9454 / #9727) | the row set every `/meta` read door returns — org rows **added** | `metadata-core`, `metadata-protocol`, `rest`: all `patch` |
| `26f3588fb` (#10340 / #10519) | which partition two spellings read — rows **moved** | `rest`, `metadata-core`: `patch` |
| `67ceb9aef` (#11553) | the same fold-before-scope repair on the dispatcher door | `runtime`: `patch` |

The first of those is the commit that introduced `organizationIdForMetaRead`
itself. Adding the org partition to every read door was `patch`; moving which
partition two spellings read was `patch`; this change — withholding the org
partition from types that never had a read channel for it — is the same class,
one verb further in, and takes the same level.

⛔ Not `minor`, and in this repo that is a statement rather than a rounding
choice. `scripts/check-changeset-no-major.mjs` refuses `major` outright, so
during the launch window a genuinely breaking change ships as `minor` (pre-1.0,
whole-stack lockstep) — #13925 is exactly that, `"@objectstack/core": minor`
carrying a bolded incompatibility banner and an `adr-0087:` marker for a
narrowed published accept set. But the implication runs ONE WAY ONLY, and the
gate's own header is explicit that it does: during the window `minor` is the
union of ordinary new-functionality bumps and banner-marked breaking ones
(`87ad30c10`, `3c1bbd2a8` are new-export `minor`s carrying no banner at all),
so the bump level "tells a consumer nothing about whether the release breaks
them". The carriers of breaking-ness are the bolded banner in the body and the
ADR-0087 disposition — "during the window they are the only signal there is".

⇒ So `minor` here would not claim an incompatibility; it would claim NOTHING
about compatibility, which is precisely the cost the header names. This change
carries neither carrier because it owes neither — nothing is retired, no accept
set narrows, and `check-adr-0087-registration` reads it as non-breaking. The
level is `patch` because the lineage above is `patch` and no export is added,
not because `patch` rebuts something `minor` would have asserted.

**Nothing here is incompatible, and the reason is what the withheld rows are.**
They are the #6190 phantoms: org-scoped rows of types with no per-org read
channel. The platform has refused to mint them since `ac244ad09` / `6155c3c24`,
boot hydration skips them, `reportUnhydratableOrgScopedRows` audits them, and
**every REST `/meta` read door has already withheld them since `b6c769019`**.
The only doors still serving them were the dispatcher list
(`runtime/src/domains/meta.ts:921`) and the runtime manifest and publish-flip
reads (`packages.ts:1160`, `:603`) — so this change aligns those three with the
published `/meta` surface rather than departing from it. A consumer reading
those rows was reading through a door inconsistent with `/meta`, on data the
platform had already ruled dead.

⛔ Not "only a refactor of where the predicate lives" either: the predicate's new
position does change which rows three doors serve. That is why this is a
behaviour entry rather than an internal note — and, per the lineage above, why
the level for it is `patch`.

**Callers that already gate are unaffected, and that is proved rather than
asserted.** `organizationIdForMetaRead` answers either its argument or
`undefined`, so a second application over the same type is a no-op; the load-
bearing half is that it *is* the same type. The REST `GET /meta/:type` list door
gates on `canonicalMetaUrlType(req.params.type)` and passes the raw segment, which
`canonicalizeMetaRequestType` folds through the identical map — the identical
string. The other four `organizationIdForMetaRead` call sites in `rest-server.ts`
reach `getMetaItemLayered` / `getMetaItem` / `historyMetaItem` / `diffMetaItem`
and never this method. `get-meta-items-org-read-gate.test.ts` §3 measures both
halves over the complete accepted-spelling population (61 spellings, derived from
`META_URL_TO_SINGULAR` unioned with the registry) rather than a hand-listed
sample.
