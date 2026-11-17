---
'@object-ui/app-shell': patch
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(console): the AI build chat's change card names drafted objects and fields by label, and the publish-health line speaks the console's language

Clause-②: yes (widening)
Metadata-protocol: none

Two fixes to the AI build chat:

- **The change card names drafted objects and fields by their labels.** Before the app's first publish, an object the build drafted lives only in the draft overlay, so the change card read 「b6bl_quote_item · line_total」 where the customer named 「报价明细 · 小计」. The card now asks the draft overlay (`GET /meta/object/:name?preview=draft`) by name for any object, or field, that the published registry does not know. The answer is kept per object; when it does not name what a later card asks for (a field or object a later change drafted), the overlay is asked again once the conversation has moved on, at most once per object per message or turn. A published object still answers from the registry without a draft read. A name neither world knows yet (one the change is about to create) still shows as given. Nothing else in the console reads the draft overlay because of this change.
- **The publish-health line under a Published badge reads the locale pack.** Its own counts ("6 sample rows live", "2 views · 3 widgets verified") were English in every locale, with an `s` picked on `=== 1`. They are now count families under `chatbot.build.health` in every pack (zh-Hant generated from zh-Hans), so a zh console reads 「6 条示例数据已上线 · 已核对 2 个视图 · …」 and Russian agrees with its number. "seed" now reads "sample data set". The findings the line lists (`seedError`, the runtime probes' `issues[].message`) are the producer's text and pass through unchanged.

The widening is new i18n keys only (`chatbot.build.health.*`); no key is removed or renamed.
