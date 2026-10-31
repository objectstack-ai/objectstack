---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
---

fix(studio): object pickers offer only the objects the edited package may reference

Clause-②: no
Metadata-protocol: none

A package may reference only the objects inside its closure: its own, those of the packages it declares as dependencies (transitively), and the platform's. The publish gate refused anything else, but Studio's object picker (a record trigger's object, a flow node's object, a lookup's related object, a new dataset's object) offered every object, so the author found out only after building on one.

The picker now offers the closure. Objects outside it are listed last, disabled, in a group that starts collapsed, under the reason and a **Declare a dependency** entry that opens the package's edit dialog when the package is writable. A dependency declared there re-reads the closure, and the object becomes pickable without a reload. Where the package list cannot be read, nothing is disabled and the server judges the pick, as before. The value stays free text: a name typed and committed with Enter is still saved as typed and judged by the server.

`@objectstack/lint` exports `resolvePackageClosure(packageId, getPackage)`, the dependency walk the publish gate ran inline. `@objectstack/metadata-protocol`'s gate now calls it; what the gate admits is unchanged. Studio calls the same function over `GET /api/v1/packages`, and `narrowObjectsToPackageClosure` over the object list, so the picker and the gate cannot disagree.
