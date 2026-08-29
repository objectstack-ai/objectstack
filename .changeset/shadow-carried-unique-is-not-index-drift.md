---
'@objectstack/driver-sql': patch
---

A healthy hash-shadow-carried UNIQUE is no longer reported as destructive index
drift — and the remedy that used to be proposed for it would have DROPPED the
constraint

On MySQL a declared UNIQUE whose key is too wide for an InnoDB key part is
carried by a driver-owned generated column holding a SHA-256 of the key values
(#11627). The index differ compared the declared columns against the columns an
index physically KEYS, so a shadow-carried UNIQUE — one VARBINARY(32) generated
column as the whole key — could never match. A clean `initObjects` reported the
index the same boot had just created as `index_mismatch` / `destructive`, with
`recreate_index` as the remedy and `os migrate apply --allow-destructive` in the
message.

Following that advice removed a live uniqueness guarantee. `recreate_index`
drops the UNIQUE by name and re-runs the additive sync; the sync retakes the
shadow route, and its `ALTER TABLE … ADD COLUMN` then failed on the generated
column that **survived** the index drop. That failure is a duplicate-COLUMN
error, matched by neither the "already exists" absorb (which spells index names)
nor the unique-violation branch — so the apply ended with the constraint dropped
and not re-created.

Both halves are fixed, and they share one vocabulary rather than special-casing
the differ. The orphan-COLUMN pass already recognised the shadow as driver-owned
(`isHashShadowColumn`) while the index it carries was proposed for destructive
rebuild; that asymmetry was the shape of the defect.

- The shadow's name derivation moved next to that predicate, so the name the
  sync creates and the name the differ looks for have one definition.
- Introspection reads the shadow's stored `GENERATION_EXPRESSION` and records
  the key it actually hashes, so the differ compares the key the constraint
  **enforces** instead of the digest column it stores. Drift reports and plan
  messages now name that key too, rather than `UNIQUE (uniq_…__hash)`.
- The sync inspects a surviving shadow column instead of assuming it absent: a
  column already hashing the declared key is re-keyed in place, one hashing a
  different key is re-generated, and a non-generated column of that name is
  refused rather than dropped.

Deliberately a real key comparison and not a blanket skip of every shadow. A
shadow written before #12998 hashes the RAW columns, so `CONCAT` yields NULL for
every NULL-organization row and the rows the `COALESCE(organization_id,
'__global__')` bucket exists to constrain are constrained by nothing (#5030's
shape) — indistinguishable by name from a healthy shadow. Skipping shadows
wholesale would have traded one false destructive finding for a true silent one;
that case is now reported as the ADR-0120 D4 tightening it is, runs the
duplicate pre-flight before anything is dropped, and is repaired by the apply.
A carrier whose expression cannot be read at all reports nothing rather than
proposing a drop it cannot reason about.
