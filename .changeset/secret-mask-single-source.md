---
"@objectstack/spec": minor
"@objectstack/objectql": patch
"@objectstack/service-settings": patch
---

fix(spec): declare the eight-bullet credential read mask once, in spec (#7572)

The string a client sees in place of a credential it may not read back was
declared **twice**, byte-identical by convention only:

- `SECRET_MASK` in `@objectstack/objectql` — the encrypted-**field** read mask on
  the generic CRUD path (ADR-0100 §A/§B);
- `SETTINGS_SECRET_MASK` in `@objectstack/service-settings` — the settings REST
  read boundary, added by #7522.

Nothing bound them. An edit to either literal would desynchronise the two masked
reads a console sees, and the break would be invisible from both sides: each
package asserted against its own copy, so both suites stay green while the two
surfaces disagree. That matters more than a cosmetic mismatch — the console
renders "configured vs not configured" from this value and echoes it back
unchanged on save, and both write paths read that echo as "unchanged"
(ADR-0100 §B3). A drifted mask silently turns an unchanged form round-trip into a
real write of the mask's literal text over a live credential.

**What changed.** The mask is declared once, in `@objectstack/spec` — the
contract face both sides already depend on — as `SECRET_MASK` in
`spec/src/data/secret-mask.ts`, alongside the rest of the ADR-0100 surface
(`data/field.zod.ts`, `data/object.zod.ts`). Both readers now import that one
declaration:

- `@objectstack/objectql` **re-exports** it, so its public API is byte-for-byte
  unchanged — `SECRET_MASK` is still exported from the package root and from
  `core`, with the same name, value and literal type. No consumer changes.
- `@objectstack/service-settings` aliases it as `SETTINGS_SECRET_MASK`, keeping
  the name that package publishes and every existing import of it working.

**The framework-agnostic property of the settings service is intact.** #7522
declined to import the constant because reaching it meant depending on
`@objectstack/objectql`, the whole data engine — that reasoning was right and
still holds; no objectql import was added. It never applied to `@objectstack/spec`,
which is already a dependency of the package and already in its runtime graph
(`manifest.ts` → `@objectstack/platform-objects/system` → `@objectstack/spec/data`).

**New public API:** `SECRET_MASK` on `@objectstack/spec/data`. Additive — nothing
was removed or renamed on any package.

The literal keeps its deliberate spelling (eight U+2022 BULLETs written out, not
an escape or a `.repeat(8)`), so a grep for the mask a client actually received
still lands on the declaration; a source-level pin holds that, next to a byte pin
on the value. The far-side literal pins in `plugin-audit` and `driver-memory` are
deliberately left restating the mask — a pin whose job is to catch the constant
changing must not import the constant.
