---
'@object-ui/app-shell': patch
---

fix(app-shell): the curated page, report and dashboard inspectors name a select's options in Chinese under zh-CN

Clause-②: no
Metadata-protocol: none

Under zh-CN the page Type and Record action selects and the report and dashboard Default Period selects listed English choices beside Chinese labels. The console's `metadataForms` overlay now carries those four rows' option names in the `options` slot `resolveMetadataFormLabels` reads, copied from the platform's zh-CN pack (`zh-CN.metadata-forms.generated.ts`, the one `/api/v1/meta/types` localizes the same forms with) and pinned byte-equal to it. The console-side Default Period renaming (`default-period-labels.ts`) is retired: the overlay names those options now, in the same words the report and dashboard period chip shows. Every other designer locale keeps the spec's English, as before.
