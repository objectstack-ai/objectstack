---
"@objectstack/metadata-protocol": patch
---

fix(metadata): the three read-side `/meta` verbs reach the canonical type boundary — history, audit and references (#9157)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
added, renamed, retired or tombstoned. This routes three existing protocol
methods through an existing request-boundary function; the only externally
visible movement is on three GET routes, described below. -->

Step ① of the maintainer ruling in #9180 (2026-08-16): **the `/meta` type
segment is singular, always.**

`auditMetaItem`, `historyMetaItem` and `findReferencesToMeta` each opened by
deriving their type key from `PLURAL_TO_SINGULAR` — the MANIFEST-COLLECTION map
that #7894 moved this boundary off — instead of calling
`canonicalizeMetaRequestType`, which the nine sibling `/meta` verbs already
call. That one call carries **both** the URL spelling map **and**
`metaUrlSpellingRefusal`, and the refusal is the half these three could never
reach: it lives *inside* the function they skipped.

**What changes on the wire**, on `GET /api/v1/meta/:type/:name/history`,
`…/audit` and `…/references`:

| caller's `:type` | before | after |
| --- | --- | --- |
| `viewes` — an unrecognised spelling of a **declared** type | 200 with an empty body | **400 `INVALID_REQUEST`**, naming both accepted spellings (`view`, `views`) |
| `translations`, `fields`, `seeds`, `external_catalogs` — recognised plurals of the four types absent from the manifest map | 200 with an empty body | 200 with the **real** rows |
| `views` — a recognised plural already in the manifest map | unchanged | unchanged |
| `fieldz` — reaches for no declared type | unchanged | unchanged; the refusal stays narrow, so a plugin-registered kind can never trip it |

The harm being closed is the empty-accumulator shape: a plural read answered
`{ "events": [] }` / `{ "references": [] }` — read by an operator as *"nothing
depends on this"* — at exactly the moment they were about to rename or delete.
**Loudly wrong beats quietly lying**, so a spelling the platform cannot honour
is now refused with the canonical one named rather than answered emptily.

Two measured details worth stating, because both invert an intuition:

- On `historyMetaItem` the unfolded plural was not merely a wrong key, it was a
  door **around** a gate. `field` declares neither `allowOrgOverride` nor
  `allowRuntimeCreate`, so the canonical spelling is refused by the overlay gate
  and never reaches the store — while `fields` took
  `isRuntimeCreateAllowed`'s no-static-registry-entry arm (the plugin path,
  permissive by construction) and issued a real `sys_metadata_history` read
  keyed `'fields'`. Same empty body, opposite path.
- On `findReferencesToMeta` the refusal is the **whole** visible change. Every
  `REFERENCE_PATHS` key is manifest-present and already folded, so a
  manifest-absent target still answers `{ "references": [] }` — which that
  method documents as a legitimate no-hit. Widening that registry is a coverage
  question, not a spelling one.

Recognised plural spellings are **not** retired here — `metaUrlSpellingRefusal`
returns `null` for `views` and for `translations`, and a pin asserts it. That is
#9180 step ③, which the ruling requires to stay independently revertible.
