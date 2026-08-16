---
"@objectstack/metadata-protocol": patch
"@objectstack/metadata-core": patch
"@objectstack/spec": patch
---

fix(metadata): a package publish refuses a draft stored under a non-canonical metadata type, and the ADR-0010 audit writer asserts its `type` instead of folding it (#8908)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned — no spec key changes shape, so there is no
conversion to register. Two accept sets are narrowed at runtime (the batch
publish's pre-flight, and `recordMetadataAudit`'s `type` argument), and two
error codes are added to the ADR-0112 ledger. The rows this refuses are
pre-#7894 residue that no current writer can mint. -->

**Two tightenings, one card, because they are the same defect at two layers.**

`publishPackageDrafts` reads `sys_metadata` rows **at rest**, so #7894's `/meta`
boundary fold never reached it. `promoteDraftForPublish` folds the stored
spelling through `PLURAL_TO_SINGULAR` — the *manifest-collection* map, which
legitimately omits types that are not stack collections. For those the fold is a
**no-op**: the lookup key equals the stored spelling, the draft resolves, and the
publish mints an ACTIVE row in the namespace `PUT /meta/field/…` answers
403 NOT_OVERRIDABLE for. Measured on the card with the real repository over a
stub engine:

```
publishPackageDrafts({ packageId: 'app.demo' })
  → { success: true, publishedCount: 1, published: [{ type: 'fields', name: 'legacy_field' }] }
active row: { type: 'fields', name: 'legacy_field', package_id: 'app.demo' }
audit row:  { type: 'fields', name: 'legacy_field', outcome: 'allowed', code: 'ok' }
```

Every registry read and every compliance query on `field` misses an item the
platform just reported as published — the #4432 shadowing shape, minted at
publish time instead of at the URL, and the last route by which a pre-#7894 row
could be re-promoted rather than migrated.

**1. The publish refuses it, at the pre-flight, batch-atomically.** Same shape as
the ADR-0028 namespace-prefix gate that already stands there: found before
anything is promoted, failing the whole batch (`publishedCount: 0`,
`published: []`) rather than publishing the healthy siblings around it, with one
audit row per violation. The refusal names the row, names the canonical type, and
states the re-author path; `failed[].code` is the new
`STORED_TYPE_NOT_CANONICAL`, and the audit column's spelling is
`stored_type_not_canonical`.

The rule is **derived, not a list**: a spelling the platform's URL/registry map
folds elsewhere *and* the manifest map leaves unchanged. Against the real maps
that is **six** spellings — `fields`, `seeds`, `external_catalogs`,
`externalCatalogs`, `translations`, `email_templates` — where the card named
four; the last two would have been missing from any hand-written list, and a
newly declared type that never reaches the manifest map is covered on the day it
is declared. A manifest-**present** plural (`objects`) is deliberately *not* in
the class: it is already fail-closed at the promote (`NO_DRAFT`, batch aborted)
and keeps that verdict.

⛔ Deliberately **not** included: migrating the row (a `_migrate-stored` /
boot-reconciliation conversion). That was the other option on the card and is
explicitly unruled — it stays available as a follow-up with its own appetite.

**2. `recordMetadataAudit` refuses a non-canonical `type` (`AUDIT_TYPE_NOT_CANONICAL`)
instead of folding it.** The writer used to open with
`type: PLURAL_TO_SINGULAR[entry.type] ?? entry.type` — a lenient consumer, and a
**tolerant-and-incomplete** one: the fold read the same manifest map, so the
compliance trail came out canonical for the 29 types that never needed it and
non-canonical for exactly the ones that did. Ruled the same direction as the
refusal above: **fold at the boundary, assert at the writer.** Every call site
that builds a row out of an at-rest `type` — all of them on
`publishPackageDrafts` — now folds with `canonicalMetaType`; the `/meta` routes
were already canonical by the time they got there. The throw sits **outside** the
writer's best-effort `try`, because inside it the method's own `catch` would
degrade the assert into a `console.warn`.

The assert cannot refuse a canonical type (no canonical spelling folds
elsewhere — 33 of 33, measured) nor a plugin-registered or otherwise
unrecognised kind (`canonicalMetaType` is the identity for anything the static
map does not carry), so it narrows the accept set without closing it.

**Reachability was enumerated before the assert landed**, as the ruling required:
`recordMetadataAudit` is private to `protocol.ts` with 11 call sites, `sys_metadata`
rows have exactly one producer in the repository (`saveMetaItem` → `repo.put`,
post-fold), and no current write path can mint a non-canonical stored type. The
only non-canonical types that ever reached an audit write came from the batch
publish's at-rest rows, which is what the boundary folds now cover.

Also fixed, as a consequence of that fold rather than as a separate change: on
the batch route `getEffectiveLock`'s overlay limb was queried with the raw stored
spelling, so an ADR-0010 `_lock` carried by the canonical active row was looked
up under a `type` no row has and came back `'none'` — the verdict "the author
declared no protection". That is the batch twin of the hole #8769 closed on
`publishMetaItem`.
