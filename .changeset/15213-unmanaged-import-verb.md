---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

`importUnmanagedPackage` copies one package into the environment ledger, editable from then on — the import behind the `unmanaged` install mode (ADR-0131 D6)

Clause-②: yes (widening)

A package installs one of two ways. Managed: the package is the authority, it upgrades, and nothing it ships may be edited. Unmanaged: every metadata item is copied once into this environment, is fully editable, and never follows an upgrade. This release adds the import; no door calls it yet, and no manifest key declares the mode yet.

- **The verb** (`@objectstack/metadata-protocol`). `ObjectStackProtocolImplementation.importUnmanagedPackage({ manifest, targetPackageId?, targetName? })` writes every metadata item of ONE package body into a NEW writable base through the metadata save door: each row is owned by the base, carries no organization, is served as environment-authored (`_provenance: 'org'`), and the next save edits it. The base's id differs from the source (`targetPackageId`, defaulting to `<id>-copy`), it keeps the source namespace so every object name stays valid, and nothing is registered under the source id. The answer names the source, the base, its namespace and every item copied, in write order.
- **All or nothing.** Every refusal that can be judged is raised before the base exists, so a refused import writes nothing: a deployment whose requested tenancy posture walls organizations (`group`, `isolated`, or an unrecognised value); a body carrying what cannot be copied; a malformed name or an unusable target id; a protocol-incompatible package; a target id that names an installed package, or a namespace another package owns (a managed install of the same package included); an item that does not convert to this protocol; a name an environment row or a managed package already holds. A write that fails afterwards deletes the base — its rows and its tables — and the failure is thrown with the item's own code and status, naming the item and what the rollback did.
- **What is copied, and what is refused.** The items of every manifest collection and the assembled `viewItems` are copied. A body carrying a runtime-uncreatable type (`jobs`, `agents`, `apis`, `capabilities`, `picklists`), code (`functions`, `onEnable`, `plugins`, a plugin artifact's `main` / `runtime` / `packaging` / `integrity`), extensions of another package's items (`objectExtensions`, `picklistExtensions`, `navigationContributions`, `contributes`) or an artifact envelope (`packages`) is refused whole; `OS_METADATA_WRITABLE` does not open a type for it. Seed `data` and `translations` are left to the install door, which applies them after the copy as it does for a managed install; deployment configuration (`i18n`, `requires`, `datasourceMapping`, …) is not part of a package install in either mode.
- **Two new error codes** (`@objectstack/spec`, registered to `@objectstack/metadata-protocol`). `UNMANAGED_INSTALL_WALLED_POSTURE` (409) and `UNMANAGED_INSTALL_UNCOPYABLE` (422). Both mean the package can be installed managed instead. A collision, an existing target or an owned namespace answers the standard `RESOURCE_CONFLICT` (409).
- **Two new schemas** (`@objectstack/spec/api`). `ImportUnmanagedPackageRequestSchema` is parsed by the verb, so a request key it does not declare is refused with `400`. `ImportUnmanagedPackageResponseSchema` declares the answer.

Nothing existing changes: no schema, door or code is removed or narrowed.
