---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/cloud-connection': patch
---

feat(metadata-protocol,cloud-connection): an unmanaged install can take a target namespace

Clause-②: yes (widening)
Metadata-protocol: added

- **An unmanaged copy can be installed under a namespace of its own.** `importUnmanagedPackage` and `POST /api/v1/marketplace/install-local` (with `installMode: 'unmanaged'`) take an optional `targetNamespace`. The copy's base takes it as its `namespace`, every copied object name takes it in place of the package's (a name without the package's prefix takes it in front), and every reference to a renamed name follows. Absent, the copy keeps the package's namespace exactly as before.
- **One rename, two doors.** The copy is renamed by the rules `duplicatePackage` already applies, now one function both doors call: view items and view containers follow their object, translations are named `<targetNamespace>_<locale>` with the object keys inside them renamed, a field keeps its key, and free text is renamed only at a whole prefixed object name.
- **Refused before anything is installed.** A `targetNamespace` the `manifest.namespace` rule refuses, or a platform-reserved one (`base`, `system`, `sys`), answers `400 INVALID_REQUEST`. So does a copy the names cannot make: an object whose copy name another object's copy takes, a copy name that is not a legal item name or is longer than its storage allows (63 characters for an object's table, 255 for an item name), and a renamed key that meets a key the item already holds — each item named. The same-name check (`409 RESOURCE_CONFLICT`) is judged on the renamed names, and a `targetNamespace` another package owns is refused `409`.
- **A managed install is never renamed.** `targetNamespace` beside a managed install (or no `installMode`) answers `400 INVALID_REQUEST` before anything is fetched.
- **The rename is recorded.** The import's answer carries `sourceNamespace`, and the install-local answer's `installedFrom` carries the package's own `namespace` beside its id and version. Neither appears when the copy kept the package's namespace.
- **A bare object's view container follows it on a duplicate too.** A view named by an object of the package takes that object's copy name, so `duplicatePackage` no longer leaves a bare object's container under the name the source's container holds.
