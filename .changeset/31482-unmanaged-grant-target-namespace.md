---
'@objectstack/cloud-connection': patch
'@objectstack/plugin-audit': patch
---

fix(cloud-connection)!: a hosted unmanaged install copies into the namespace the control plane's grant names, and `target_namespace` beside a managed install is refused

Clause-②: yes (narrowing) — `POST /api/v1/cloud-connection/install` gains an optional `target_namespace` (or `targetNamespace`) beside an unmanaged install, forwarded to the control plane and, as the grant echoes it, to the install-local door's copy; the same key beside a managed install (or no `install_mode`), which the route ignored until now, is refused 400, as are the two spellings naming different values.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row is rewritten. What moves is the answer an HTTP request gets: an install request that names target_namespace beside a managed install is refused where it was ignored, and nothing at rest holds that request, so there is nothing for a migration to rewrite. -->

**BREAKING.** `POST /api/v1/cloud-connection/install` used to ignore a `target_namespace` or `targetNamespace` key. Beside a managed install, or with no `install_mode`, either spelling is now refused `400 INVALID_REQUEST` with the install-local door's own sentence, before the control plane is asked: a managed install is never renamed, so a request that names a namespace for one is asking for something that cannot happen. A body that names both spellings with different values is refused `400 INVALID_REQUEST` naming both. No first-party caller sends either key today: the Console's marketplace, the CLI and `@objectstack/client` hold none. To fix a request that is refused, drop the key, or send `install_mode: 'unmanaged'` to take a copy under that namespace.

What the key does beside an unmanaged install:

- It is read in either spelling, `target_namespace` (the control plane's) or `targetNamespace` (the install-local door's), as the route reads `install_mode` / `installMode`. It is trimmed, then parsed by the manifest's own `namespace` declaration, and a value it refuses is `400 INVALID_REQUEST` with `details.targetNamespace`, before the control plane is asked. Otherwise it is sent to the control plane's install request as `params.target_namespace`.
- The copy takes the namespace the grant names in `data.target_namespace`, handed to the install-local door as `targetNamespace`. The grant governs it: a namespace in the caller's body never reaches the door on its own. A grant that names a namespace when none was asked passes it through too.
- A request that asked for a namespace the grant does not echo (none, or a different one) copies nothing and answers `502 PLUGIN_INSTALL_FAILED`, audited in the environment like the other grants this door cannot read. Copying into the source's namespace instead would not be what was asked. The audit row (`@objectstack/plugin-audit`'s `package_unmanaged_import`) records both namespaces in its metadata, as `requested_namespace` and `granted_namespace` (null when the grant named none); no other row carries the two keys.
- With no ask and no echo, nothing changes: the copy keeps the source's namespace.
- What the door says about the name itself keeps its own answer on this path: a namespace another package owns is `409 RESOURCE_CONFLICT` with `details { namespace, owners }`, and a reserved name, or one the copied names cannot take, is `400 INVALID_REQUEST` with `details.targetNamespace`.

Cross-repo, not measured here: the control plane's spelling (`params.target_namespace` in, `data.target_namespace` echoed) is cloud PR #4206's. Until the control plane echoes it, an unmanaged install that names a namespace answers the `502` above, and nothing is copied.
