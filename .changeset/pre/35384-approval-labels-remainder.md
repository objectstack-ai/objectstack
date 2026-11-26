---
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-audit': patch
---

fix(approvals,audit): an approval's flow and position labels, and a renamed object's label in approvals and activity summaries, read as the metadata translators serve them

Clause-②: no
Metadata-protocol: none

In a deployment whose `i18n.sourceLocale` differs from its `i18n.defaultLocale` (an app authored in English that defaults its users to Chinese, say), the approvals door still looked up a request's flow label (`flows.<flow>.label`) and a position's label (`positions.<name>.label`) through `II18nService.t()`, which falls back to the `defaultLocale` row when the reader's locale has no entry. So an `en` or `en-US` reader saw the Chinese flow name on the inbox, the request page and the generic data door's request rows, and the Chinese position name in a timeline note, where the authored text was expected. Both labels now resolve through the spec translators of their types (`translateFlow`, `translatePosition` from `@objectstack/spec/system`) over every locale the i18n service holds. They use the resolve options the metadata route builds: the reader's locale, the declared fallback chain, and the authored language (the declared `sourceLocale`, else `defaultLocale`). A reader in the authored language now reads the label as written, and every other reader reads the same row as before.

A packaged object renamed by a code extension was named in the reader's language by the bundle's translation of its OLD label. This hit the approvals inbox, request page and object-naming refusals, and the object label inside an activity summary, where `GET /meta/object` serves the rename. Both readers now hand `translateObject` the object's served definition and its packaged base (`packagedBase`, read off the engine's registry through `getPackagedObjectBase`, the base `/meta` reads). So the rename stands in every locale, as on `/meta`, and an unrenamed object reads its translation as before.

An approval step's label (`flows.<flow>.approvals.<node_id>.label`) is still read through `t()`: no spec translator reads that key yet.
