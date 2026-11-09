---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio on a zh-CN console reads in Chinese in the view, page and report panels, the publish sheet, the flow Problems tab and the save-notice / notify nodes, and calls a dashboard 仪表盘 everywhere

Clause-②: no
Metadata-protocol: none

The view, page and report property panels render the spec's authoring forms from the console's own copy of the spec, and only the dashboard form had a zh-CN overlay, so section headings such as Basics, Columns & filters and Navigation & sharing, their descriptions and schema-titled rows such as Searchable Fields read in English. The overlay now carries every `METADATA_FORM_REGISTRY` type, worded as the platform's own zh-CN metadata-forms bundle words them: view, page and report in full, the other types by field label, which is what the Pending changes sheet names a changed property by (a flow's `~ Status` now reads `~ 状态`). The sheet's summary line counts datasets as 数据集 instead of the raw type name.

A flow whose trigger is not armed on this deployment showed the engine's developer sentence under 未在此运行, above 没有问题 —— 该流程结构有效. The note now says, from the engine's `unboundCause` code, what this deployment does not do and who can change it, keeps the engine's sentence as the hover detail, and the line below it says the structure checks found nothing to fix instead of "no problems". A cause the console has no row for still shows the engine's sentence.

The palette names the save-notice node 保存提示, and the notify node's Template and Template data fields and the save-notice Message field read in Chinese. English consoles read the same English as before. zh-CN Console and Studio text uses 仪表盘 for dashboard throughout.
