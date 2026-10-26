---
'@object-ui/app-shell': patch
---

fix(app-shell): the flow inspector's list field shows a stored string as one entry instead of an empty list

Clause-②: no
Metadata-protocol: none

A notify node's `channels` may be a single string (`channels: 'email'`) or a list; the spec accepts both and the runtime reads the string as a one-item list. Studio's flow inspector read any non-list value as empty, so the field showed no channels and adding one saved a list without `email`. A stored non-blank string now reads as a one-entry list (trimmed, as the runtime does). An edit saves the list form (`['email', 'sms']`); a field left untouched keeps the stored string.
