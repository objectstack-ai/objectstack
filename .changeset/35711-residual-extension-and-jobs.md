---
'@objectstack/spec': minor
'@objectstack/metadata': minor
'@objectstack/objectql': minor
---

fix(objectql)!: a `'preserve'` composition's top-level `objectExtensions` entry that no package body carries is registered and served; composition refuses two such jobs of one name, and a residual extension sharing its package's slot

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill teaches placing `objectExtensions` or `jobs` in a manifest-less input of a `'preserve'` composition; the refusal names both entries and prescribes the fix

<!-- adr-0087: registered stack-residual-extension-registered-and-jobs-judged -->

**BREAKING** accept-set narrowing, shipped as `minor`, beside a runtime fix.

- **Fixed (`@objectstack/objectql`, `@objectstack/metadata`).** Under `composeStacks(stacks, { manifest: 'preserve' })`, an input with no `manifest` keeps its collections at the artifact's top level, and the boot registers that residual under the artifact's `manifest.id` (ADR-0130 D4). Its `objectExtensions` entries were registered by no door: the target object was served without their fields (`INVALID_FIELD` on a write naming one) and nothing was logged, through `os serve` and through `os build`'s artifact alike. The residual rule (`unclaimedTopLevel`) now lists such an entry (type `object_extension`) when no package body carries an entry equal to it, and the engine registers it as an `extend` contribution under `manifest.id`, as a body's entry registers. An entry whose field names a picklist no package body declares is not registered and is named at boot, like a residual object.
- **Refused now, at composition (`STACK_CROSS_REFERENCE_INVALID`, 422).** Two manifest-less inputs declaring one job name: the boot's job binder schedules neither (`NOT SCHEDULED` at `error`). A residual `objectExtensions` entry for an object that the last input with a manifest also extends with other fields: under `'preserve'` that input's id is `manifest.id`, one extension of an object registers per package, so only the last one's fields would be served. The finding names that body's entry first, then the residual's: `Object extension of 'crm_line' is declared twice in \`objectExtensions\`: 'com.example.billing' (stack #2) objectExtensions[0] and stack #1 objectExtensions[0]. …`.
- **Wording.** The `jobs` finding at every door now says what the runtime does with the pair: `The runtime keys jobs by name: the metadata keeps only the last of these entries, and the job scheduler refuses a name two enabled jobs share, so none of them runs.`
- **Unchanged.** A residual extension for an object another package extends composes, and both register. A residual entry equal to a body's entry is that body's copy. Package-claimed extensions and a single residual job compose and boot as before.
- **Installed artifacts keep loading.** A residual extension sharing its package's slot registers, the last one served, with one `error` line per object naming the entries.

One-line fix: declare each job name once; move a top-level extension into the package that owns it, or merge it into that package's own entry for the object.
