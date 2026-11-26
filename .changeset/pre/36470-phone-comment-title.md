---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a long record name no longer runs under the centred title on the phone comment page

Clause-②: no
Metadata-protocol: none

On a phone, the comment page's top bar names the record beside the back arrow and centres 「评论」 (Comments). A record name too long for the left column ran past it and under the centred title, so neither could be read. The back button is now held inside its column, so a long name truncates with an ellipsis and the centred title stays whole; a short name renders as before.
