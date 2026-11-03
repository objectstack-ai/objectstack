---
'@objectstack/objectql': patch
---

fix(objectql): an object extension whose `extend` folds to a legacy `ns__name` key is filed under that key, and never opens a second, owner-less object entry (#28858)

Clause-②: no — no accept set moves and nothing is exported; an extension that already registered now lands on the object it names. Measured reach: no package or example in this repository or in hotcrm spells an `extend` that folds.
Metadata-protocol: none

`getObject` reads a short name as a legacy `<ns>__<name>` key when that is the only object it can mean (an object a package still ships as `crm__case`, which `ObjectSchema` accepts). The registry used to file an extension under the name it is written with. So a manifest `objectExtensions` entry or a stored `object_extension` row with `extend: 'case'` opened a second entry, `case`, with no owner, beside `crm__case`. Its fields reached no read of the object, and nothing checked the entry.

- **Now.** Every entry that registers an extension (the manifest loop and the stored row's hydration, both through `registerObject`) files it under the key `getObject` reads its `extend` as. The fields land on `crm__case`, and no `case` entry opens. The spelling is named once per spelling and package at `warn`, with the key to write.
- **Never a boot refusal.** The manifest loop and the hydration run while packages are still registering. The `object_extension` item door keeps refusing the folded spelling at save (#28834).
- **Unchanged.** An `extend` spelled with the registered key, or naming an object registered under that exact name, registers as before, with no line. `computeFQN` and `parseFQN` are untouched. A legacy owner that registers after the extension is not yet there to fold to, so that extension is filed as written, as before.
