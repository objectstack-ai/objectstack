---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: `POST /api/v1/marketplace/install-local` parses the manifest `namespace` through its declaration, as it already parses the id

Clause-②: no (narrowing)
Metadata-protocol: none (the declaration `ManifestSchema.shape.namespace` already refuses these values; this door now enforces it. The dev confirms against the diff.)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The install door now refuses a namespace `ManifestSchema.shape.namespace` already refuses everywhere else, `defineStack` and `objectstack build` included; no stored row, ledger entry or authored value is rewritten (an entry an older build ledgered still rehydrates), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller of the install-local door whose package declares a `namespace` the manifest declaration refuses: anything but 2–20 characters of lowercase letters, digits and `_` opening with a lowercase letter.

- FROM: an inline manifest declaring `namespace: ''`, `'QA_N'` or `'9-Bad Ns!'` answered `200`, was registered and ledgered under that namespace, and `QA_N` installed beside an existing owner of `qa_n` without the install-time namespace gate answering. TO: it answers `400 PLUGIN_MANIFEST_INVALID` with the declaration's own sentence and nothing is registered, synced or written.
- FROM: an inline manifest declaring `namespace: null` or a non-string `namespace` was admitted, the key unparsed (a `null` read as no namespace). TO: it answers the same `400 PLUGIN_MANIFEST_INVALID`; only an absent key means no namespace.
- FROM: a cloud-fetched snapshot declaring such a namespace installed the same way. TO: it answers `502 PLUGIN_MANIFEST_INVALID`, the status the door already gives an invalid upstream snapshot.

**Not moved.** A manifest whose `namespace` key is absent installs as before (the key is optional). A member of a multi-package artifact declaring such a namespace keeps the artifact-entry refusal it already had (`INVALID_ARTIFACT_PACKAGE_ENTRY`, 422). A conforming namespace installs as before, and one another package owns still meets the registry's own namespace gate. A package an older build already installed under such a namespace still rehydrates at boot and can still be uninstalled; it cannot be re-installed until its namespace conforms.

The fix for a caller: declare the namespace in lowercase snake form (`qa_n`, not `QA_N`), or omit it.
