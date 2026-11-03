---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's publish review sheet no longer lists an `Options` change on a picklist-bound field nobody edited (#29899)

Clause-②: no
Metadata-protocol: none

On an object with a field bound to a package picklist (`{ type: 'select', picklist: 'NAME' }`), the publish review sheet listed `~ FIELD · Options` on every publish, beside the change the author actually made. The draft is stored without the field's `options`, while the live read serves the options the runtime resolved from the picklist, and the sheet compared the two as read.

The sheet now compares both versions of an object in the form the publish door stores: a field that names a picklist is read without `options` on both sides. A field with its own inline `options` is untouched, so a real options change there is still listed, and a field moved between a picklist and inline options still lists both keys.
