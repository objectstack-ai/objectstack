---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(i18n): a tenant's rewrite of a validation rule that an object extension contributes is served as written in every locale, on the refusal and on `/meta` (#27559)

Clause-②: yes (widening) — `SchemaRegistry` (`@objectstack/objectql`) gains the public read `getPackagedObjectBase(name)`
Metadata-protocol: semantic

#27221 made a tenant's reworded rule message beat the package's translation, but only for rules the object's owning package declares. A rule a second package adds through `objectExtensions` was compared with nothing, so when a tenant overlaid the object and reworded that rule, a reader in any locale the extension's bundle carries still got the extension's translation, on the rejected write's error and on the rule `/meta` serves.

- **Now.** A rule's packaged message is the message of whichever code package shipped that rule name: the owner, or a package that extends the object. Both readers compare against that one packaged rule set, so a tenant's rewrite of an extension rule is served and returned as written, and an extension rule the tenant left alone is still translated.
- **The fold is unchanged.** Validations stay additive (ADR-0029 D9.2a): when the tenant's overlay carries its reworded copy of an extension rule, the extension's own rule still runs beside it, and that copy, unchanged, is still translated.
- **`SchemaRegistry.getPackagedObjectBase(name)`** answers the packaged owner's declaration with each code extender's `validations` appended (by reference when no extender ships a rule; `undefined` where `getPackagedObjectOwner` is). Only `validations` widens: `label`, `pluralLabel` and `description` stay the owner's, so an extension's label keeps winning over the owner's catalog. `ObjectStackProtocolImplementation.getPackagedObjectBase` and the rule evaluator's packaged lookup both read it.
- **`@objectstack/spec`**: the `TranslateDocumentOptions.packagedBase` docs say what an object's packaged base now carries. No type or behaviour changes.
