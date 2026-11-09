---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Connect an Agent marks claude.ai (web) and Doubao cloud tasks as not available on an address that is not public HTTPS

Clause-②: no
Metadata-protocol: none

claude.ai on the web and Doubao Work's cloud tasks connect from their vendor's servers, which reach only a public HTTPS address. When the address Connect an Agent shows is an `http://` address, `localhost`, a single-label or `.local` host, or a private, loopback or link-local IP, those two ways in now carry a "not available for this deployment" note with the reason in one sentence (naming the address) and what makes them available (serving the system at a public HTTPS address). Claude Desktop, Claude Code, Codex, Cursor and the other clients stay as they are, and on a public HTTPS address nothing changes. The five new strings ship in every console language pack, Traditional Chinese generated from Simplified.
