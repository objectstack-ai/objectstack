---
'@object-ui/react': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

fix(react,components,app-shell): a delegated admin's out-of-scope save shows the server's reason instead of the fixed no-permission line

Clause-②: yes (widening: `@object-ui/react` exports a new `delegationScopeMessage`)
Metadata-protocol: none

When a delegated administrator saved something outside their own scope, the server answered `403 DELEGATION_SCOPE_VIOLATION` with the boundary that refused it (a business unit outside the delegated subtree, a permission set not in the scope's allowlist, a target user outside the subtree). The console read every 403 as a plain denial, so the toast and the in-form banner said only "You don't have permission to save this record."

- **`@object-ui/react`.** New `delegationScopeMessage(err)`: the server's reason, without the `[Security] ` machine prefix, when the error's code (`code` or `details.code`) is `DELEGATION_SCOPE_VIOLATION`; `null` for everything else. It is read before `isPermissionError`, which still answers true for any 403.
- **`@object-ui/components`.** The record form's toast and banner show that reason. A producer-marked `userMessage` still comes first.
- **`@object-ui/app-shell`.** A flow run whose write node met the same refusal (`innerRefusal`) shows the same reason.

Every other denial is unchanged: `PERMISSION_DENIED`, `FORBIDDEN`, a bare 403 and a row-level-security refusal still show the fixed localized line and never the server's text.

What to do: nothing.
