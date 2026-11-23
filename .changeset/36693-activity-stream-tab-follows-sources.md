---
'@object-ui/plugin-detail': patch
---

fix(record-page): the default record page draws no empty 动态 (Activity stream) tab when the object switches off all three of its sources

Clause-②: no
Metadata-protocol: none

The activity stream merges three sources, each switched by the object: the discussion (`enable.feeds`), activities (`enable.activities`) and field changes (`enable.trackHistory`). An object that turned off all three still showed a 动态 tab on every record page, with nothing in it. The synthesized default page now leaves that tab out, the same way the Attachments tab follows `enable.files`: with `enable: { feeds: false, activities: false }` and `trackHistory` not `true`, `buildDefaultPageSchema` / `buildDefaultTabs` emit no stream tab and no `record:activity` node, and the wide layout draws no 动态 column. With any one source on, the tab is drawn as before. A `relatedLists` entry `'sys_activity'` on such an object does not bring the tab back. An authored page, or an authored `discussion` slot, still draws what its author placed. The Approvals tab is unchanged: it is drawn only when the record has approval requests.
