---
'@objectstack/spec': patch
---

fix(spec): the stored pass reads a stored `object_extension` row as an `objectExtensions` entry, so conversions replay over it and `os migrate meta --stored` lists a `fieldPatches` key no field name can be

Clause-②: no (no accept set moves; the stored pass and the `--stored` listing widen)

Metadata-protocol: none

`applyConversionsToStoredItem` wraps a stored row in the stack collection its type maps to, and returned a row untouched when its type mapped to none. `object_extension` (ADR-0146 D10) mapped to none, so no conversion that walks `objectExtensions` ever ran over a stored extension row at a rehydration seam, and no refused-shape detector could list one: `os migrate meta --stored` read every stored extension as already on protocol.

- **Now.** A stored `object_extension` row is read as one `objectExtensions` entry, beside `translation` in the stored-only map; the manifest-collection maps still carry no `objectExtensions`, because a stack's extensions merge into their targets rather than registering as named items. A stored extension with a `time` default written with a `Z` suffix, for example, is now served without it, with the conversion's notice, as an object row already was.
- **Listed.** `os migrate meta --stored` lists each `fieldPatches` key the extension's own parse refuses as no field name (`Industry`, `Annual Revenue`, `annual-revenue`): one TODO at `fieldPatches.KEY` under the row, naming the extended object, leaving the row as stored. Rename each listed key to the field it meant before upgrading. The upgrade guide entry `object-extension-field-patch-key-grammar-refused` says so instead of naming a manual check.
- **Unchanged.** A canonical extension row passes through by reference, every other row type converts exactly as before, and no schema accepts or refuses anything it did not.
