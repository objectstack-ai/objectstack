---
'@objectstack/cli': patch
---

fix(cli): a connection label printed by the CLI removes a password or a credential query pair wherever the URL rules read one

Clause-②: no
Metadata-protocol: none

- **One credential grammar.** The database label that `os dev`, `os start` and `os serve` print, and the migrate and resync confirms, now remove URL credentials through the same shared function the datasource read door applies (`redactUrlCredentials` from `@objectstack/spec/data`): the userinfo password, and every credential query pair judged by the shared query-pair judge and its one list of names. Wherever those rules read a credential, on every path the label takes, the label drops it. When the shared rules read more, the label follows with no edit of its own.
- **Unchanged.** Every value the shared rules read no credential in prints exactly as before: `postgres://`, `libsql://` and `file:` values, values with no userinfo, a username-only userinfo, and everything the URL parser already cleaned.
