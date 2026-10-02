---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a view container with a bare `list`, saved for an object another package ships, no longer replaces that package's `<object>.default`

Clause-②: no

- **What was wrong.** A runtime view container whose `list` names no key expands that list to `<object>.default`. Saved under another name, in another package or in none, for an object a code package ships, the expansion replaced that package's `<object>.default` on `GET /api/v1/meta/view?object=<object>`: the container's columns, still stamped with the shipping package's `_packageId` and `_provenance: 'package'`. On an environment-scoped kernel the by-name read `GET /api/v1/meta/view/<object>.default` kept the packaged view, so the two reads disagreed. On an unscoped kernel the by-name read served the replacement too, for a container saved into a package or environment-wide.
- **What it does now.** For an object a code package ships, the bare `list` of a container that belongs to another package, or to none, expands under the container's own name, `<object>.<container name>`. Both reads of `<object>.default` answer the packaged view, unchanged.
- **What the renamed view carries.** The container's own package as `_packageId` (none for a package-less container), and no other package's `_provenance` or protection envelope.
- **What stays.** These still expand their bare `list` to `<object>.default`: a container bound to the package that ships the object, a package-less overlay of that package's own container saved under that container's name, and a container on an object no code package ships. A `list` that names its own key, `listViews`, `form` and `formViews` expand under the same names as before. A write to `<object>.default` by its own name still overrides it on both reads.
- **What changes for a caller.** Such a container's default list is now listed as `<object>.<container name>` instead of `<object>.default`. A navigation `viewName` or a form-action `target` that named `<object>.default` to reach that container's list now reaches the shipping package's view; name `<object>.<container name>` instead.
