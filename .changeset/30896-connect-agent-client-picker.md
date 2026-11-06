---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Connect an Agent asks which AI client you use and shows only that client's steps

Clause-②: no
Metadata-protocol: none

The Connect an Agent page no longer lays out every client at once. Under the endpoint and the SKILL.md download, which stay on top for everyone, the page asks which AI assistant you use (Claude, Codex, Cursor, WorkBuddy, Doubao Work, QwenWork) and shows that one's steps; switching is one click, and this browser remembers your choice (`os:pref:connect.client` in the console's workspace preference store). The API key form for scripts and CI moves out of the client list into a collapsed "Advanced: scripts and CI" section at the bottom. The three new strings ship in all ten console languages.
