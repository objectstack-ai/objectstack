---
'@objectstack/objectql': patch
---

fix(objectql): the object fold names, once, a field that two contributors declare in `fields`, and which definition it serves (#28835)

Clause-②: no
Metadata-protocol: none

The registry fold every object read serves (`getObject`, the by-name and layered reads through `foldObjectExtendersOnto`, the code layer) merges each extension's `fields` by spreading them. So when two extensions of one object both declare a field name, or an extension's `fields` redeclares a field the owner declares, the last contribution the fold applies is served: extensions fold in ascending `priority`, and at equal priority the one registered last wins. Nothing said so. This is reachable from two vendor dependents, from two `.custom` pairs where one base depends on the other, and, since the `object_extension` item door, from Studio.

- **Now.** The first time a fold sees such a field, it writes one `console.warn` line per object, field and set of declaring packages. The line names the object, the field, every declaring package in fold order (the owner first when it declares the field), and the package whose definition is served. Repeated reads in one registry do not repeat it; a second registry says it again. It sits beside the existing line for a field patch that misses its target, in the same style.
- **Unchanged.** The served definition, byte for byte: the same winner as before. No door refuses anything new, and `os validate` and the save and publish doors are not touched.
- **Not counted.** `fieldPatches` entries (they are patches, not declarations, and a patch that misses is already named). A `.custom` pair's `__c` field never shares a name with a dependent's plain field, so the two never meet here.
- **Docs.** `content/docs/data-modeling/object-extensions.mdx` no longer says nothing warns.
- **Measured.** No shipped package or example declares the same field from two extensions, or redeclares an owner field in an extension's `fields`: the two shipped `objectExtensions` entries (`examples/app-showcase` on `showcase_account`, `plugin-auth` on `sys_sso_provider`) each add fields the owner does not declare, and HotCRM declares none.
