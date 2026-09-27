---
"@objectstack/spec": minor
---

`composeStacks(…, { manifest: 'preserve' })` emits each definition **once**, in the body of the package that owns it: a multi-package release artifact no longer carries a flattened copy of its collections at the top level (#14512, ADR-0130 D4's 2026-09-22 addendum).

Measured on `examples/app-multi-package` (two packages, three definitions): `dist/objectstack.json` goes from 8,223 to 5,328 bytes, −35%, and the ratio does not improve with size — it was one extra copy of everything a package owns. The artifact's own `manifest`, `packages`, `plugins`, `devPlugins`, `devLogins`, `api`, `server`, `i18n`, `runtimeModule`, `onEnable` and `devHint` are untouched at the top level; the 35 package-owned collections are what moves.

**BREAKING** for anything that read a compiled multi-package artifact's top-level collections directly. Every reader the platform ships was converted first — the ruling's order was readers first, emitter last — and this lands only with #15004's acceptance probe green on both shapes, which boots a two-package collection zoo through all five load boundaries and fails if any subsystem sees an empty collection.

- **No authored metadata changes, and no artifact on disk is invalidated.** The authoring shape is identical: N `defineStack` packages plus a project config composing them with `manifest: 'preserve'`. ADR-0130 D4's read-both rule is untouched — `packages` present ⇒ iterate it, `packages` absent ⇒ `manifest` as a single-element list — so an artifact built before this change, which carries both halves, loads exactly as it did.
- **A single-package artifact keeps today's shape byte for byte** (ADR-0130 D7): the emitter strips nothing below two package entries.
- **The flattened half is dropped only where it is a COPY — three conditions, and a composition failing any one of them keeps today's additive shape**: (1) two or more package entries; (2) every input's collections attributed to a body — an input declaring no `manifest` has no package that could own its collections, and an input already carrying `packages` contributes those entries untouched; (3) the bodies reproduce the flattened collections item for item. Condition 3 is what `objectConflict: 'merge'` / `'override'` and a standalone action bound onto a SIBLING package's object fail: composition RECONCILES those into a top-level definition no body carries, so the flattened half is not a copy of anything and stays. Nothing here is refused — a composition that was legal before stays legal.
- **Why the copy goes rather than being compressed**: one definition was serialized twice with nothing keeping the copies equal. Where they differ today the flattened one is the reconciled copy and the platform's reader prefers it deterministically, which is exactly why this change removes the second copy only where the first one is redundant. One measured consequence on the compiled path: a seed dataset declared once reached the runtime's shared seed registry twice, and now reaches it once.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves: no spec key, export or config field is removed or renamed, and no stored metadata representation changes, so `objectstack migrate meta` has nothing to rewrite. What changed is the SHAPE A COMPILER EMITS, and every reader of it in this repository was converted by the reader half of the same ruling (#15005, #15006, #15007, #15229, #15232) before this landed. -->
