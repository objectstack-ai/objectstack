---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): the Studio RLS editor stops offering CHECK on a select or delete policy, flags a policy with no predicate, and a refused save shows the server's own explanation

Clause-②: no
Metadata-protocol: none

On a permission set's Row-level security tab, a policy whose operation is `select` or `delete` still offered the CHECK box. A CHECK typed there read "Valid CEL", and the autosave was then refused 422 at `rowLevelSecurity.N.check`. An empty USING behaved the same, refused at the policy itself. The banner showed only the refusal's headline (`rowLevelSecurity.0.check [custom]`), never the server's explanation.

- **CHECK on select / delete.** A blank CHECK is not offered on an operation that admits none; a short note stands in its place. A CHECK that is already written stays visible, with the spec's refusal under it word for word, and no "Valid CEL". Nothing the author wrote is removed.
- **No predicate.** A policy with neither USING nor CHECK shows the spec's refusal under USING.
- **Judged by the spec.** Both findings come from `RowLevelSecurityPolicySchema` itself, not from a rule restated in the editor. While one remains, the autosave holds and the status line says why, since the door would refuse that save.
- **A refused save.** The banner now prints each issue's own message: one on a policy reads on that policy's row ("Not saved. Policy on row 1: …"), and one elsewhere follows the door's headline at its path. A refusal with no issues keeps the door's text, as before.
- **Unchanged.** The server, its 422 and the spec.
