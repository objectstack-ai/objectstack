---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a view container saved for an object another package ships no longer replaces that package's views or its default

Clause-②: no

- **What was wrong.** A runtime view container expands each member to `<object>.<key>`. A `list` that names no key becomes `<object>.default`, a `form` becomes `<object>.form`, and every member that names a key uses that key. Saved under another name, in another package or in none, for an object a code package ships, those expansions replaced that package's views of the same names on `GET /api/v1/meta/view?object=<object>`. The replacements were still stamped with the shipping package's `_packageId` and `_provenance: 'package'`.
  - On an environment-scoped kernel, the by-name read `GET /api/v1/meta/view/<name>` kept the packaged view, so the two reads disagreed.
  - On an unscoped kernel, the by-name read served the replacement too, for a container saved into a package or environment-wide.
  - The container's own default kept `isDefault: true`. It either replaced the object's default view or stood beside it as a second list default.
- **What it does now.** For an object a code package ships, a container that belongs to another package, or to none, expands every member under its own name:
  - a `list` that names no key becomes `<object>.<container name>`;
  - every other member becomes `<object>.<container name>.<key>`. That covers a `list` that names its key, each `listViews` and `formViews` entry, and `form`.

  None of these views carries `isDefault`. Every name the shipping package serves answers its packaged view on both reads, unchanged, and the only `isDefault` views the object lists are the shipping package's.
- **One exception.** When the shipping package itself serves `<object>.<container name>` (a container named after one of that package's keys), the container's default list becomes `<object>.<container name>.<container name>` instead.
- **A container with no name of its own** expands nothing on such an object.
- **What these views carry.** The container's own package as `_packageId` (none for a package-less container), and no other package's `_provenance` or protection envelope.
- **What stays.** Three kinds of container expand exactly as before, `isDefault` included:
  - a container bound to the package that ships the object;
  - a package-less overlay of that package's own container, saved under that container's name;
  - a container on an object no code package ships.

  A write to `<object>.default` by its own name still overrides it on both reads.
- **What changes for a caller.** Such a container's views are now served under new names:
  - its default list as `<object>.<container name>`, instead of `<object>.default`;
  - each keyed member as `<object>.<container name>.<key>`, instead of `<object>.<key>`.

  A navigation `viewName` or a form-action `target` that used an old name to reach one of these views now reaches the shipping package's view. Use the new name instead.
