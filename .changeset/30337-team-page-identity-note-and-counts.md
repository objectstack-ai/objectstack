---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a team made in Setup no longer reads as managed by an outside identity provider, and a header action's write shows on the page's related lists and their counts at once

Clause-②: no
Metadata-protocol: none

- The `better-auth` note (the Identity tag's tooltip, and the Setup record header's object-label note) read "Managed by the identity provider" / 「由身份提供方管理」, which told the maker of a hand-made team that the row came from elsewhere and was not theirs to change. It now reads "Written through the built-in identity service" / 「经内置身份服务写入」, and its body says these records are created and changed with the actions on the page or through sign-in, invitation and security flows, all of which go through that service. The values change in all ten language packs; no key is added or removed.
- A record-page action that declares `refreshAfter: true` (an `api` action such as a team's Add Member, a server action, a flow, a declared operation) now refreshes the record AND every related list the page shows: the lists refetch and their tab and card counts re-count. It used to refresh the record alone, so a team's members tab read 0 beside a list of 2 until a later row action on that list.
- Nothing to do on upgrade.
