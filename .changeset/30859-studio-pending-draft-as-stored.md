---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio editors edit a pending draft of a translated type as its author stored it, never as the console's locale serves it

Clause-②: no
Metadata-protocol: none

The `?state=draft` read translates a translatable type's body (view, page, dashboard, report, app, dataset, …) for the console's `Accept-Language`. Five Studio editors seeded their edit buffer from that served body, so on a zh-CN console a save of an untouched label stored the Chinese translation as the author's text: the Data pillar's Form tab (form view), the list view panel, the Interfaces pillar's app navigation and its leaf (page, dashboard, report, view), and the bundle item editor (a dataset on a read-only base's pair). Measured on a running server: the first save stored the source labels, the re-loaded buffer held the translation, and the second save stored it.

Each now reads the pending draft's stored copy from the layered read's `draft` layer, at the address the draft read was asked at, through the one reading in `authoredObjectBuffer.ts` (`authoredBuffer`), as the object editors already did. The served draft still supplies the version pin, a refusal and the per-key provenance. A served draft whose stored copy the layers do not serve installs no buffer: the editor says it cannot read the pending draft and saves nothing over it. The list view marks and the dashboard pairing reuse that layered answer instead of asking `/layers` again. Types the server does not translate keep the served draft as their buffer.
