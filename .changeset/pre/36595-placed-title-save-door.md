---
'@objectstack/metadata-protocol': patch
'@objectstack/spec': patch
---

fix(metadata-protocol): a tab a code package places, or a field it adds, is saved in its source text from a translated read

Clause-②: no
Metadata-protocol: none

The `/meta` read of an object serves a related-list tab that another installed code package places into the object's `relatedLists` (its `place`), and a field such a package adds, translated for the caller's language. When the object has a stored customization row saved before that package was installed, the row carries no copy of either. A save of that translated read in a language other than the source (the whole body sent back through `PUT /meta/object/NAME`) then had nothing to compare them with, so the translation was stored as the tab title or the field label, and every other language read it from then on.

The save door now compares them with the packaged definition as a last resort: a tab whose `list` the owning package does not name, or a field the owning package does not declare, that the stored row does not declare at all, is compared with what the packaged definition carries, and its translation is stored as that source text. The save answer names each such slot in `advisories` (`translated-label-echo`), as it does for every other restored label. A title or label the stored row does declare is never compared with the packaged definition, so a customer's own rename keeps its text, even when it equals some language's catalog entry. A tab or field the owning package declares and the stored row dropped is left as the body carries it.

Console and Studio editors already save the stored document rather than the translated read, so they never reached this; a client that saved the translated read back did.

`TranslateDocumentOptions.packagedBase` now says that an object's packaged definition carries the tabs a code package places, and that a placement is judged on the owning package there but on the customization row by the served object: where only a customization row declares `relatedLists`, the placed tab has no packaged counterpart and the deployment catalog does not translate its title.
