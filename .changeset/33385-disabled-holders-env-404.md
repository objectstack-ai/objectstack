---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(metadata-protocol): a name only disabled packages hold answers 404 at `_env`, and an environment customization of such a name is hidden until a holder is enabled again

Clause-②: no
Metadata-protocol: none

**`GET /meta/:type/_env/:name`.** When every package that holds the name is disabled, the environment address now answers `404` on both the REST server and the runtime dispatcher, as for a name no package holds. It used to refuse `409 RESOURCE_CONFLICT` and name the disabled packages. It still refuses `409` in two cases: an enabled package holds the name, or a package holds it only through a saved metadata row that the read of the name serves. The environment's own item is still served.

**The read that names no package (`GET /meta/:type/:name`, and the execution read).** An environment-level customization saved without a package, for a name an installed package holds, belongs to that package. When every package holding the name is disabled, the read now answers as if the customization were not saved. That includes a translation the package never shipped, such as an email template's `fr-FR` that only the environment wrote. Before, the read served that customization while the package was disabled. Nothing is deleted: enable the package again and the customization is served again, unchanged. A customization of a name no installed package holds is the environment's own item and is still served.
