---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: one reader of `OS_METADATA_WRITABLE` — the legacy `OBJECTSTACK_METADATA_WRITABLE`, removed in 11.0, no longer opens the hatch at the type listing either

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) nothing authorable is removed, renamed or narrowed: no spec key, no metadata spelling, no export and no stored row changes shape, so there is nothing for `os migrate meta` to rewrite and no ledger entry to make. The operator action below is a deployment-environment rename, which the ADR-0087 ledger does not carry; 11.0 already published it, and this change makes the last reader honour it. -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

This finishes 11.0's removal at the reader that kept it. The 11.0 release removed ObjectStack's own legacy environment-variable names, `OBJECTSTACK_METADATA_WRITABLE` among them. That change edited one of the two readers of `OS_METADATA_WRITABLE` (the metadata repository's write gate) and missed the other (the protocol's, which feeds `GET /api/v1/meta/types` and the protocol's write gates). So with only the legacy spelling set, the type listing reported a named type as writable (`allowOrgOverride: true`, `overrideSource: 'env'`), while creating a new item of that type answered `403 NOT_CREATABLE`. One deployment gave two answers to one question.

**What changes.** The protocol now reads the setting through the repository's reader, so there is one reader and it reads `OS_METADATA_WRITABLE` only. With only `OBJECTSTACK_METADATA_WRITABLE` set, the hatch is shut everywhere: the listing reports no env override, and every write the hatch would open is refused as it is with nothing set. No deprecation warning is printed for the legacy name any more, because nothing reads it.

**What does not change.** `OS_METADATA_WRITABLE` behaves exactly as before.

**Operator action.** A deployment that still sets `OBJECTSTACK_METADATA_WRITABLE` sets `OS_METADATA_WRITABLE` in its place, with the same comma-separated type list. This is the rename 11.0 already published; nothing else changes.
