---
'@objectstack/skills': patch
---

docs(skills): the hierarchy-scope row and the `os verify` row name the capability advisory, the `plugins[]` wiring check and `os verify --json`'s `capabilities`

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s access-depth section now says the hierarchy-relative scopes need the `@objectstack/security-enterprise` plugin in `plugins[]`, not only installed, and that a missing or unwired plugin is only advised: `os validate` warns, and `os verify --json` lists it in `capabilities`.

`objectstack-project`'s `os verify` row now says that `os validate`'s capability findings are advisory only there, carried on `--json` as `capabilities`.

Both files pay for the new text by deleting restatement in the same file: the `private` row's pointer to the access-depth section below it, a duplicate link to the security rules that the quick reference already gives, "so the app never hand-writes it" above the check table (the paragraph under it says so), and "Nothing in its row is checked until someone runs it", which restated the clause before it. Neither file's token ceiling moves.
