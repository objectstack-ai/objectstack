---
"@objectstack/lint": patch
---

`translation-target-unknown` no longer reports the locale keys a package ships for what it CONTRIBUTES into metadata another package owns — `objectExtensions[]`-injected fields and validation rules, and the navigation items it contributes into an app it does not declare (#18441, #18442).

Both were `error`, so each one FAILED the run it appeared in, and both carried the orphan remedy — *"Point the key at a declared field, or drop it"*, *"Match the key to an app's `name`, or drop it"* — which deletes a translation the runtime resolves. Measured on the two probe stacks:

- `objects: [crm_lead { name }]` + `objectExtensions: [{ extend: 'crm_lead', fields: { sla_tier } }]` + a `zh-CN` key for `sla_tier` produced one `error` at `translations[0]["zh-CN"].objects.crm_lead.fields.sla_tier`. A genuinely undeclared field on the same stack produced a finding identical but for the name, so **a correct author and a real typo were indistinguishable in the output** — an author who extended an object correctly was told their correct key was wrong, in a run that failed.
- in `os build`'s per-package leg, a contributor package carrying `navigationContributions` and no apps of its own was told app `crm_enterprise` is one *"which this stack does not define"* — whether or not the app's owner was an entry of the same artifact. Declaring that app is the owning package's job; the contributor cannot do it.

Both folds widen what a key may RESOLVE against and nothing else, so every genuine orphan still reports at `error` with the rule id intact: a typo on an extended object, a `_validations` name no layer declares, an object neither defined nor extended, an app neither defined nor contributed into, and a contributed navigation id nothing contributes are each pinned as a control beside the case they neighbour.

Two bounds worth reading before widening either fold further:

- **The extension fold is exactly two rungs wide because `ObjectExtensionSchema` is.** The declared entry keys are `extend`, `priority`, `fields`, `validations`, `indexes`, `label`, `pluralLabel` and `description`; `views`, `listViews`, `actions`, `fieldGroups`, `sections`, `tabs` and `hooks` are refused BY NAME at the extension level with authoring guidance. So `fields.*` and `_validations.*` are the only rungs of this rule an extension can reach, and a `_views` / `_sections` / `_tabs` / `_actions` key on an extended object is an orphan exactly as before. A new pin asserts that surface against the schema, so the sizing cannot silently stop being true.
- **An extension target this stack does not DEFINE is rung 2b of the cross-package ladder**: the object key resolves — the extension is proof the stack means that name — and the subtree is skipped WHOLLY, for the reason rung 2 skips a registered platform object's. The owner's field set is not visible from a package that only extends it, and judging the subtree against the injected names alone would report the owner's own field keys as orphans, which is the same defect one level up.

No schema moved, no export moved, and no accept set moved: this is a lint rule's false-positive set narrowing. `Clause-②: no`
