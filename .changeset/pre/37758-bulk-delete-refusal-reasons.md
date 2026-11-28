---
'@object-ui/core': patch
'@object-ui/i18n': patch
'@object-ui/plugin-view': patch
---

fix(core): a list bulk Delete with refused records says why, not only "0 deleted, 4 failed"

Clause-②: no
Metadata-protocol: none

The built-in bulk Delete deletes each selected record and reports one summary toast. When records were refused (a restrict delete, a lock, a permission), the toast gave only the two counts and dropped each refusal's reason, which the one-record Delete shows. The summary keeps its counts, and its description now lists the reasons: one line per distinct reason, led by the names of the records it refused (up to three names, then `+N`), at most three reasons and then "And N more". An external datasource's refusal reads as the read-only sentence, as the one-record toast reads it. A refusal with no message adds no line, so a batch with no reason keeps the bare count. The one-record toast is unchanged. Two keys are added to every locale pack: `objectActions.bulkDeleteRefusedNamed` and `objectActions.bulkDeleteMoreReasons`.
