---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a name only disabled packages hold answers 404 at `_env`, and an environment customization of such a name is hidden until a holder is enabled again

Clause-②: no
Metadata-protocol: none

**`GET /meta/:type/_env/:name`.** When every package that holds the name is disabled, the environment address now answers `404`, as for a name no package holds, on both the REST server and the runtime dispatcher. It used to refuse `409 RESOURCE_CONFLICT` and name the disabled packages. With an enabled holder it still refuses `409` naming that holder, and the environment's own item is still served.

**The read that names no package (`GET /meta/:type/:name`, and the execution read).** An environment-level customization saved without a package for a name an installed package holds belongs to that package. When every package holding the name is disabled, the read now answers as if the customization were not saved. This also covers a translation the package never shipped, such as an email template's `fr-FR` that only the environment wrote. Before, the read served that customization while the package was disabled. Nothing is deleted. Enable the package again and the customization is served again, unchanged. A customization of a name no installed package holds is the environment's own item and is served as before.
