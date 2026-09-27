---
'@objectstack/spec': patch
---

Corrects the ADR-0087 D2/D3 house-rule prose in the migration chain's module docblocks (`packages/spec/src/migrations/types.ts` and `packages/spec/src/migrations/registry.ts`) so it states the ruled convention: every retirement family gets one D3 `semantic` entry, even when a lossless D2 conversion also exists for it, and D2 carries the mechanical data repair only (#17152).

Clause-②: no

Both docblocks previously said a `semantic` (D3) entry exists only for a break D2 "cannot express losslessly" — the shape ruled superseded (director-seat class-one self-adjudication on #17152, authority: the maintainer's ruling on #15954). No entry, gate or runtime behaviour changes; this is a doc-comment correction, filed as `patch` because the `types.ts` module docblock text ships verbatim into the published `dist/index.d.ts` / `dist/index.d.mts` (measured: `grep` after a real build finds the corrected sentence there, with `MigrationStep` and `MIGRATION_SUPPORT_FLOOR` as positive controls proving `dist` is readable). The `registry.ts` docblock does not ship to `dist` (same positive controls, zero hits for either the old or new wording there) but is corrected for the same reason — it is the exact sentence the card quotes and the ruling targets.
