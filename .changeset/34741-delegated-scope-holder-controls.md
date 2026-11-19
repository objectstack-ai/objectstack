---
'@object-ui/app-shell': patch
---

fix(console): a permission set outside a delegated security administrator's scope offers no Add and no Remove

Clause-②: no
Metadata-protocol: none

On a permission set's Assigned users section, a delegated security administrator was offered Add user, the member picker and each row's Remove for a set outside every delegated scope they hold, and the server then refused the write (403 `DELEGATION_SCOPE_VIOLATION`). The section now reads the caller's own delegable-scope report (`my-delegable-scope`, through `useAuth().describeDelegableScope`, as the invite dialog does): where the report names delegated scopes and the set is in none of their `assignablePermissionSets`, the section lists the holders with no Add, no picker, no Remove and no "click Add" sentence. The server's gate still decides every write (ADR-0090 D6/D12); the section judges nothing else, so a set the report allowlists keeps its controls and a write the gate still refuses (a target user outside the delegate's business-unit subtree) is refused by the server in its own words.

Every other caller keeps the controls as before: a tenant-level administrator, a caller whose report names no delegated scope (how the report draws an organization administrator), and any caller while the report is read, where no runtime serves it, or where the read fails. An organization administrator who also holds a delegated scope is read as the delegate its scopes describe, since the report does not tell the two apart.
