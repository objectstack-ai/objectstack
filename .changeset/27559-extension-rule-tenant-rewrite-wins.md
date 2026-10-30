---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

fix(i18n): a tenant's rewrite of a validation rule that an object extension contributes is served as written in every locale, on the refusal and on `/meta` (#27559)

Clause-②: yes (widening) — `SchemaRegistry` (`@objectstack/objectql`) gains the public read `getPackagedObjectBase(name)`
Metadata-protocol: semantic

#27221 made a tenant's reworded rule message beat the package's translation, but only for rules the object's owning package declares. A rule a second package adds through `objectExtensions` was compared with nothing, so when a tenant overlaid the object and reworded that rule, a reader in any locale the extension's bundle carries still got the extension's translation, on the rejected write's error and on the rule `/meta` serves. The fold also served the rule twice: the overlay's reworded copy, then the extension's original appended beside it.

- **Now.** A rule's packaged message is the message of whichever code package shipped that rule name: the owner, or a package that extends the object. Both readers compare against that one packaged rule set, so a tenant's rewrite of an extension rule is served and returned as written, and an extension rule the tenant left alone is still translated.
- **The overlay's copy takes the rule's place.** When a tenant overlay carries a rule of the same name as an extension's rule, and the owning package does not declare that name itself, the fold serves the overlay's rule once instead of appending the extension's original beside it. A Studio edit of an extended object stores every extension rule it was served, so this is the tenant's own copy. An owner rule and an extension rule that share a name are still both served, as before.
- **`SchemaRegistry.getPackagedObjectBase(name)`** answers the packaged owner's declaration with each code extender's `validations` appended (by reference when no extender ships a rule; `undefined` where `getPackagedObjectOwner` is). Only `validations` widens: `label`, `pluralLabel` and `description` stay the owner's, so an extension's label keeps winning over the owner's catalog. `ObjectStackProtocolImplementation.getPackagedObjectBase` and the rule evaluator's packaged lookup both read it.
