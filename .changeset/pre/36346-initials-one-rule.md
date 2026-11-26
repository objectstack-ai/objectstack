---
'@object-ui/types': patch
'@object-ui/fields': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-detail': patch
'@object-ui/auth': patch
'@object-ui/collaboration': patch
---

fix(ui): the kanban card owner, history timeline, user menu and presence stack draw letters-only initials

Clause-②: yes (widening)
Metadata-protocol: none

A person whose display name carries punctuation, such as `Alice (Sales)`, now shows `AS` on the kanban card owner's avatar, the history timeline, the user menu and the presence stack, where those four faces drew `A(`. They now use the same rule as the people cell and the avatar widget: initials are made of letters only, a single-word name gives its first two letters (`Admin` → `AD`), a name of three or more words gives its first and last words' first letters (`John Michael Doe` → `JD`), a single CJK word gives its last one or two characters, and a name with no letter gives `?`. The user menu still falls back to the email's first character when there is no name.

The rule, `getPersonInitials`, is now exported by `@object-ui/types`, the lowest package all of these faces can reach; `@object-ui/fields` re-exports the same function, so its `getPersonInitials` export is unchanged. `@object-ui/auth` now depends on `@object-ui/types`.
