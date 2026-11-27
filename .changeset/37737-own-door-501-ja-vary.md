---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): a 501 answered in the request's language says it varies by Accept-Language, and the inbound automation hooks' Japanese 501 says 自動化

Clause-②: no
Metadata-protocol: none

The `501 NOT_IMPLEMENTED` answers that are localized from the request's `Accept-Language` (the print, personal-view and attachment doors' bridge, the comment doors, the webhook redelivery door, the approval action-page door and the inbound automation hooks) now carry `Vary: Accept-Language`. A `501` is cacheable by default, so a shared cache in front of the API could otherwise hand one reader's language to the next; nothing else about these answers changes.

The two `ja-JP` sentences of the inbound automation hooks say `受信自動化フック`, the term the platform's Japanese bundles use, instead of `受信オートメーションフック`. The operation-message catalog's doc comments now say how a request's language is matched (`es-MX` reads `es-ES`, `zh` and `zh-TW` read `zh-CN`, `ja` reads `ja-JP`; only a language with no catalog locale answers English).
