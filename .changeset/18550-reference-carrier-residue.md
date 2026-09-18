---
"@objectstack/objectql": minor
"@objectstack/rest": minor
"@objectstack/metadata-protocol": minor
"@objectstack/lint": minor
"@objectstack/verify": minor
---

The remaining raw `FieldSchema.reference` readers now **REFUSE** a carrier they cannot read, instead of answering "no target" (#18550). The previous release routed the arbiter (`referenceCarrierOf`) and the lint target readers; these were the measured residue of the same ruling — every reader, not just the arbiter.

`FieldSchema.reference` is `z.string().optional()`, so `ObjectSchema.safeParse` refuses an object- or array-valued carrier at the contract door. These reads are the other door: the one a value reaches only when it never went through parse — a hand-built fixture, a raw `registerObject`, a stored row rehydrated past its schema.

**`@objectstack/objectql`** — both of the delete cascade's carrier reads (`planCascadeAtomicity` and `cascadeDeleteRelations`). This is the one with a measurable runtime consequence, and it is why the level is not `patch`:

```
before   acct=1 task=1
delete   RESOLVED true       <- success reported to the caller
after    acct=0 task=1       <- an ORPHANED master_detail row
```

An unreadable carrier made the relation invisible to the cascade, so the parent was deleted, the detail row stayed, and the caller was told the delete succeeded — no `restrict` refusal, no `set_null`, nothing logged. It now refuses before any row is touched.

**`@objectstack/rest`** — the public-form lookup picker's field-def fallback. The field def is also hoisted out of the metadata fetch's `catch {}`, so an unreadable carrier is no longer reported as `LOOKUP_TARGET_MISSING`: "no target is declared" and "the declared target cannot be read" want different fixes from whoever owns the metadata.

**`@objectstack/metadata-protocol`** — the seed dependency graph, which also retires an `as string` cast that asserted exactly what its truthiness guard had not checked.

**`@objectstack/lint`** — the four remaining target readers: `masterDetailCount` (`validate-expressions`), the `displayField` consumer edge (`validate-field-consumers`), the field and action-param targets (`validate-object-references`), and `masterOf` (`validate-sharing-rule-enforceability`).

**`@objectstack/verify`** — `relationTarget`, which no longer degrades an unreadable carrier to the generic "has no `reference` target" an object with no relationship metadata at all receives.

`null`, `undefined` and `''` are ABSENCE, not a wrong shape, and still answer `undefined` at every one of these sites — a field is allowed to name no target, and `StrictField` declares `reference` nullable. Each site's absence answer is pinned alongside its refusal.

Upgrading: nothing conformant changes. A non-string `reference` could not be authored, stored or parsed before this release either; what changes is that one now fails loudly at the read instead of being read as an absent target. If a test asserted the old silence, assert the refusal instead.
