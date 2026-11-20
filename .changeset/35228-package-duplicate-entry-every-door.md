---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

feat(spec)!: two entries under one identity in one package are refused when a composition or a package body assembles them, as a single stack already refused them

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill teaches splitting one package's entries for one identity across sub-stacks or package bodies; `skills/objectstack-data/SKILL.md` teaches one `objectExtensions` entry per extension, and the refusal names both entries and prescribes the merge

<!-- adr-0087: registered stack-package-duplicate-entry-refused-at-every-door -->

**BREAKING** accept-set narrowing, shipped as `minor`. `defineStack` refuses two entries under one identity in one stack for the collections the runtime registers one entry per identity (`objects`, `datasources`, `pages`, …, `queues`, `assignmentRules`, `apps`, `objectExtensions`), but two sub-stacks of ONE package that each declared one such entry composed with both, and a hand-built `packages[i]` body carrying two was accepted. `os validate`, `os build` and the boot all passed, and the boot then kept one entry. For `objectExtensions` that meant only the last entry's fields registered: a field the earlier entry declared was missing, and reads and writes naming it answered `INVALID_FIELD`.

- **Refused now, in the cross-reference envelope (`STACK_CROSS_REFERENCE_INVALID`, 422), with the single-stack wording.** `composeStacks`, for the package it registers under its own `manifest.id`: every input of a flat composition, and under `manifest: 'preserve'` the inputs without a manifest and any other top-level entry no package body claims (the boot's residual). Each finding names the input every entry came from: `Object extension of 'crm_line' is declared twice in \`objectExtensions\`: stack #1 objectExtensions[0] and stack #2 objectExtensions[0]. …`. Every `packages[i]` body, of `defineStack({ packages })` (`stack.packages[1].manifest.objectExtensions[0]`) and of a composition that carries or assembles bodies. The refusal carries the inputs' conversion record like the other composition refusals. Two inputs declaring one app name now answer this refusal first, where they answered `STACK_SINGLE_APP_VIOLATION`.
- **Unchanged.** A single stack's refusal, byte for byte. Two packages reusing one name (ADR-0048 §3.4): under `manifest: 'preserve'`, as two package bodies, or as a nested multi-package artifact's flattened copies of its bodies, each body is judged on its own. The same built sub-stack passed to a composition twice, except its `hooks`: a hook reached twice is refused, because a built artifact binds each copy. Two same-name objects across inputs stay the `objectConflict` strategy's to refuse or fold.
- **Installed packages keep loading (`@objectstack/objectql`).** A package body built before this release that carries two or more `objectExtensions` entries for one object registers as before (only the last entry's fields), and its registration now logs one error per (package, object) naming the object, the package and the entries, and telling the author to merge them and rebuild. Entries for one object that are all equal by value lose nothing and log nothing. Re-registering a package still replaces that package's previous extension of the object.

One-line fix: merge the entries into one (for `objectExtensions`, one entry per target object carrying every field), or rename one of them.
