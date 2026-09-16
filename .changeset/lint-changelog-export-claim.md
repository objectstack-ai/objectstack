---
'@objectstack/lint': patch
---

**Docs:** the 17.3.0 entry for #13935 no longer claims `FIELD_RULE_AMBIENT_ROOTS` and `FIELD_RULE_JUDGED_ROOTS` are exported — `src/index.ts` exports neither (#18169).

`CHANGELOG.md` is in this package's `files[]`, so that sentence ships inside the npm tarball and is the text an upgrading agent greps. Measured on the published `@objectstack/lint@17.4.0` tarball (read 2026-09-16T12:25Z): the export block of `dist/index.js` names `FIELD_RULE_BOUND_ROOTS` and neither of the other two, and the export clause of `dist/index.d.ts` is the same — `FIELD_RULE_JUDGED_ROOTS` occurs in that file only inside two `{@link}` docblocks, and `FIELD_RULE_AMBIENT_ROOTS` not at all. A consumer who wrote `import { FIELD_RULE_AMBIENT_ROOTS } from '@objectstack/lint'` on the strength of the entry got a resolution failure.

Per AGENTS.md, a factual error in a released entry is amended **in place**, in a dedicated docs-only PR, never by an erratum in a later entry — the reader greps the symbol and lands on the old entry, so a correction anywhere else is one they never reach. The correction therefore lives in the 17.3.0 entry itself, which now states what `src/index.ts` actually exports, verified at the export statement. This changeset is not that correction; it exists so the corrected text reaches the registry at all. Published tarballs are immutable, so the amendment becomes published text on the next publish of this package and not before.

No code, no export, and no behaviour moves.
