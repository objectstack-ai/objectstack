---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `duplicatePackage` parses an explicit `targetNamespace` through the manifest namespace declaration instead of taking it raw (#19577)

Clause-②: no

`ObjectStackProtocolImplementation.duplicatePackage` (and so `POST /api/v1/packages/:id/duplicate`, which forwards the body's `targetNamespace` verbatim) resolved its target namespace as `request.targetNamespace ?? deriveNamespaceFromPackageId(request.targetPackageId)`. The derived default already had to satisfy the namespace charset; the explicit value crossed no gate at all. That value is written as the copy's `manifest.namespace` and spliced into every copied object name as `${namespace}_${short}`, so `targetNamespace: 'my-ns'` minted `my-ns_ticket` — a name the object declaration (`/^[a-z_][a-z0-9_]*$/`) refuses — under a manifest namespace the manifest declaration refuses.

- **One parse for both branches.** Whichever branch answered, the resolved namespace is now parsed by `ManifestSchema.shape.namespace` (`@objectstack/spec/kernel`) — the declaration itself, by reference, not a copied regex — before the source rows are scanned and before the target package record is minted, so a refusal never leaves an empty shell behind.
- **Refused, not sanitised.** An explicit value the declaration refuses is refused; it is never rewritten the way the derivation sanitises an id, because a copy landing under a namespace the caller did not write is a silent rewrite.
- **The sentence is the declaration's.** The refusal names the key and echoes the value, then carries the declaration's own rule text: `Invalid package namespace 'my-ns' on \`targetNamespace\`. Namespace must be 2-20 chars, lowercase alphanumeric + underscore. …`. The derived branch's refusal (an id whose final segment cannot carry the charset) now carries the same declaration sentence after its `Pass \`targetNamespace\` explicitly.` remedy, replacing a reworded one.
- **No new error code.** Both refusals throw with `statusCode: 400` and no `code`, so an HTTP boundary answers `400 VALIDATION_ERROR`, the status-derived code the derived branch already answered.

**If you are refused:** pass a `targetNamespace` of 2–20 characters that starts with a lowercase letter and continues with lowercase letters, digits or underscores (`leave_copy`, not `leave-copy`), or omit it and let the door derive one from `targetPackageId`. Every conforming value duplicates exactly as before.
