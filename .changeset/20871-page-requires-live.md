---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

`page.requires` says what the runtime now does with it: refused at save, reported at load (ADR-0080 §5).

Clause-②: no

The key's description used to say the list is "validated at save and load" while the liveness ledger recorded it as not enforced yet. Both are now true and say so. On a server that has the deployment's SDUI component manifest, saving a `kind: 'html'` page compiles its source, refuses a written `requires` that disagrees with it (`422 INVALID_METADATA`, `page-requires-disagrees-with-source`; a draft at its publish) and stores the derived list. At load, a stored page whose list names a plugin no manifest component carries is reported and still served. A server with no manifest checks neither and says so once at boot. Omit `requires`: it is derived from the source. The liveness row moves from `planned` to `live`, and the generated page reference carries the new description.

`validateJsxPages`' reason for staying off the runtime publish gate no longer says it parses through `typescript`/`sucrase`. It parses with the dependency-free `@objectstack/sdui-parser`, and it stays CLI-only because the save door already runs that compiler on every html page. The `ui-html-page-div-refused` upgrade-guide entry now names that save door too: on a server with a manifest, a `div` page saved from Studio or through the metadata API is refused under the same rule ids.

No schema accepts or refuses anything it did not before, and no runtime behaviour changes.
