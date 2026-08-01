---
"@objectstack/spec": patch
---

feat(spec): ratchet cross-entry dual-source exports — same name, different declaration, caught by symbol identity (#4446)

`api-surface.json` records every export per entry point, so a name appearing on
two entries was VISIBLE — but nothing distinguished a re-export (one
declaration, two import paths — fine) from a **dual-source** (each entry
resolving the shared name to its OWN declaration, so which type a consumer gets
depends on nothing but the import path). The dual-source case is the #4411
trap: spec carried two differently-shaped `MetadataWatchEvent`s plus ten more
pairs, and the copy that *looked* canonical was the dead one — an auto-import
or model completion picking by name compiled fine and failed later, at an edge
value.

New pure check `check:dual-source-exports` (lint.yml, after the build step):

- **Judged by symbol identity, not name.** Every export of all 16 public
  entries is resolved through its alias chain to the original symbol; a name
  whose entries resolve to ≥2 distinct symbols is dual-source. Name-based
  counting would drown the signal — the real surface carries 148 legitimate
  re-exported names.
- **Shrink-only baseline** (`dual-source-exports.baseline.json`): the 63
  existing dual-source names are recorded (including the `MetadataFormat`
  `./shared`≠`./system` enum divergence, the `./contracts` third-shape
  interfaces, and two type-vs-const cases `ShareRecipientType` /
  `TransformType`). A NEW dual-source fails the gate with the fix at the
  declaration (converge + re-export, or rename); a resolved one fails until its
  line is deleted. The baseline is hand-edited under review, deliberately not
  generated — a `gen:` would admit new dual-sources via "run the fix command".
- **Self-tests first** (like `check:exported-any`): a fixture proves the
  detector still flags a true dual-source (incl. type-vs-const) and still
  passes re-exports, so a resolution failure can never read as "clean".

No runtime code changes; no export changes. The 63 baseline entries are
pre-existing debt, now visible and non-growing.
