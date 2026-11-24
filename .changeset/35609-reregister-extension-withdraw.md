---
'@objectstack/objectql': patch
---

fix(objectql): a package registered again stops serving an object extension its new manifest no longer declares

Clause-②: no
Metadata-protocol: none

When a package was registered again without uninstalling it first (an `os dev` artifact reload, or an upgrade or re-install through the marketplace install-local door) and its new manifest no longer carried an `objectExtensions` entry for an object the previous registration extended, the old extension stayed registered. Its fields, validations and indexes kept being served on that object until the process restarted. A package's previous extension of an object was replaced only when the new manifest named that same object again.

A re-registered package body now withdraws each extension its previous body registered for an object the new body no longer extends, through the same per-object withdrawal the `object_extension` item delete uses. The object then serves exactly the extensions the package's current manifest declares. Another package's extension of the same object is untouched, and so is an extension registered under the package id outside a body (the `object_extension` item door's layer). A refusal later in the same registration run puts the withdrawn extension back with the rest of the installed version.

Stored data is not touched: the column the dropped field used keeps its values, and schema sync drops no column. The field is simply no longer served. The install-local dry run already listed the dropped field under `plan.fields.removed`; that answer is unchanged.
