---
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
---

fix(spec): withdraw the `field-required-notnull-explicit` ADR-0087 conversion — `required: true` no longer stamps `storage.notNull: true` on anybody's fields (#16693)

ADR-0113 split the pre-17 `required` tri-binding on purpose: `required` is the **write-time contract** and is NOT a column constraint, and `storage.notNull` alone binds the physical column (`sql-driver.ts#createColumn` has keyed off it alone since that ADR's P0). The `field-required-notnull-explicit` conversion asserted exactly the implication the ADR abolished — it added `storage: { notNull: true }` to every field it found `required: true` on — so it is removed from the conversion registry and from protocol 17's ADR-0087 ledger entry.

**Who this was reaching, and why it was not confined to old artifacts.** The entry carried `retiredFromLoadPath: true` and a docblock stating that "only `os migrate meta --from <16 or lower>` may apply it". That was not true of this tree. The artifact-ingestion door replays the whole chain with `includeRetired: true` (`applyArtifactForwardConversions`, `@objectstack/metadata-core`) and keys the replay off the artifact's declared `engines.protocol` **floor**, not its age — so any artifact declaring `^17.0.0`, which is the range `create-objectstack` stamps, was converted at boot. Measured on this tree at that seam: an artifact declaring `^17.0.0` on a 17.3.0 runtime came back from the door with `storage.notNull: true` written onto a field its author wrote as nullable-and-write-gated, and the boot logged `converted N site(s) forward` with a remedy sentence telling the author to write the same tightening into the source. On a populated database that instruction is a `tighten_not_null` / `severity: error` / `category: destructive` migration — prescribed as the remedy for a deprecation notice.

**What moves for consumers.**

- `applyConversions(stack, { includeRetired: true })` — the artifact-ingestion door and `os migrate meta` — no longer emits or applies this rewrite. The default load posture (`includeRetired: false`) is unchanged: the conversion was already skipped there.
- `os migrate meta --from 16` no longer lists it, and a `required: true` field crosses 16 → 17 carrying its write contract and nothing else.
- Boot no longer warns about it, so an artifact whose only conversion was this one now boots with that warning gone.
- Nothing is authored differently and nothing is refused that was accepted before. `required` and `storage.notNull` both remain authorable and both keep their ADR-0113 meanings. A column is NOT NULL because its author wrote `storage: { notNull: true }`, and for no other reason.

**No migration is owed to anyone** (maintainer ruling, 2026-09-08, decision batch #85, option A). Genuinely pre-ADR-0113 artifacts are not measured to exist, existing columns are left exactly as they are, and an app that wants NOT NULL columns declares `storage.notNull` deliberately — which is what the app that reported this had already done.

The protocol-17 ledger entry and the generated upgrade guide now say this in the other direction too, and the falsified sentence in `sql-driver.ts` — "sources authored before protocol 17 carry `storage.notNull` explicitly via the `field-required-notnull-explicit` conversion, so their columns come out exactly as they always did" — is corrected where it stood.

Two sentences in `@objectstack/driver-sql` that this withdrawal falsifies are corrected with it, and no drift behaviour changes. The `relax_not_null` finding — raised when a column is NOT NULL and the metadata declares no `storage` constraint — used to prescribe "(pre-protocol-17 sources: `os migrate meta` stamps it for every previously-required field)"; it now says the constraint has to be declared by its author, because nothing supplies it any more. The comment beside it, which closed with "`os migrate meta` ratifies it whenever the source is next migrated", says so too. The deliberate SILENCE for a `required: true` field whose column is already NOT NULL is unchanged — this corrects the sentences, never the finding.
