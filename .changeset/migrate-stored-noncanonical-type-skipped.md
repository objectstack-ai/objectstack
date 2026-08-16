---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): the stored migration reports a non-canonical stored `type` as `skipped` instead of counting it `canonical` (#8957)

`migrateStoredMetadata` — the method behind `POST /meta/_migrate-stored` and
`os migrate meta --stored` — opened every row with
`PLURAL_TO_SINGULAR[rawType] ?? rawType`, the **manifest-collection** map. That
map legitimately omits the metadata types that are not stack collections, so
for a row stored under one of their plural spellings the fold was a no-op: the
pass looked up ADR-0087 body conversions registered for a type named `fields`,
found none, saw nothing had changed, and recorded the row `canonical`.

`canonical` is counted and never itemised — by design, because on a healthy
deployment that is every row — so the row disappeared from `report.rows`
altogether. The verdict means "nothing to do", and there was something to do:
the row sits in a second namespace that no registry read and no compliance
query on the canonical type can reach.

Since #8908, `publishPackageDrafts` **refuses** exactly these rows at its
pre-flight (`STORED_TYPE_NOT_CANONICAL`). The stored migration is the door an
operator naturally reaches for next, and it answered that the row was already
fine. The two doors now agree.

## What changed in the report

The scan folds with the URL/registry map (`canonicalMetaType`) instead of the
manifest map, and a row whose **stored** spelling is non-canonical is reported:

```jsonc
// before — the row was invisible
{ "scanned": 1, "canonical": 1, "skipped": 0, "rows": [] }

// after
{
  "scanned": 1, "canonical": 0, "skipped": 1,
  "rows": [{
    "type": "field", "name": "showcase_task.title", "outcome": "skipped",
    "reason": "the row is stored under the non-canonical metadata type 'fields' ('fields/showcase_task.title'), and its canonical type is 'field'. …"
  }]
}
```

The reason names the stored spelling in the same `type/name` form the publish
refusal quotes, the canonical type, the other door's error code, and the
re-author path. `--type field` and `--type fields` now both reach the row —
the filter folds the same way, so the spelling an operator was just handed by
the publish refusal is not the one spelling that fails to find it.

The fold swap cannot change the answer for any spelling the old fold resolved:
`META_URL_TO_SINGULAR` embeds every manifest spelling verbatim under a
module-load agreement assertion, and measured on this tree the set of spellings
where the two folds disagree is empty. The set the new fold newly resolves is
exactly the six-member class `isNonCanonicalStoredType` derives (`fields`,
`seeds`, `external_catalogs`, `externalCatalogs`, `translations`,
`email_templates`), which is the set now reported.

## What did NOT change

The method's contract. It still canonicalizes **bodies**, and it still writes
nothing for this class: rewriting a stored `type` is an identity move — a new
`(org, type, name, package_id)` key, history and audit continuity to decide,
and a collision question when the canonical row already exists — which #8908's
ruling parked as a follow-up needing its own appetite.

`storedMigrationClean` is also unchanged: `skipped` rows still do not flip it.
This pass has no lever for the condition, so failing the verdict over it would
give `os migrate meta --stored` a non-zero exit that no run of that command
could ever clear. The row is reported per-row instead, and the publish door is
what refuses it.
