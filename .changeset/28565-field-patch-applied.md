---
'@objectstack/objectql': minor
'@objectstack/metadata-core': minor
'@objectstack/cloud-connection': minor
'@objectstack/cli': minor
'@objectstack/spec': minor
---

feat(objectql): an object extension's `fieldPatches` is applied on every object read; a patch naming a field or option its target lacks is refused at install and by `os validate`

Clause-②: no
Metadata-protocol: semantic

ADR-0146 D10's second rule, live. The per-field display patch an object extension declares (`objectExtensions[].fieldPatches`, added unenforced in the previous release) now reaches the screen:

```ts
objectExtensions: [{
  extend: 'crm_account',
  fieldPatches: {
    industry: { label: 'Sector', inlineHelpText: 'The market the account sells into', options: { tech: { label: 'Technology' } } },
  },
}]
```

- **Applied, never carried.** The engine's extension registration carries the slot, and the registry merge (`mergeObjectDefinitions`) applies it after the additive merges: the `BASE_FIELD_DISPLAY_WHITELIST` keys (`label`, `description`, `inlineHelpText`, `placeholder`) onto the named field, and `label` onto each option addressed by its stored `value`. The field's type, requiredness, options and values stay the owner's. The list read, the by-name read and the layered view serve the same text, and uninstalling the extension serves the owner's text again.
- **Precedence.** A key the tenant has edited keeps the tenant's text (ADR-0029 D9.2a, as for an extension's object `label`). Two extensions patching one key: the higher `priority` wins.
- **Refused when it names nothing.** A patch naming a field the target does not have, an option value its field does not have, or an option of a picklist-bound field is refused at `POST /api/v1/marketplace/install-local` (`400 VALIDATION_ERROR`, every refusal located in `error.details.refusals`, nothing installed) and by `os validate` when the target is in the same stack. At boot such a patch is not applied and is named once in the log; the boot carries on.
- **New export.** `@objectstack/metadata-core` exports the one judge the three readers share: `fieldPatchTargetMisses`, `fieldPatchTargetRefusals`, `fieldPatchTargetRefusalMessage`.

What changes for an existing package: a package that declared `fieldPatches` since the slot landed now sees them applied, and one whose patch names a missing field or option is now refused at install. An extension without `fieldPatches` folds exactly as before.
