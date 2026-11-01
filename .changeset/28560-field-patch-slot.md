---
'@objectstack/spec': minor
---

feat(spec): an object extension can carry a per-field display patch (`fieldPatches`), its keys derived from `BASE_FIELD_DISPLAY_WHITELIST`; not applied yet

Clause-②: yes (widening)
Metadata-protocol: added

ADR-0146 D10's second rule: a customer changes a vendor field's display properties without taking the field over, so the field's type, values and rules stay the vendor's and the vendor's next version still applies. `ObjectExtensionSchema` gains one optional key for it:

```ts
objectExtensions: [{
  extend: 'crm_account',
  fieldPatches: {
    industry: {
      label: 'Sector',
      inlineHelpText: 'The market the account sells into',
      options: { tech: { label: 'Technology' } },
    },
  },
}]
```

- **Keys.** A patch takes the field keys of `BASE_FIELD_DISPLAY_WHITELIST.field` (`label`, `description`, `inlineHelpText`, `placeholder`) plus `options`, a map from an option's stored `value` to that option's patch, which takes the keys of `BASE_FIELD_DISPLAY_WHITELIST.option` (`label`). Both sets are read from the constant: widening the whitelist widens the slot.
- **Refused at parse, each with a prescription.** Every other field key (`type`, `required`, `unique`, `reference`, `defaultValue`, `expression`, …) and every other option key (`color`, `default`, …) is refused by name, naming the whitelist and stating that it stays the vendor's (ADR-0146 D6). An option's `value` is refused: the option is addressed by it, and it cannot be renamed. A field's option list under `options` is refused as membership. A key spelled as an extension field (`region__c`) is refused with "declare it in `fields`; it is your own field".
- **Pure shape.** Whether the target object has the field or the option, and who may patch it, are the server's to judge.
- **Not enforced yet.** The slot's description reads `[EXPERIMENTAL — not enforced]`. The engine's extension registration does not carry the key, so a patch is parsed and then dropped until the registry merge applies it (ADR-0146 rollout card N-23d). Nothing reads it before then.

An extension without `fieldPatches` parses exactly as before.
