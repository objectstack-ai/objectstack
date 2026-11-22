---
'@objectstack/spec': minor
'@objectstack/metadata': minor
'@objectstack/objectql': minor
---

fix(objectql)!: a composition's top-level `objectExtensions` entry that no package body carries is registered and served; composition refuses two such jobs of one name, and residual extensions that would share one package's slot

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no skill teaches placing `objectExtensions` or `jobs` in a manifest-less input of a `'preserve'` composition; the refusal names both entries and prescribes the fix

<!-- adr-0087: registered stack-residual-extension-registered-and-jobs-judged -->

**BREAKING** accept-set narrowing, shipped as `minor`, beside a runtime fix.

- **Fixed (`@objectstack/objectql`, `@objectstack/metadata`).** A composed artifact that carries `packages[]` keeps the entries no package body claims at its top level, and the boot registers that residual under the artifact's `manifest.id` (ADR-0130 D4). Under `composeStacks(stacks, { manifest: 'preserve' })` that is an input with no `manifest`; under `'first'`, `'last'` or an index it is also the own top-level entries of an input that is itself a multi-package artifact. Its `objectExtensions` entries were registered by no door: the target object was served without their fields (`INVALID_FIELD` on a write naming one) and nothing was logged, through `os serve` and through `os build`'s artifact alike. The residual rule (`unclaimedTopLevel`) now lists such an entry (type `object_extension`) when no package body carries an entry equal to it, and the engine registers it as an `extend` contribution under `manifest.id`, as a body's entry registers. An entry whose field names a picklist no package body declares is not registered and is named at boot, like a residual object.
- **Refused now, at composition (`STACK_CROSS_REFERENCE_INVALID`, 422), under every manifest strategy once the result carries `packages[]`.** Two residual jobs of one name: the boot's job binder schedules neither (`NOT SCHEDULED` at `error`). A residual `objectExtensions` entry for an object that the body carrying `manifest.id` also extends with other fields: one extension of an object registers per package, so only the last one's fields would be served; the finding names that body's entry first, then the residual's: `Object extension of 'crm_line' is declared twice in \`objectExtensions\`: 'com.example.billing' (stack #2) objectExtensions[0] and stack #1 objectExtensions[0]. …`. Two residual `objectExtensions` entries for one object, also when another package body extends that object: a residual entry is now told from a body's flattened copy by value, not by target, so the two are one package's pair (they used to count as that body's copies and compose).
- **Not refused (known gap).** A residual job that shares its name with a package body's job, with other content, still composes: it is read as that body's copy, and the boot holds two enabled jobs of the name and schedules neither.
- **Wording.** The `jobs` finding at every door now says what the runtime does with the pair: `The runtime keys jobs by name: the metadata keeps only the last of these entries, and the job scheduler refuses a name two enabled jobs share, so when both are enabled neither runs.`
- **Unchanged.** One residual extension for an object another package extends composes, and both register. A residual entry equal to a body's entry is that body's copy. Package-claimed extensions and a single residual job compose and boot as before.
- **Installed artifacts.** A residual extension sharing its package's slot registers, the last one served, with one `error` line per object naming the entries. A residual extension now passes the registry's `extend` door as a package body's entry does, so one that door refuses (reachable only through `strict: false` or a hand-built artifact) now fails a boot that used to load and drop it.

One-line fix: declare each job name once; move a top-level extension into the package that owns it, or merge it into that package's own entry for the object.
