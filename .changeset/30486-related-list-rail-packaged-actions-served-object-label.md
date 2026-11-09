---
'@object-ui/core': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(plugin-detail,app-shell): the related list, the reference rail and the packaged-actions table name a renamed object by the name the server serves

Clause-②: yes (widening)
Metadata-protocol: none

- **The surfaces.** A `record:related_list` block and a `record:reference_rail` card with no authored `title` are headed with the related object's served plural label, else its served label, as the server translated it for the session (a `.custom` extension's rename included). They used to ask only the client translation bundle, which still held the base package's name. The bundle is asked only when the server serves neither.
- **Packaged actions.** Setup → Packaged Actions reads the object list in the session's language (`Accept-Language`), not the browser's, and its Object column draws that served label as given.
- **The widening.** The served-object-label rule now lives in `@object-ui/core`, which `@object-ui/plugin-detail` can import: new exports `servedObjectLabel`, `servedObjectPluralLabel`, `metadataText` and the types `ObjectLabelLookup` and `ObjectPluralLabelLookup`. app-shell's internal copy is now a re-export of these, so both packages read one rule.
