---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `duplicatePackage` reports a refused install of the copy's package record, on its answer and in the log

Clause-②: no

- **What was silent.** The duplicate installs the copy's package record before it copies the items, and a refusal of that install was caught and dropped. A refused install leaves no registry record and no `sys_packages` row, so the copy's id was not an installed package (absent from `GET /packages` at once, not only after a restart) while every copied item was bound to it, and the answer read `success: true` with an empty `failed[]`. Nothing was logged. It is reached whenever the copy's namespace is one another installed package owns (`NAMESPACE_CONFLICT`, 422): an explicit `targetNamespace`, or one derived from a target id whose last segment another package's namespace already uses. A failed `sys_packages` write fails the install the same way.
- **The answer now names it.** One `failed[]` entry `{ type: 'package', name, error }`, where `name` is the source package id (the source's package item, which the clone could not copy). Its `error` names the target id and quotes the refusal when the refusal declares a client status, so a namespace conflict arrives with its own remedy. A store fault is not quoted. The duplicate's `success` is therefore `false` and `failedCount` counts the entry; the HTTP status stays 200, so a consumer reading `data.success` now sees a partial duplicate.
- **The log now names it.** One `warn` line from `[protocol.duplicatePackage]` names the target id and the source id, then the refusal's code and full message, store faults included.
- **Unchanged:** the duplicate still copies the items after a refused install; the response's shape; every other `failed[]` entry.
