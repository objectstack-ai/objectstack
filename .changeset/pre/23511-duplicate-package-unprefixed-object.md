---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `duplicatePackage` copies an object whose name lacks the source namespace prefix into the target namespace, and a copied reference follows it

Clause-②: no

`duplicatePackage` (ADR-0070 D4, the package duplicate route's method) renames every copied object into the target namespace, because an object's name is its registry key and its table name, so a same-name copy is a second claim on the source's object.

**FROM.** Only a name that starts with the source prefix was renamed (`crm_account` → `crm2_account`). An object whose name lacks it (`ticket`, stored by a direct publish-mode save, which no prefix gate reads, or bound to a package that had no namespace) kept its name. The copy then failed: it was listed in `failed[]` with the object-ownership refusal ("bind the customization to 'com.acme.crm', or have 'com.acme.crm2' extend the object instead"), which names no way out for a duplicate. Before that refusal existed, the same object was listed in `copied` while the registry refused the target row, and the copy sat over the source's table. Every copied item that referenced it (a lookup `reference`, a view's `object`, a flow node's `objectName`) still named the source's object.

**TO.** Such an object is copied as `<target namespace>_<name>` (`ticket` → `crm2_ticket`), the rename the namespace-prefix rule itself prescribes (ADR-0129 D2), with its own registry entry and its own table. Every reference to it is rewritten where a property names an object, and only when the value is exactly the object's name. A field that happens to be called `ticket`, and the word in a label or description, are left unchanged. When that target name is already taken (the source also holds `crm_ticket`, whose copy is `crm2_ticket`, or the source holds an object of that name), the object is listed in `failed[]` before anything is written for it. The entry names the object, the name it would take and who holds that name, and says to rename the object on the source.

**Also.** A map keyed by object name (a permission set's `objects`, a translation's `objects`) now has its keys follow the copied objects, prefixed names included. So the duplicate's permission set grants on the duplicate's objects. Before, it kept the source's names and granted on the source.

**Unchanged.** A prefixed object's copy name, a non-object item's name, and every other `failed[]` cause are unchanged.
