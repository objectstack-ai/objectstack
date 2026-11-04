---
'@objectstack/cli': patch
---

fix(cli): a connection label printed by the CLI removes a password wherever the URL rules read one

Clause-②: no
Metadata-protocol: none

- **One userinfo grammar.** The database label that `os dev`, `os start` and `os serve` print, and the migrate and resync confirms, now remove a URL password through the same shared function the datasource doors use (`redactUrlPassword` from `@objectstack/spec/data`). Wherever those rules read a password, the label drops it. When the shared rules read a userinfo in more shapes, the label follows with no edit of its own.
- **Unchanged.** Every value the shared rules read no password in prints exactly as before: `postgres://`, `libsql://` and `file:` values, values with no userinfo, a username-only userinfo, and everything the URL parser already cleaned.
